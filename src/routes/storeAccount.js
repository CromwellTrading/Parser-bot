'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const { getWalletSummary, createTopup, getTopup, getStoreHistory } = require('../utils/storeWallet')
const { createWalletGameOrder } = require('../utils/rechargeGamesOrders')

const router = express.Router()

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}

async function requireStoreClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ ok: false, error: 'Vuelve a conectar con la tienda.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase.from('clients')
      .select('id,token,active,role,expires_at,device_id,phone_number,store_only')
      .eq('token', token).maybeSingle()
    if (error) throw error
    if (!client || !canUseOfficialStore(client)) return res.status(401).json({ ok: false, error: 'La sesión de tienda no está activa. Vuelve a conectarte.' })
    const deviceId = String(req.headers['x-device-id'] || '').trim()
    if (client.device_id && (!deviceId || deviceId !== String(client.device_id))) {
      return res.status(403).json({ ok: false, error: 'Esta instalación no coincide con la sesión de tienda.' })
    }
    req.storeClient = client
    return next()
  } catch (error) {
    if (error?.code === 'TOKEN_REVOKED') return res.status(401).json({ ok: false, error: 'La sesión de tienda ya no está activa.' })
    console.error('[StoreAccount] Error validando sesión:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ ok: false, error: 'No se pudo comprobar la sesión de la tienda.' })
  }
}

function respondError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ ok: false, code: error.code || 'STORE_ACCOUNT_ERROR', error: error.message, ...(error.order ? { order: error.order } : {}) })
  console.error('[StoreAccount] Error:', error?.code || error?.message || 'unknown')
  return res.status(500).json({ ok: false, error: fallback })
}

router.use(requireStoreClient)

router.get('/wallet', async (req, res) => {
  try { return res.json({ ok: true, wallet: await getWalletSummary(req.storeClient.id) }) }
  catch (error) { return respondError(res, error, 'No se pudo cargar tu Wallet.') }
})

router.post('/wallet/topups', async (req, res) => {
  try { return res.status(201).json({ ok: true, topup: await createTopup(req.storeClient, req.body || {}) }) }
  catch (error) { return respondError(res, error, 'No se pudo crear el ticket para añadir fondos.') }
})

router.get('/wallet/topups/:id', async (req, res) => {
  try {
    const topup = await getTopup(req.storeClient.id, req.params.id)
    if (!topup) return res.status(404).json({ ok: false, error: 'No se encontró la recarga de Wallet.' })
    return res.json({ ok: true, topup })
  } catch (error) { return respondError(res, error, 'No se pudo consultar la recarga de Wallet.') }
})

router.post('/wallet/game-orders', async (req, res) => {
  try { return res.status(201).json({ ok: true, order: await createWalletGameOrder(req.storeClient, req.body || {}) }) }
  catch (error) { return respondError(res, error, 'No se pudo completar la compra con Wallet.') }
})

router.get('/history', async (req, res) => {
  try { return res.json({ ok: true, entries: await getStoreHistory(req.storeClient.id) }) }
  catch (error) { return respondError(res, error, 'No se pudo cargar el historial de compras.') }
})

module.exports = router
