'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const { refreshCatalog, getCatalogStatus } = require('../utils/rechargeGamesCatalog')
const {
  getCheckoutConfig, createPaymentOrder, getRecentOrders, getOwnedOrder,
  cancelPaymentOrder, submitRecipientDetails, handleProviderWebhook,
} = require('../utils/rechargeGamesOrders')
const { verifyWebhookSignature } = require('../utils/rechargeGamesWebhookSecurity')
const { checkPlayerRegion } = require('../utils/rechargeGamesRegionCheck')

const router = express.Router()

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}
function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expires = new Date(expiresAt)
  return !Number.isNaN(expires.getTime()) && expires < new Date()
}
function errorResponse(res, error, fallback = 'No se pudo completar la operación.') {
  if (error?.status) return res.status(error.status).json({ code: error.code || 'GAME_RECHARGE_ERROR', error: error.message, ...(error.order ? { order: error.order } : {}) })
  console.error('[RechargeGames] Error interno:', error?.code || error?.message || 'unknown')
  return res.status(500).json({ error: fallback })
}

// Provider webhooks are public but must have a valid signed, recent payload.
router.post('/webhook', async (req, res) => {
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : ''
  const webhookId = String(req.headers['webhook-id'] || '')
  const timestamp = String(req.headers['webhook-timestamp'] || '')
  const signature = String(req.headers['webhook-signature'] || '')
  if (!verifyWebhookSignature({ webhookId, timestamp, signature, rawBody })) {
    return res.status(401).json({ error: 'Firma de notificación no válida.' })
  }
  try {
    const result = await handleProviderWebhook(req.body || {}, webhookId)
    return res.status(200).json(result)
  } catch (error) {
    if (error?.status) return errorResponse(res, error)
    console.error('[RechargeGames] Error procesando webhook:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ error: 'No se pudo procesar la notificación.' })
  }
})

async function requireClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ error: 'Se requiere una licencia válida.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase.from('clients')
      .select('id, token, active, role, expires_at, device_id, store_only')
      .eq('token', token).maybeSingle()
    if (error) throw error
    if (!client) return res.status(401).json({ error: 'La sesión no es válida.' })
    if (!canUseOfficialStore(client)) return res.status(403).json({ error: 'La licencia no está activa o ha expirado.' })
    const boundDevice = String(client.device_id || '').trim()
    const requestedDevice = String(req.headers['x-device-id'] || '').trim()
    if (boundDevice && (!requestedDevice || requestedDevice !== boundDevice)) return res.status(403).json({ error: 'Este dispositivo no está autorizado para la licencia.' })
    req.client = client
    return next()
  } catch (error) {
    if (error?.code === 'TOKEN_REVOKED') return res.status(403).json({ error: 'La licencia ha sido revocada.' })
    console.error('[RechargeGames] Error validando licencia:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ error: 'No se pudo validar la sesión.' })
  }
}
function requireAdmin(req, res, next) {
  if (String(req.client?.role || '').toLowerCase() !== 'admin') return res.status(403).json({ error: 'Esta operación requiere permisos de administrador.' })
  return next()
}

router.use(requireClient)

// RechargeGames explicitly documents this verifier as keyless. Keep it on the
// backend so the APK never calls provider endpoints directly and can be rate-limited.
router.post('/region-check', async (req, res) => {
  try {
    const result = await checkPlayerRegion({
      game: req.body?.game,
      uid: req.body?.uid,
      region: req.body?.region || '',
      clientId: req.client.id,
    })
    return res.json({ ok: true, ...result })
  } catch (error) {
    if (error?.retryAfter) res.setHeader('Retry-After', String(error.retryAfter))
    if (error?.status) return res.status(error.status).json({ ok: false, code: error.code || 'REGION_CHECK_ERROR', error: error.message, ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) })
    console.error('[RechargeGames] Error en verificador regional:', error?.code || error?.message || 'unknown')
    return res.status(502).json({ ok: false, code: 'REGION_CHECK_PROVIDER_ERROR', error: 'No se pudo verificar la región del jugador.' })
  }
})

router.get('/checkout/config', async (req, res) => {
  try { return res.json({ ok: true, ...(await getCheckoutConfig()) }) }
  catch (error) { return errorResponse(res, error, 'No se pudo comprobar el método de pago.') }
})

