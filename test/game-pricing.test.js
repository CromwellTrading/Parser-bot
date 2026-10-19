'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeMarketPricing, computePrices, calculateOfferPrices } = require('../src/utils/gamePricing')

const liveSettings = {
  usd_to_cup: 1050,
  usd_to_saldo: 380,
  profit_margin_pct: 10,
  cup_rounding_step: 5,
  saldo_rounding_step: 1,
  rounding_mode: 'ceil',
}

test('Game Market pricing exports exactly the functions the real catalog worker imports', () => {
  assert.equal(typeof normalizeMarketPricing, 'function')
  assert.equal(typeof calculateOfferPrices, 'function')
  assert.deepEqual(calculateOfferPrices(1, liveSettings), { price_cup: 1155, price_saldo: 418 })
  assert.deepEqual(computePrices(0.5, liveSettings), { price_cup: 580, price_saldo: 209 })
})

test('Game Market refuses missing rates instead of silently inventing a price', () => {
  assert.throws(() => normalizeMarketPricing(undefined), { code: 'PRICING_NOT_CONFIGURED' })
  assert.throws(() => normalizeMarketPricing({ usd_to_cup: 1050 }), { code: 'PRICING_NOT_CONFIGURED' })
})

test('Game Market validates rounding/margin and accepts settings persisted by the admin panel', () => {
  assert.deepEqual(normalizeMarketPricing(liveSettings), liveSettings)
  assert.throws(() => normalizeMarketPricing({ ...liveSettings, profit_margin_pct: -1 }), { code: 'PRICING_NOT_CONFIGURED' })
  assert.throws(() => normalizeMarketPricing({ ...liveSettings, usd_to_saldo: 0 }), { code: 'PRICING_NOT_CONFIGURED' })
})
