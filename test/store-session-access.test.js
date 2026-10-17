const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isPaidLicenseActive,
  canUseOfficialStore,
  canDispatchPersonalWebhook,
  canAccessGameMarket,
} = require('../src/utils/storeSessionAccess')

const NOW = Date.parse('2026-10-17T12:00:00.000Z')

test('store-only session can use official store with no active license', () => {
  const storeSession = { store_only: true, active: false, expires_at: null }
  assert.equal(isPaidLicenseActive(storeSession, NOW), false)
  assert.equal(canUseOfficialStore(storeSession, NOW), true)
  assert.equal(canDispatchPersonalWebhook(storeSession, NOW), false)
})

test('store-only session can only read the Game Market catalog', () => {
  const storeSession = { store_only: true, active: false }
  assert.equal(canAccessGameMarket(storeSession, 'GET', '/catalog', NOW), true)
  assert.equal(canAccessGameMarket(storeSession, 'POST', '/catalog', NOW), false)
  assert.equal(canAccessGameMarket(storeSession, 'GET', '/profile', NOW), false)
  assert.equal(canAccessGameMarket(storeSession, 'POST', '/admin/games', NOW), false)
})

test('active paid license can use store and personal webhook features', () => {
  const license = { store_only: false, active: true, expires_at: '2026-10-18T12:00:00.000Z' }
  assert.equal(isPaidLicenseActive(license, NOW), true)
  assert.equal(canUseOfficialStore(license, NOW), true)
  assert.equal(canDispatchPersonalWebhook(license, NOW), true)
  assert.equal(canAccessGameMarket(license, 'PUT', '/profile', NOW), true)
})

test('expired or inactive paid licenses cannot use gated features', () => {
  const expired = { store_only: false, active: true, expires_at: '2026-10-16T12:00:00.000Z' }
  const inactive = { store_only: false, active: false, expires_at: null }
  for (const client of [expired, inactive]) {
    assert.equal(isPaidLicenseActive(client, NOW), false)
    assert.equal(canUseOfficialStore(client, NOW), false)
    assert.equal(canDispatchPersonalWebhook(client, NOW), false)
    assert.equal(canAccessGameMarket(client, 'GET', '/catalog', NOW), false)
  }
})
