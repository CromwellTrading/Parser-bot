'use strict'

const API_BASE = 'https://api.rechargegame.games'
const REQUEST_TIMEOUT_MS = 20_000

class RechargeGamesApiError extends Error {
  constructor(message, { status = 0, code = 'provider_error', details = null } = {}) {
    super(message)
    this.name = 'RechargeGamesApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function apiKey() {
  return String(process.env.RECHARGEGAMES_API_KEY || '').trim()
}

async function rechargeGamesRequest(path, { method = 'GET', body = null, query = null } = {}) {
  const key = apiKey()
  if (!key) throw new RechargeGamesApiError('RechargeGames API key is not configured', { status: 503, code: 'api_key_not_configured' })
  let normalizedPath = String(path || '')
  if (!normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`
  if (normalizedPath.endsWith('/')) normalizedPath = normalizedPath.slice(0, -1)
  if (!normalizedPath.startsWith('/v1/')) throw new RechargeGamesApiError('Invalid RechargeGames API path', { status: 500, code: 'invalid_api_path' })
  const url = new URL(`${API_BASE}${normalizedPath}`)
  if (query && typeof query === 'object') {
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(name, String(value))
    }
  }

  let response
  try {
    response = await fetch(url, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new RechargeGamesApiError('RechargeGames request failed before a response was received', {
      status: 0,
      code: error?.name === 'TimeoutError' ? 'provider_timeout' : 'provider_network_error',
    })
  }

  const raw = await response.text().catch(() => '')
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch (_) { data = { raw_message: raw.slice(0, 1000) } }
  if (!response.ok) {
    const providerError = data?.error || data
    const code = String(providerError?.code || `http_${response.status}`).slice(0, 100)
    const message = String(providerError?.message || `RechargeGames returned HTTP ${response.status}`).slice(0, 500)
    throw new RechargeGamesApiError(message, { status: response.status, code, details: data })
  }
  return { status: response.status, data, headers: response.headers, responseBytes: Buffer.byteLength(raw, 'utf8') }
}

function isProviderNotConfigured(error) {
  return error?.code === 'api_key_not_configured'
}

module.exports = { API_BASE, REQUEST_TIMEOUT_MS, RechargeGamesApiError, rechargeGamesRequest, isProviderNotConfigured }
