'use strict'

const { validateWebhookUrl } = require('./webhookSecurity')

const WEBHOOK_FIELDS = ['webhook_url', 'webhook_url_2', 'webhook_url_3']

/**
 * Normalize the three optional webhook targets accepted by a client's own
 * authenticated connection settings. Omitted fields keep their current value;
 * explicitly supplied blank fields clear that destination.
 */
function normalizeWebhookTargets(body = {}, current = {}) {
  const suppliedAny = WEBHOOK_FIELDS.some(key => Object.prototype.hasOwnProperty.call(body, key))
  if (!suppliedAny) {
    return { ok: false, error: 'Indica al menos un campo de dirección de webhook.' }
  }

  const patch = {}
  const urls = []
  for (const key of WEBHOOK_FIELDS) {
    const value = Object.prototype.hasOwnProperty.call(body, key) ? body[key] : current[key]
    if (value !== null && value !== undefined && typeof value !== 'string') {
      return { ok: false, error: 'Cada dirección de webhook debe ser texto.' }
    }

    const raw = String(value ?? '').trim()
    const validation = validateWebhookUrl(raw)
    if (!validation.ok) {
      return { ok: false, field: key, error: validation.error || 'Dirección de webhook inválida.' }
    }
    patch[key] = validation.url || null
    if (validation.url) urls.push(validation.url)
  }

  return {
    ok: true,
    patch,
    urls: [...new Set(urls)],
    configured: urls.length > 0,
  }
}

module.exports = { WEBHOOK_FIELDS, normalizeWebhookTargets }
