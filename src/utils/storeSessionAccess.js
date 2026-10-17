'use strict'

function isPaidLicenseActive(client, now = Date.now()) {
  if (!client || client.store_only === true || client.active === false) return false
  if (client.expires_at) {
    const expiry = Date.parse(client.expires_at)
    if (!Number.isFinite(expiry) || expiry <= now) return false
  }
  return true
}

function canUseOfficialStore(client, now = Date.now()) {
  return Boolean(client && (client.store_only === true || isPaidLicenseActive(client, now)))
}

function canDispatchPersonalWebhook(client, now = Date.now()) {
  return isPaidLicenseActive(client, now)
}

function canAccessGameMarket(client, method, path, now = Date.now()) {
  if (!client) return false
  if (client.store_only === true) return String(method || '').toUpperCase() === 'GET' && path === '/catalog'
  return isPaidLicenseActive(client, now)
}

module.exports = {
  isPaidLicenseActive,
  canUseOfficialStore,
  canDispatchPersonalWebhook,
  canAccessGameMarket,
}
