'use strict'

const express = require('express')
const supabase = require('../supabase')
const { getLicenseConfig } = require('../utils/onboarding')
const { getAutomationAvailability } = require('../utils/systemSettings')
const {
  getCheckoutConfig, getCurrentOrder, getRecentOrders, getOwnedOrderPublic,
  createPaymentOrder, cancelPaymentOrder, submitRecipientDetails,
  verifySokyWebhookSignature, handleSokyWebhook, listAdminOrders,
} = require('../utils/etecsaOrders')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const {
  getPricingSettings,
  savePricingSettings,
  getCatalogResponse,
  getCatalogMetadata,
  refreshCatalog,
} = require('../utils/etecsaCatalog')

const router = express.Router()

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expires = new Date(expiresAt)
  return !Number.isNaN(expires.getTime()) && expires < new Date()
}

async function requireClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ error: 'Se requiere una licencia válida.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, token, active, role, expires_at, device_id, store_only')
      .eq('token', token)
      .maybeSingle()
    if (error) throw error
    if (!client) return res.status(401).json({ error: 'La sesión no es válida.' })
    if (!canUseOfficialStore(client)) return res.status(403).json({ error: 'La licencia no está activa o ha expirado.' })

    const boundDevice = String(client.device_id || '').trim()
    const requestedDevice = String(req.headers['x-device-id'] || '').trim()
    if (boundDevice && (!requestedDevice || requestedDevice !== boundDevice)) {
      return res.status(403).json({ error: 'Este dispositivo no está autorizado para la licencia.' })
    }
    req.client = client
    return next()
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') return res.status(403).json({ error: 'La licencia ha sido revocada.' })
    console.error('Error validando licencia de ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo validar la sesión.' })
  }
}

function requireAdmin(req, res, next) {
  if (String(req.client?.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Esta función requiere permisos de administrador.' })
  }
  return next()
}

function sendCatalogError(res, error) {
  if (error.code === 'ETECSA_PRICING_NOT_CONFIGURED') {
    return res.status(409).json({ code: error.code, error: 'Los precios de las recargas todavía no están configurados.' })
  }
  if (error.code === 'SOKY_TOKEN_NOT_CONFIGURED') {
    return res.status(503).json({ code: error.code, error: 'El catálogo está temporalmente no disponible.' })
  }
  if (error.code === 'ETECSA_CACHE_EXPIRED') {
    return res.status(503).json({ code: error.code, error: 'No hay un catálogo reciente disponible. Vuelve a intentarlo más tarde.' })
  }
  if (error.code === 'SOKY_AUTH_ERROR') {
    return res.status(503).json({ code: error.code, error: 'No se pudo actualizar el catálogo. Comprueba la configuración del servicio.' })
  }
  if (error.code === 'ETECSA_PRICE_IDS_MISSING') {
    console.error('Soky devolvió precios sin identificadores utilizables:', JSON.stringify(error.catalogDiagnostics || {}))
    return res.status(503).json({ code: error.code, error: 'El catálogo se está actualizando. Vuelve a intentarlo en un momento.' })
  }
  console.error('Error consultando catálogo ETECSA:', error.code || error.message)
  return res.status(503).json({ code: error.code || 'ETECSA_CATALOG_UNAVAILABLE', error: 'No se pudo cargar el catálogo en este momento.' })
}

// Soky callback endpoint is public but accepts only signed, recent webhook events.
router.post('/webhook', async (req, res) => {
  const secret = String(process.env.SOKY_WEBHOOK_SECRET || '').trim()
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : ''
  const signature = String(req.headers['x-soky-signature'] || '')
  if (!secret || !verifySokyWebhookSignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'Firma de proveedor inválida.' })
  }
  try {
    const result = await handleSokyWebhook(req.body || {})
    return res.status(200).json({ ok: true, ...result })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    console.error('Error procesando aviso Soky ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo procesar el aviso.' })
  }
})

router.use(requireClient)

router.get('/checkout/config', async (req, res) => {
  try {
    const config = await getCheckoutConfig()
    return res.json({ ok: true, ...config })
  } catch (error) {
    console.error('Error leyendo configuración de pago ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo comprobar la disponibilidad de pagos.' })
  }
})

router.get('/orders/current', async (req, res) => {
  try {
    return res.json({ ok: true, order: await getCurrentOrder(req.client.id) })
  } catch (error) {
    console.error('Error leyendo ticket ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo consultar la operación actual.' })
  }
})

