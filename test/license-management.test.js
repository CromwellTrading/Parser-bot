'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateLicenseExtension } = require('../src/utils/licenseManagement')
const DAY = 24 * 60 * 60 * 1000

test('extends from a future expiration date', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z')
  const expires = calculateLicenseExtension('2026-11-05T12:00:00.000Z', 30, now)
  assert.equal(expires, '2026-12-05T12:00:00.000Z')
})

test('extends an expired license from the current server time', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z')
  const expires = calculateLicenseExtension('2026-10-01T12:00:00.000Z', 30, now)
  assert.equal(expires, new Date(now + 30 * DAY).toISOString())
})

test('uses the current server time when no expiration exists', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z')
  assert.equal(calculateLicenseExtension(null, 7, now), new Date(now + 7 * DAY).toISOString())
})

test('rejects invalid extension periods', () => {
  for (const value of [0, -1, 1.5, 'abc', 3651]) {
    assert.throws(() => calculateLicenseExtension(null, value), { status: 400 })
  }
})
