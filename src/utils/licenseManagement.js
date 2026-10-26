'use strict'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_EXTENSION_DAYS = 3650

/**
 * Extend a customer license from its current expiry, or from now when it has
 * already expired / has no valid expiry. The caller supplies a trusted server
 * timestamp, never a client-provided base date.
 */
function calculateLicenseExtension(expiresAt, days, now = Date.now()) {
  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > MAX_EXTENSION_DAYS) {
    const error = new Error(`Los días deben ser un entero entre 1 y ${MAX_EXTENSION_DAYS}.`)
    error.status = 400
    throw error
  }

  const currentExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN
  const base = Number.isFinite(currentExpiry) ? Math.max(now, currentExpiry) : now
  const result = new Date(base + parsedDays * DAY_MS)
  if (!Number.isFinite(result.getTime())) {
    const error = new Error('No se pudo calcular el nuevo vencimiento.')
    error.status = 400
    throw error
  }
  return result.toISOString()
}

module.exports = { calculateLicenseExtension, MAX_EXTENSION_DAYS }