router.get('/orders/recent', async (req, res) => {
  try {
    return res.json({ ok: true, orders: await getRecentOrders(req.client.id) })
  } catch (error) {
    console.error('Error leyendo pedidos recientes ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudieron consultar tus operaciones.' })
  }
})

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await getOwnedOrderPublic(req.client.id, req.params.id)
    if (!order) return res.status(404).json({ error: 'No se encontró esta operación.' })
    return res.json({ ok: true, order })
  } catch (error) {
    console.error('Error leyendo ticket ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo consultar la operación.' })
  }
})

router.post('/orders', async (req, res) => {
  try {
    const order = await createPaymentOrder(req.client, req.body || {})
    return res.status(201).json({ ok: true, order })
  } catch (error) {
    if (error.status) return res.status(error.status).json({
      code: error.code || 'ETECSA_ORDER_ERROR', error: error.message,
      ...(error.order ? { order: error.order } : {}),
    })
    console.error('Error creando ticket ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo crear el ticket. Inténtalo de nuevo.' })
  }
})

router.post('/orders/:id/cancel', async (req, res) => {
  try {
    const order = await cancelPaymentOrder(req.client.id, req.params.id)
    return res.json({ ok: true, order })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ code: error.code || 'ETECSA_ORDER_ERROR', error: error.message })
    console.error('Error cancelando ticket ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo cancelar la operación.' })
  }
})

router.post('/orders/:id/recipient', async (req, res) => {
  try {
    const order = await submitRecipientDetails(req.client.id, req.params.id, req.body || {})
    return res.json({ ok: true, order })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ code: error.code || 'ETECSA_ORDER_ERROR', error: error.message })
    console.error('Error enviando pedido ETECSA a Soky:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo enviar la solicitud. No realices otro pago.' })
  }
})

router.get('/admin/orders', requireAdmin, async (req, res) => {
  try { return res.json({ ok: true, orders: await listAdminOrders() }) }
  catch (error) {
    console.error('Error consultando tickets ETECSA de administración:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudieron cargar los tickets.' })
  }
})

router.get('/catalog', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const catalog = await getCatalogResponse()
    return res.json({ ok: true, ...catalog })
  } catch (error) {
    return sendCatalogError(res, error)
  }
})

router.get('/admin/settings', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const settings = await getPricingSettings()
    let catalogMeta = { checked_at: null, verified_offer_count: null, expired: true }
    try { catalogMeta = await getCatalogMetadata() } catch (_) {}
    return res.json({
      ok: true,
      settings,
      catalog_checked_at: catalogMeta.checked_at,
      verified_offer_count: catalogMeta.verified_offer_count,
      catalog_cache_expired: catalogMeta.expired,
      refresh_interval_minutes: 30,
      cache_fallback_hours: 24,
    })
  } catch (error) {
    console.error('Error leyendo tasas ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo cargar la configuración de precios.' })
  }
})

router.put('/admin/settings', requireAdmin, async (req, res) => {
  try {
    const saved = await savePricingSettings({
      usdToCupRate: req.body?.usd_to_cup_rate,
      usdToSaldoRate: req.body?.usd_to_saldo_rate,
      adminClientId: req.client.id,
    })
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'ETECSA_PRICING_RATES_CHANGED',
      admin_client_id: req.client.id,
    }))
    return res.json({ ok: true, settings: saved })
  } catch (error) {
    if (error.code === 'INVALID_RATES') return res.status(400).json({ error: error.message })
    console.error('Error guardando tasas ETECSA:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudieron guardar los tipos de cambio.' })
  }
})

router.post('/admin/refresh', requireAdmin, async (req, res) => {
  try {
    const catalog = await refreshCatalog()
    return res.json({
      ok: true,
      checked_at: catalog.checked_at,
      verified_offer_count: catalog.verified_offer_count,
      source_offer_count: catalog.source_offer_count,
    })
  } catch (error) {
    if (error.code === 'SOKY_TOKEN_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'El catálogo todavía no está conectado.' })
    }
    if (error.code === 'SOKY_AUTH_ERROR') {
      return res.status(503).json({ error: 'No se pudo actualizar el catálogo. Comprueba la configuración del servicio.' })
    }
    console.error('Error actualizando catálogo ETECSA:', error.code || error.message)
    return res.status(503).json({ error: 'No se pudo actualizar el catálogo ahora mismo.' })
  }
})

module.exports = router
