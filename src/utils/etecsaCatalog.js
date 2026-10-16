'use strict'

const supabase = require('../supabase')
const {
  normalizeRate,
  calculateOfferPrices,
  isPricingConfigured,
} = require('./etecsaPricing')
const { sanitizeCustomerText, verifiedOperatorIds, verifiedCategoryIds, offerMatchesEtecsa, normalizeOffer } = require('./etecsaOfferFilter')

const SOKY_API_BASE = 'https://api.sokyrecargas.com/api/v1'
const SETTINGS_KEY = 'etecsa_pricing'
const CACHE_KEY = 'etecsa_catalog_cache'
const REFRESH_INTERVAL_MS = 30 * 60 * 1000
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

let memoryCache = null
let refreshPromise = null
let workerStarted = false

async function readSetting(key) {
  const { data, error } = await supabase
    .from('synthesisone_settings')
    .select('value, updated_at')
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function writeSetting(key, value) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('synthesisone_settings')
    .upsert({ key, value, updated_at: now }, { onConflict: 'key' })
    .select('value, updated_at')
    .single()
  if (error) throw error
  return data
}

async function getPricingSettings() {
  const row = await readSetting(SETTINGS_KEY)
  const value = row?.value && typeof row.value === 'object' ? row.value : {}
  return {
    usd_to_cup_rate: normalizeRate(value.usd_to_cup_rate),
    usd_to_saldo_rate: normalizeRate(value.usd_to_saldo_rate),
    rounding_step_cup: 5,
    rounding_step_saldo: 5,
    rounding_mode: 'up',
    updated_at: row?.updated_at || null,
    configured: isPricingConfigured(value),
  }
}

async function savePricingSettings({ usdToCupRate, usdToSaldoRate, adminClientId }) {
  const cup = normalizeRate(usdToCupRate)
  const saldo = normalizeRate(usdToSaldoRate)
  if (!cup || !saldo) {
    const error = new Error('Introduce dos tasas positivas con hasta seis decimales.')
    error.code = 'INVALID_RATES'
    throw error
  }
  const saved = await writeSetting(SETTINGS_KEY, {
    usd_to_cup_rate: cup,
    usd_to_saldo_rate: saldo,
    rounding_step_cup: 5,
    rounding_step_saldo: 5,
    rounding_mode: 'up',
    updated_by: String(adminClientId || '').slice(0, 80) || null,
  })
  const value = saved.value || {}
  return {
    usd_to_cup_rate: normalizeRate(value.usd_to_cup_rate),
    usd_to_saldo_rate: normalizeRate(value.usd_to_saldo_rate),
    rounding_step_cup: 5,
    rounding_step_saldo: 5,
    rounding_mode: 'up',
    updated_at: saved.updated_at || null,
    configured: true,
  }
}

function extractRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload)) return payload
  return null
}

