'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const { createCartOrder, getCartOrder, cancelCartOrder, getCartFeatureStatus } = require('../utils/storeCartOrders')
const router = express.Router()
const { safeCustomerText } = require('../utils/customerMessages')

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}
async function requireStoreClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ ok: false, error: 'Vuelve a conectar con la tienda.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase.from('clients')
      .select('id,token,active,role,expires_at,device_id,phone_number,store_only').eq('token', token).maybeSingle()
    if (error) throw error
    if (!client || !canUseOfficialStore(client)) return res.status(401).json({ ok: false, error: 'La sesión de tienda no está activa. Vuelve a conectarte.' })
    const deviceId = String(req.headers['x-device-id'] || '').trim()
    if (client.device_id && (!deviceId || deviceId !== String(client.device_id))) return res.status(403).json({ ok: false, error: 'Esta instalación no coincide con la sesión de tienda.' })
    req.storeClient = client
    return next()
  } catch (error) {
    if (error?.code === 'TOKEN_REVOKED') return res.status(401).json({ ok: false, error: 'La sesión de tienda ya no está activa.' })
    console.error('[StoreCart] Session validation failed:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ ok: false, error: 'No se pudo comprobar la sesión de la tienda.' })
  }
}
function respondError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ ok: false, code: error.code || 'STORE_CART_ERROR', error: safeCustomerText(error.message, fallback, 500) || fallback, ...(error.order ? { order: error.order } : {}) })
  console.error('[StoreCart] Error:', error?.code || error?.message || 'unknown')
  return res.status(500).json({ ok: false, error: fallback })
}
router.use(requireStoreClient)
router.get('/status', async (_req, res) => {
  try { return res.set('Cache-Control', 'no-store').json({ ok: true, ...(await getCartFeatureStatus()) }) }
  catch (error) { return respondError(res, error, 'No se pudo comprobar el carrito.') }
})
router.post('/orders', async (req, res) => {
  try { return res.status(201).json({ ok: true, order: await createCartOrder(req.storeClient, req.body || {}) }) }
  catch (error) { return respondError(res, error, 'No se pudo crear el carrito. No se ha iniciado ningún cobro si no recibiste un ticket válido.') }
})
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await getCartOrder(req.storeClient.id, req.params.id)
    if (!order) return res.status(404).json({ ok: false, error: 'No se encontró este carrito.' })
    return res.json({ ok: true, order })
  } catch (error) { return respondError(res, error, 'No se pudo consultar el estado del carrito.') }
})
router.post('/orders/:id/cancel', async (req, res) => {
  try { return res.json({ ok: true, order: await cancelCartOrder(req.storeClient.id, req.params.id) }) }
  catch (error) { return respondError(res, error, 'No se pudo cancelar el carrito.') }
})
module.exports = router
