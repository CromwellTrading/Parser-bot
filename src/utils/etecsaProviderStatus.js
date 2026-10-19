'use strict'

const PROVIDER_STATUSES = new Set(['pending', 'completed', 'canceled'])

function cleanProviderStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  return PROVIDER_STATUSES.has(status) ? status : null
}

// With Soky app_token, a charged delivery queued for later may be surfaced as
// `completed` even though Soky can subsequently cancel/refund it. Do not report
// it as fulfilled while provider_delivery_queued is true; keep reconciliation
// active so a later authoritative `canceled` status is not missed.
function mapSokyLocalStatus(providerStatus, data = {}) {
  const status = cleanProviderStatus(providerStatus)
  if (!status) return null
  if (status === 'canceled') return 'REFUND_REQUIRED'
  if (status === 'completed' && data?.provider_delivery_queued !== true) return 'COMPLETED'
  return 'PROCESSING'
}

module.exports = { cleanProviderStatus, mapSokyLocalStatus }
