'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { summarizeGameOffers, GAME_ID_PATTERN } = require('../src/utils/gameMarketCatalogSummary')

test('summary counts only purchasable offers and reports the cheapest prices', () => {
  const out = summarizeGameOffers([
    { published: true, available: true, price_cup: 900, price_saldo: 300, package_data: {} },
    { published: true, available: true, price_cup: 450, price_saldo: 0, package_data: {} },
    { published: true, available: false, price_cup: 100, price_saldo: 50, package_data: {} },
    { published: true, available: true, price_cup: 80, price_saldo: 20, package_data: { rechargegames: { out_of_stock: true } } },
    { published: false, available: true, price_cup: 10, price_saldo: 5, package_data: {} },
  ])
  assert.deepEqual(out, { offer_count: 5, available_offer_count: 2, min_price_cup: 450, min_price_saldo: 300 })
})

test('empty or invalid input produces a safe empty summary', () => {
  assert.deepEqual(summarizeGameOffers(undefined), { offer_count: 0, available_offer_count: 0, min_price_cup: null, min_price_saldo: null })
})

test('game id pattern only accepts UUIDs', () => {
  assert.ok(GAME_ID_PATTERN.test('3f2b8c1e-0d4a-4b6e-9a51-7c2d1e8f0a11'))
  assert.ok(!GAME_ID_PATTERN.test("x' or 1=1"))
})
