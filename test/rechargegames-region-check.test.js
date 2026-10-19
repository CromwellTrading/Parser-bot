'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  checkPlayerRegion,
  normalizeRegionResult,
  resetRegionCheckRateLimits,
} = require('../src/utils/rechargeGamesRegionCheck')

const originalFetch = global.fetch

test('region-check calls documented public endpoint without reseller key and normalizes OK response', async () => {
  resetRegionCheckRateLimits()
  let seenUrl = null
  let seenOptions = null
  const result = await checkPlayerRegion({
    game: 'free-fire', uid: '51234567', region: 'brazil', clientId: 'client-a',
    fetchImpl: async (url, options) => {
      seenUrl = String(url)
      seenOptions = options
      return new Response(JSON.stringify({ result: 'OK', region: 'brazil' }), { status: 200 })
    },
  })
  assert.equal(seenUrl, 'https://api.rechargegame.games/v1/region-check?game=free-fire&uid=51234567&region=brazil')
  assert.equal(seenOptions.method, 'GET')
  assert.equal(seenOptions.headers['X-API-Key'], undefined)
  assert.equal(result.result, 'OK')
  assert.equal(result.supported, true)
  assert.equal(result.actual_region, 'brazil')
})

test('region-check reports the provider actual region and unsupported games without blocking the result', async () => {
  assert.deepEqual(normalizeRegionResult({ status: 'WRONG_REGION', real_region: 'EU' }), {
    result: 'WRONG_REGION', actual_region: 'EU',
  })
  assert.deepEqual(normalizeRegionResult({ result: 'UNSUPPORTED' }), {
    result: 'UNSUPPORTED', actual_region: null,
  })
})

test('region-check rejects invalid inputs before contacting provider', async () => {
  resetRegionCheckRateLimits()
  let called = false
  await assert.rejects(() => checkPlayerRegion({ game: 'free-fire', uid: 'u'.repeat(33), clientId: 'client', fetchImpl: async () => { called = true } }), error => error.status === 400 && error.code === 'REGION_CHECK_INPUT_TOO_LONG')
  assert.equal(called, false)
})

test('region-check enforces per-client and global provider limits', async () => {
  resetRegionCheckRateLimits()
  const fetchImpl = async () => new Response(JSON.stringify({ result: 'UNSUPPORTED' }), { status: 200 })
  for (let i = 0; i < 5; i++) await checkPlayerRegion({ game: 'game', uid: `uid${i}`, clientId: 'same-client', fetchImpl })
  await assert.rejects(() => checkPlayerRegion({ game: 'game', uid: 'uid6', clientId: 'same-client', fetchImpl }), error => error.status === 429 && error.code === 'REGION_CHECK_CLIENT_RATE_LIMIT')
  resetRegionCheckRateLimits()
  for (let i = 0; i < 15; i++) await checkPlayerRegion({ game: 'game', uid: `uid${i}`, clientId: `client-${i}`, fetchImpl })
  await assert.rejects(() => checkPlayerRegion({ game: 'game', uid: 'last', clientId: 'another-client', fetchImpl }), error => error.status === 429 && error.code === 'REGION_CHECK_RATE_LIMIT')
  resetRegionCheckRateLimits()
})