router.get('/orders/recent', async (req, res) => {
  try { return res.json({ ok: true, orders: await getRecentOrders(req.client.id) }) }
  catch (error) { return errorResponse(res, error, 'No se pudieron consultar las compras.') }
})

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await getOwnedOrder(req.client.id, req.params.id)
    if (!order) return res.status(404).json({ error: 'No se encontró esta compra.' })
    return res.json({ ok: true, order })
  } catch (error) { return errorResponse(res, error, 'No se pudo consultar la compra.') }
})

router.post('/orders', async (req, res) => {
  try { return res.status(201).json({ ok: true, order: await createPaymentOrder(req.client, req.body || {}) }) }
  catch (error) { return errorResponse(res, error, 'No se pudo crear el ticket. Inténtalo de nuevo.') }
})

router.post('/orders/:id/cancel', async (req, res) => {
  try { return res.json({ ok: true, order: await cancelPaymentOrder(req.client.id, req.params.id) }) }
  catch (error) { return errorResponse(res, error, 'No se pudo cancelar la compra.') }
})

router.post('/orders/:id/recipient', async (req, res) => {
  try { return res.json({ ok: true, order: await submitRecipientDetails(req.client.id, req.params.id, req.body || {}) }) }
  catch (error) { return errorResponse(res, error, 'No se pudieron enviar los datos del jugador.') }
})

router.post('/admin/check-connection', requireAdmin, async (req, res) => {
  try {
    const response = await require('../utils/rechargeGamesApi').rechargeGamesRequest('/v1/ping')
    return res.json({ ok: true, connected: response.data?.ok === true, buyer: response.data?.buyer || null })
  } catch (error) {
    if (error?.code === 'api_key_not_configured') return res.status(503).json({ ok: false, connected: false, code: error.code, error: 'Configura la clave API en Render.' })
    return res.status(error?.status || 502).json({ ok: false, connected: false, code: error?.code || 'provider_error', error: 'No se pudo autenticar con el proveedor. Comprueba la clave de API y los permisos de revendedor.' })
  }
})

router.get('/admin/provider-balance', requireAdmin, async (req, res) => {
  try {
    const response = await require('../utils/rechargeGamesApi').rechargeGamesRequest('/v1/balance')
    const rawBalance = response.data?.balance_usdt
    const numericBalance = Number(rawBalance)
    if (rawBalance === undefined || rawBalance === null || !Number.isFinite(numericBalance) || numericBalance < 0) {
      return res.status(502).json({ ok: false, code: 'INVALID_PROVIDER_BALANCE_RESPONSE', error: 'RechargeGames devolvió un saldo con formato inesperado.' })
    }
    // Keep the provider's ledger private; this panel endpoint returns only the
    // reseller balance required to diagnose insufficient_balance failures.
    return res.json({ ok: true, balance_usdt: String(rawBalance), balance_micro: Number.isSafeInteger(Number(response.data?.balance_micro)) ? Number(response.data.balance_micro) : null })
  } catch (error) {
    if (error?.code === 'api_key_not_configured') return res.status(503).json({ ok: false, code: error.code, error: 'Configura la clave API de RechargeGames en Render.' })
    return res.status(error?.status || 502).json({ ok: false, code: error?.code || 'PROVIDER_BALANCE_UNAVAILABLE', error: 'No se pudo consultar el saldo prepago de RechargeGames.' })
  }
})

router.get('/admin/status', requireAdmin, async (req, res) => {
  try {
    const state = await getCatalogStatus()
    return res.json({
      ok: true,
      api_key_configured: Boolean(String(process.env.RECHARGEGAMES_API_KEY || '').trim()),
      webhook_secret_configured: Boolean(String(process.env.RECHARGEGAMES_WEBHOOK_SECRET || '').trim()),
      catalog: state,
      refresh_interval_minutes: Math.round(Math.max(5 * 60 * 1000, Number.isFinite(Number(process.env.RECHARGEGAMES_CATALOG_REFRESH_MS)) && Number(process.env.RECHARGEGAMES_CATALOG_REFRESH_MS) > 0 ? Number(process.env.RECHARGEGAMES_CATALOG_REFRESH_MS) : 3 * 60 * 60 * 1000) / 60000),
    })
  } catch (error) { return errorResponse(res, error, 'No se pudo consultar el estado del catálogo.') }
})

router.post('/admin/refresh', requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, result: await refreshCatalog({ reason: 'admin' }) }) }
  catch (error) {
    if (error?.code === 'api_key_not_configured') return res.status(503).json({ code: error.code, error: 'El catálogo automático todavía no está configurado.' })
    return errorResponse(res, error, 'No se pudo actualizar el catálogo de juegos.')
  }
})

module.exports = router
