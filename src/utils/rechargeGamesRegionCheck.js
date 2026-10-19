'use strict'

const API_BASE = 'https://api.rechargegame.games'
const TIMEOUT_MS = 12_000
const GLOBAL_LIMIT = 15 // Provider allows 20/min per outbound IP; leave headroom.
const CLIENT_LIMIT = 5
const WINDOW_MS = 60_000
const globalHits = []
const clientHits = new Map()
const RECOGNIZED_RESULTS = new Set(['OK', 'WRONG_REGION', 'UID_NOT_FOUND', 'NO_LOCK', 'EXISTS', 'UNVERIFIED', 'UNSUPPORTED'])

function regionError(message, status, code, retryAfter = null) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (retryAfter != null) error.retryAfter = retryAfter
  return error
}

function cleanInput(value, field, max, { required = true, pattern = null } = {}) {
  const input = String(value ?? '')
  if (/[\u0000-\u001f\u007f]/.test(input)) throw regionError(`El campo ${field} contiene caracteres no válidos.`, 400, 'INVALID_REGION_CHECK_INPUT')
  const normalized = input.trim()
  if (required && !normalized) throw regionError(`El campo ${field} es obligatorio.`, 400, 'INVALID_REGION_CHECK_INPUT')
  if (normalized.length > max) throw regionError(`El campo ${field} supera el límite permitido (${max} caracteres).`, 400, 'REGION_CHECK_INPUT_TOO_LONG')
  if (pattern && normalized && !pattern.test(normalized)) throw regionError(`El campo ${field} tiene un formato no válido.`, 400, 'INVALID_REGION_CHECK_INPUT')
  return normalized
}

function takeWindow(hits, now) {
  while (hits.length && now - hits[0] >= WINDOW_MS) hits.shift()
}

function enforceRateLimit(clientId, now = Date.now()) {
  takeWindow(globalHits, now)
  if (globalHits.length >= GLOBAL_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - globalHits[0])) / 1000))
    throw regionError('Se alcanzó el límite temporal de verificaciones regionales. Espera antes de intentarlo de nuevo.', 429, 'REGION_CHECK_RATE_LIMIT', retryAfter)
  }

  const key = String(clientId || 'unknown')
  const hits = clientHits.get(key) || []
  takeWindow(hits, now)
  if (hits.length >= CLIENT_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - hits[0])) / 1000))
    clientHits.set(key, hits)
    throw regionError('Has realizado demasiadas verificaciones seguidas. Espera antes de intentarlo de nuevo.', 429, 'REGION_CHECK_CLIENT_RATE_LIMIT', retryAfter)
  }
  hits.push(now)
  globalHits.push(now)
  clientHits.set(key, hits)
  // Prevent unbounded growth if many one-off client IDs hit the endpoint.
  if (clientHits.size > 10_000) {
    for (const [id, recent] of clientHits) {
      takeWindow(recent, now)
      if (!recent.length) clientHits.delete(id)
    }
  }
}

function normalizeRegionResult(payload) {
  const candidates = [payload?.result, payload?.status, payload?.code, payload?.verdict, payload?.outcome]
  const result = candidates.map(value => String(value ?? '').trim().toUpperCase()).find(value => RECOGNIZED_RESULTS.has(value)) || 'UNVERIFIED'
  const actualRegion = String(payload?.real_region ?? payload?.actual_region ?? payload?.detected_region ?? payload?.region ?? '').trim().slice(0, 100)
  return { result, actual_region: actualRegion || null }
}

async function checkPlayerRegion({ game, uid, region = '', clientId, fetchImpl = global.fetch, now = Date.now() }) {
  const normalizedGame = cleanInput(game, 'game', 60, { pattern: /^[a-zA-Z0-9_-]+$/ })
  const normalizedUid = cleanInput(uid, 'uid', 32)
  const normalizedRegion = cleanInput(region, 'region', 60, { required: false })
  enforceRateLimit(clientId, now)

  const url = new URL(`${API_BASE}/v1/region-check`)
  url.searchParams.set('game', normalizedGame)
  url.searchParams.set('uid', normalizedUid)
  if (normalizedRegion) url.searchParams.set('region', normalizedRegion)

  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw regionError(error?.name === 'TimeoutError'
      ? 'La verificación regional agotó el tiempo de espera.'
      : 'No se pudo conectar con el verificador regional.', 502,
    error?.name === 'TimeoutError' ? 'REGION_CHECK_TIMEOUT' : 'REGION_CHECK_NETWORK_ERROR')
  }

  const raw = await response.text().catch(() => '')
  let payload = {}
  try { payload = raw ? JSON.parse(raw) : {} } catch (_) {}
  if (!response.ok) {
    const retryHeader = Number(response.headers?.get?.('retry-after'))
    if (response.status === 429) throw regionError('El verificador regional alcanzó su límite temporal. Inténtalo más tarde.', 429, 'REGION_CHECK_PROVIDER_RATE_LIMIT', Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 60)
    if (response.status === 422) throw regionError('El proveedor rechazó los datos de juego, jugador o región.', 400, 'REGION_CHECK_REJECTED_INPUT')
    throw regionError('El verificador regional no está disponible en este momento.', 502, 'REGION_CHECK_PROVIDER_ERROR')
  }

  const normalized = normalizeRegionResult(payload)
  return { ...normalized, supported: normalized.result !== 'UNSUPPORTED' }
}

function resetRegionCheckRateLimits() {
  globalHits.length = 0
  clientHits.clear()
}

module.exports = { checkPlayerRegion, normalizeRegionResult, enforceRateLimit, resetRegionCheckRateLimits, GLOBAL_LIMIT, CLIENT_LIMIT, WINDOW_MS }
