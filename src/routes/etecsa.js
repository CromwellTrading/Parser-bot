'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
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
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
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
      .select('id, token, active, role, expires_at, device_id')
      .eq('token', token)
      .maybeSingle()
    if (error) throw error
    if (!client) return res.status(401).json({ error: 'La sesión no es válida.' })
    if (client.active === false) return res.status(403).json({ error: 'La licencia no está activa.' })
    if (isExpired(client.expires_at)) return res.status(403).json({ error: 'La licencia ha expirado.' })

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
  console.error('Error consultando catálogo ETECSA:', error.code || error.message)
  return res.status(503).json({ code: error.code || 'ETECSA_CATALOG_UNAVAILABLE', error: 'No se pudo cargar el catálogo en este momento.' })
}

router.use(requireClient)

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
      console.error('Error de autenticación con SokyRecargas:', JSON.stringify({
        code: error.code,
        http_status: Number.isInteger(error.status) ? error.status : null,
        endpoint: typeof error.endpoint === 'string' ? error.endpoint : null,
      }))
      return res.status(503).json({ error: 'No se pudo actualizar el catálogo. Comprueba la configuración del servicio.' })
    }
    console.error('Error actualizando catálogo ETECSA:', JSON.stringify({
      code: error.code || 'ETECSA_REFRESH_FAILED',
      http_status: Number.isInteger(error.status) ? error.status : null,
      endpoint: typeof error.endpoint === 'string' ? error.endpoint : null,
    }))
    return res.status(503).json({ error: 'No se pudo actualizar el catálogo ahora mismo.' })
  }
})

module.exports = router