async function fetchJson(path) {
  const token = String(process.env.SOKY_APP_TOKEN || '').trim()
  if (!token) {
    const error = new Error('Falta configurar la credencial del proveedor en el servidor.')
    error.code = 'SOKY_TOKEN_NOT_CONFIGURED'
    throw error
  }

  let response
  try {
    response = await fetch(`${SOKY_API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    const error = new Error('No se pudo consultar el catálogo del proveedor.')
    error.code = 'SOKY_NETWORK_ERROR'
    error.cause = cause
    throw error
  }
  if (!response.ok) {
    const error = new Error(`El proveedor respondió con estado ${response.status}.`)
    error.code = response.status === 401 || response.status === 403 ? 'SOKY_AUTH_ERROR' : 'SOKY_HTTP_ERROR'
    error.status = response.status
    throw error
  }
  try {
    return await response.json()
  } catch (cause) {
    const error = new Error('El proveedor devolvió una respuesta que no es JSON válido.')
    error.code = 'SOKY_INVALID_JSON'
    error.cause = cause
    throw error
  }
}

async function fetchAndNormalizeCatalog() {
  const types = ['recharge', 'nauta', 'sim', 'subscription']
    .map(type => `types%5B%5D=${encodeURIComponent(type)}`).join('&')

  const [offersResult, operatorsResult, categoriesResult] = await Promise.allSettled([
    fetchJson(`/recharges/offers?${types}`),
    fetchJson('/recharges/operators'),
    fetchJson('/recharges/categories'),
  ])
  if (offersResult.status !== 'fulfilled') throw offersResult.reason
  const rawOffers = extractRows(offersResult.value)
  if (!rawOffers) {
    const error = new Error('La respuesta de ofertas no contiene un catálogo válido.')
    error.code = 'SOKY_INVALID_CATALOG'
    throw error
  }
  const operators = operatorsResult.status === 'fulfilled' ? (extractRows(operatorsResult.value) || []) : []
  // Categories are fetched for verification/diagnostics even though a generic
  // category name such as “Recargas” is not enough to prove an ETECSA offer.
  if (categoriesResult.status === 'rejected') {
    console.warn('No se pudieron verificar las categorías del catálogo ETECSA.')
  }
  if (operatorsResult.status === 'rejected') {
    console.warn('No se pudieron verificar los operadores del catálogo ETECSA.')
  }
  const categories = categoriesResult.status === 'fulfilled' ? (extractRows(categoriesResult.value) || []) : []
  const operatorIds = verifiedOperatorIds(operators)
  const categoryIds = verifiedCategoryIds(categories)
  const normalized = rawOffers
    .filter(offer => offer?.available !== false)
    .filter(offer => offerMatchesEtecsa(offer, operatorIds, categoryIds))
    .map(normalizeOffer)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  if (rawOffers.length > 0 && normalized.length === 0) {
    const error = new Error('No se encontraron ofertas que se pudieran verificar como ETECSA.')
    error.code = 'ETECSA_NO_VERIFIED_OFFERS'
    throw error
  }

  return {
    offers: normalized,
    checked_at: new Date().toISOString(),
    source_offer_count: rawOffers.length,
    verified_offer_count: normalized.length,
  }
}

async function loadCacheFromDatabase() {
  const row = await readSetting(CACHE_KEY)
  const value = row?.value && typeof row.value === 'object' ? row.value : null
  if (value && Array.isArray(value.offers) && typeof value.checked_at === 'string') memoryCache = value
  return memoryCache
}

async function getStoredCache() {
  if (memoryCache) return memoryCache
  return await loadCacheFromDatabase()
}

async function refreshCatalog() {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const next = await fetchAndNormalizeCatalog()
    await writeSetting(CACHE_KEY, next)
    memoryCache = next
    console.log(JSON.stringify({
      ts: next.checked_at,
      event: 'ETECSA_CATALOG_REFRESHED',
      source_offer_count: next.source_offer_count,
      verified_offer_count: next.verified_offer_count,
    }))
    return next
  })()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

function cacheAgeMs(cache) {
  const stamp = Date.parse(cache?.checked_at || '')
  if (!Number.isFinite(stamp)) return Number.POSITIVE_INFINITY
  return Math.max(0, Date.now() - stamp)
}

async function getCatalogMetadata() {
  const cache = await getStoredCache()
  if (!cache) return { checked_at: null, verified_offer_count: null, expired: true }
  return {
    checked_at: cache.checked_at || null,
    verified_offer_count: cache.verified_offer_count ?? cache.offers?.length ?? null,
    expired: cacheAgeMs(cache) > MAX_CACHE_AGE_MS,
  }
}

async function getCatalogForDisplay({ forceRefresh = false } = {}) {
  const cache = await getStoredCache()
  if (forceRefresh) {
    const updated = await refreshCatalog()
    return { cache: updated, stale: false, age_ms: 0 }
  }
  if (!cache || cacheAgeMs(cache) >= REFRESH_INTERVAL_MS) {
    try {
      const updated = await refreshCatalog()
      return { cache: updated, stale: false, age_ms: 0 }
    } catch (error) {
      if (!cache || cacheAgeMs(cache) > MAX_CACHE_AGE_MS) throw error
      return { cache, stale: true, age_ms: cacheAgeMs(cache), refresh_error: error.code || 'REFRESH_FAILED' }
    }
  }
  const age = cacheAgeMs(cache)
  if (age > MAX_CACHE_AGE_MS) {
    const error = new Error('El catálogo guardado ha superado el período máximo de respaldo.')
    error.code = 'ETECSA_CACHE_EXPIRED'
    throw error
  }
  return { cache, stale: false, age_ms: age }
}

function mapCatalogForClient(cache, settings) {
  return cache.offers.map(offer => {
    const prices = offer.prices.map(price => {
      const label = sanitizeCustomerText(price.label, 120)
      const converted = calculateOfferPrices(price.cost_usd, settings)
      if (!converted || !label) return null
      return {
        label,
        price_cup: converted.cup,
        price_saldo: converted.saldo,
      }
    }).filter(Boolean)
    if (!prices.length) return null
    return {
      id: offer.id,
      name: sanitizeCustomerText(offer.name, 180) || 'Oferta ETECSA',
      description: sanitizeCustomerText(offer.description, 600),
      type: sanitizeCustomerText(offer.type, 30),
      category_name: sanitizeCustomerText(offer.category_name, 120),
      prices,
    }
  }).filter(Boolean)
}

async function getCatalogResponse() {
  const settings = await getPricingSettings()
  if (!settings.configured) {
    const error = new Error('Los precios de las recargas todavía no están configurados.')
    error.code = 'ETECSA_PRICING_NOT_CONFIGURED'
    throw error
  }
  const result = await getCatalogForDisplay()
  if (cacheAgeMs(result.cache) > MAX_CACHE_AGE_MS) {
    const error = new Error('El catálogo guardado ya no está disponible.')
    error.code = 'ETECSA_CACHE_EXPIRED'
    throw error
  }
  return {
    offers: mapCatalogForClient(result.cache, settings),
    checked_at: result.cache.checked_at,
    stale: result.stale,
    cache_age_hours: Math.round((result.age_ms / (60 * 60 * 1000)) * 10) / 10,
    refresh_interval_minutes: 30,
  }
}

function startCatalogWorker() {
  if (workerStarted) return
  workerStarted = true
  // Seed/refresh after startup without blocking the HTTP listener.
  setTimeout(() => {
    refreshCatalog().catch(error => {
      if (error.code === 'SOKY_TOKEN_NOT_CONFIGURED') {
        console.warn('Catálogo ETECSA pendiente: configura SOKY_APP_TOKEN en el servidor.')
      } else {
        console.error('No se pudo actualizar el catálogo ETECSA:', error.code || error.message)
      }
    })
  }, 5_000)
  setInterval(() => {
    refreshCatalog().catch(error => {
      console.error('No se pudo actualizar el catálogo ETECSA:', error.code || error.message)
    })
  }, REFRESH_INTERVAL_MS)
}

module.exports = {
  getPricingSettings,
  savePricingSettings,
  refreshCatalog,
  getCatalogForDisplay,
  getCatalogMetadata,
  getCatalogResponse,
  startCatalogWorker,
  REFRESH_INTERVAL_MS,
  MAX_CACHE_AGE_MS,
  // Exported for focused unit tests.
  offerMatchesEtecsa,
  normalizeOffer,
  verifiedOperatorIds,
  verifiedCategoryIds,
  _resetMemoryForTests() { memoryCache = null; refreshPromise = null; workerStarted = false },
}
