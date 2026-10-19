'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { cleanProviderStatus, mapSokyLocalStatus } = require('../src/utils/etecsaProviderStatus')
const { buildRechargeGamesOrderPayload } = require('../src/utils/rechargeGamesOrderPayload')

test('Soky app_token completed-but-queued orders stay processing until the queue clears', () => {
  assert.equal(cleanProviderStatus('completed'), 'completed')
  assert.equal(mapSokyLocalStatus('completed', { provider_delivery_queued: true }), 'PROCESSING')
  assert.equal(mapSokyLocalStatus('completed', { provider_delivery_queued: false }), 'COMPLETED')
  assert.equal(mapSokyLocalStatus('canceled', { provider_delivery_queued: false }), 'REFUND_REQUIRED')
  assert.equal(mapSokyLocalStatus('pending', {}), 'PROCESSING')
  assert.equal(cleanProviderStatus('failed'), null)
})

test('RechargeGames request sends exact product key, stable buyer ref, region and recipient details', () => {
  const body = buildRechargeGamesOrderPayload({
    provider_product_key: 'topup/free-fire/latam/100 Diamonds',
    provider_product_name: '100 Diamonds',
    offer_title: 'Fallback title',
    buyer_ref: 'SO-123',
    provider_region_name: 'Latin America (LATAM)',
    provider_region_slug: 'latam',
  }, { playerId: ' 51234567 ', serverId: ' 1234 ', note: 'SynthesisOne ticket' })
  assert.equal(body.product_key, 'topup/free-fire/latam/100 Diamonds')
  assert.equal(body.product, '100 Diamonds')
  assert.equal(body.buyer_ref, 'SO-123')
  assert.equal(body.region, 'latam')
  assert.equal(body.player_id, '51234567')
  assert.equal(body.server_id, '1234')
  assert.equal(body.quantity, 1)
  assert.equal(body.note, 'SynthesisOne ticket')
  assert.equal(Object.hasOwn(body, 'test'), false, 'live purchase payload must not enable provider test mode')
})

test('RechargeGames region falls back to provider slug and is omitted when unknown', () => {
  const fromSlug = buildRechargeGamesOrderPayload({ provider_product_key: 'x', provider_product_name: 'X', buyer_ref: 'SO-1', provider_region_slug: 'brazil' })
  assert.equal(fromSlug.region, 'brazil')
  const noRegion = buildRechargeGamesOrderPayload({ provider_product_key: 'x', provider_product_name: 'X', buyer_ref: 'SO-1' })
  assert.equal(Object.hasOwn(noRegion, 'region'), false)
})


test('rejects a provider product key beyond the OpenAPI maxLength without altering it', () => {
  assert.throws(() => buildRechargeGamesOrderPayload({
    provider_product_key: 'k'.repeat(301), provider_product_name: 'Package', buyer_ref: 'SO-1',
  }), error => error.code === 'INVALID_PROVIDER_PRODUCT_KEY' && error.status === 409)
})
