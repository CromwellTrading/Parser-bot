'use strict'

const supabase = require('../supabase')
const {
  normalizeRate,
  calculateOfferPrices,
  isPricingConfigured,
} = require('./etecsaPricing')
const {
  sanitizeCustomerText,
  normalizeCatalogOffers,
  offerMatchesEtecsa,
  normalizeOffer,
  readProviderPriceId,
  verifiedOperatorIds,
  verifiedCategoryIds,
} = require('./etecsaOfferFilter')

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
    // Read the provider's validation response, but expose only allow-listed
    // message/errors fields. Never log headers, raw response bodies, or tokens.
    let providerPayload = null
    try {
      const rawBody = await response.text()
      if (rawBody && rawBody.length <= 20000) providerPayload = JSON.parse(rawBody)
    } catch (_) {
      providerPayload = null
    }

    const cleanText = (value, maxLength = 240) => {
      if (typeof value !== 'string') return null
      return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength) || null
    }
    const cleanValidationErrors = (errors) => {
      if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return null
      const safe = {}
      for (const [field, details] of Object.entries(errors).slice(0, 8)) {
        const safeField = String(field).replace(/[^a-zA-Z0-9_.\-[\]]/g, '').slice(0, 80)
        if (!safeField) continue
        const values = Array.isArray(details) ? details : [details]
        const messages = values.slice(0, 3).map(item => {
          if (typeof item === 'string' || typeof item === 'number') return cleanText(String(item), 180)
          return null
        }).filter(Boolean)
        if (messages.length) safe[safeField] = messages
      }
      return Object.keys(safe).length ? safe : null
    }

    const error = new Error(`El proveedor respondió con estado HTTP ${response.status}.`)
    error.code = response.status === 401 || response.status === 403 ? 'SOKY_AUTH_ERROR' : 'SOKY_HTTP_ERROR'
    error.status = response.status
    // Safe diagnostics only: never include the Authorization header or token.
    error.endpoint = String(path).split('?')[0]
    error.providerMessage = cleanText(providerPayload?.message)
    error.providerErrorCode = cleanText(providerPayload?.error?.code || providerPayload?.code, 100)
    error.validationErrors = response.status === 422 ? cleanValidationErrors(providerPayload?.errors) : null
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
  const types = ['recharge', 'nauta']
    .map(type => `types%5B%5D=${encodeURIComponent(type)}`).join('&')

  // The user asked for every recharge and Nauta offer Soky returns. Do not
  // make inclusion depend on category/operator/name metadata, as live ETECSA
  // promotions may not expose those fields consistently.
  const payload = await fetchJson(`/recharges/offers?${types}`)
  const rawOffers = extractRows(payload)
  if (!rawOffers) {
    const error = new Error('La respuesta de ofertas no contiene un catálogo válido.')
    error.code = 'SOKY_INVALID_CATALOG'
    throw error
  }

  const result = normalizeCatalogOffers(rawOffers)
  if (rawOffers.length > 0 && result.offers.length === 0) {
    const error = new Error('Soky devolvió ofertas, pero ninguna tiene un precio y una moneda utilizables.')
    error.code = 'ETECSA_NO_PRICED_OFFERS'
    error.catalogDiagnostics = result.diagnostics
    throw error
  }

  const normalizedPriceRows = result.offers.flatMap(offer => offer.prices || [])
  const identifiedPriceRows = normalizedPriceRows.filter(price => Boolean(readProviderPriceId(price)))
  if (normalizedPriceRows.length > 0 && identifiedPriceRows.length === 0) {
    // Do not cache or offer prices that cannot be linked to Soky's required price_id.
    // Log property names only so diagnostics never disclose offer/customer values.
    const rawPriceRows = rawOffers.flatMap(offer => Array.isArray(offer?.prices) ? offer.prices : [])
    const sourcePriceKeyShapes = [...new Set(rawPriceRows
      .filter(price => !readProviderPriceId(price))
      .slice(0, 8)
      .map(price => Object.keys(price || {}).sort().join(',')))]
    const error = new Error('Soky devolvió precios sin identificador de proveedor.')
    error.code = 'ETECSA_PRICE_IDS_MISSING'
    error.catalogDiagnostics = {
      ...result.diagnostics,
      price_row_count: normalizedPriceRows.length,
      identified_price_id_count: identifiedPriceRows.length,
      source_price_key_shapes: sourcePriceKeyShapes,
    }
    throw error
  }

  return {
    offers: result.offers,
    checked_at: new Date().toISOString(),
    source_offer_count: rawOffers.length,
    // Keep this legacy field for compatibility with existing app/admin code.
    // It now means the count actually included in the ETECSA/Nauta catalog.
    verified_offer_count: result.offers.length,
    offer_count: result.offers.length,
    catalog_diagnostics: result.diagnostics,
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
      offer_count: next.offers.length,
      ...next.catalog_diagnostics,
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

function catalogHasAnyProviderPriceId(cache) {
  const rows = Array.isArray(cache?.offers) ? cache.offers.flatMap(offer => Array.isArray(offer?.prices) ? offer.prices : []) : []
  return rows.some(price => Boolean(readProviderPriceId(price)))
}

async function getCatalogForDisplay({ forceRefresh = false } = {}) {
  const cache = await getStoredCache()
  const needsIdRepair = Boolean(cache) && !catalogHasAnyProviderPriceId(cache)
  if (forceRefresh || !cache || cacheAgeMs(cache) >= REFRESH_INTERVAL_MS || needsIdRepair) {
    try {
      const updated = await refreshCatalog()
      if (updated.offers?.length && !catalogHasAnyProviderPriceId(updated)) {
        const error = new Error('El catálogo recibido no contiene identificadores de precio utilizables.')
        error.code = 'ETECSA_PRICE_IDS_MISSING'
        throw error
      }
      return { cache: updated, stale: false, age_ms: 0 }
    } catch (error) {
      // A malformed legacy cache must not be served as if its offers were purchasable.
      if (!cache || cacheAgeMs(cache) > MAX_CACHE_AGE_MS || !catalogHasAnyProviderPriceId(cache)) throw error
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
  // Keep the chosen scope even when falling back to an older persisted cache.
  return cache.offers
    .filter(offer => ['recharge', 'nauta'].includes(String(offer?.type || '').trim().toLowerCase()))
    .map(offer => {
    const prices = offer.prices.map(price => {
      const label = sanitizeCustomerText(price.label, 120)
      const priceId = readProviderPriceId(price)
      const converted = calculateOfferPrices(price.cost_usd, settings)
      if (!converted || !label || !priceId) return null
      return {
        price_id: priceId,
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
      required_inputs: Array.isArray(offer.required_inputs) ? offer.required_inputs : ['recipient'],
      has_email: offer.has_email === true,
      is_preorder: offer.is_preorder === true,
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

function safeProviderErrorDetails(error) {
  const details = {
    code: String(error?.code || 'REFRESH_FAILED'),
    http_status: Number.isInteger(error?.status) ? error.status : null,
    endpoint: typeof error?.endpoint === 'string' ? error.endpoint : null,
  }
  // Validation detail is particularly important for HTTP 422. Include only
  // parsed, allow-listed fields; never include the raw body or Authorization.
  if (error?.status === 422) {
    if (typeof error.providerMessage === 'string' && error.providerMessage) {
      details.provider_message = error.providerMessage
    }
    if (typeof error.providerErrorCode === 'string' && error.providerErrorCode) {
      details.provider_error_code = error.providerErrorCode
    }
    if (error.validationErrors) details.validation_errors = error.validationErrors
  }
  if (error?.code === 'ETECSA_PRICE_IDS_MISSING' && error.catalogDiagnostics) {
    details.catalog_diagnostics = error.catalogDiagnostics
  }
  return details
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
        console.error('No se pudo actualizar el catálogo ETECSA:', JSON.stringify(safeProviderErrorDetails(error)))
      }
    })
  }, 5_000)
  setInterval(() => {
    refreshCatalog().catch(error => {
      console.error('No se pudo actualizar el catálogo ETECSA:', JSON.stringify(safeProviderErrorDetails(error)))
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
  readProviderPriceId,
  verifiedOperatorIds,
  verifiedCategoryIds,
  _resetMemoryForTests() { memoryCache = null; refreshPromise = null; workerStarted = false },
}
