'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { rechargeGamesCatalogFingerprint } = require('../src/utils/rechargeGamesCatalogFingerprint')

const catalog = () => ({
  games: [{ slug: 'free-fire', source_slug: 'free-fire', name: 'Free Fire', kind: 'topup', image_url: null }],
  products: [{ game_slug: 'free-fire', source_game_slug: 'free-fire', game_name: 'Free Fire', game_image_url: null, kind: 'topup', region_slug: 'global', source_region_slug: 'global', region_name: 'Global', product_name: '100 Diamonds', product_key: 'topup/free-fire/global/100 Diamonds', price_usdt: 1.5, delivery: 'player_id', out_of_stock: false }],
})
const pricing = { usd_to_cup: 400, usd_to_saldo: 300, profit_margin_pct: 10, cup_rounding_step: 5, saldo_rounding_step: 5, rounding_mode: 'ceil' }

test('catalog fingerprint is stable regardless of provider array order', () => {
  const original = catalog()
  const reordered = { games: original.games.slice().reverse(), products: original.products.slice().reverse() }
  assert.equal(rechargeGamesCatalogFingerprint(original, pricing), rechargeGamesCatalogFingerprint(reordered, pricing))
})

test('catalog fingerprint changes when a price, stock state, or pricing rule changes', () => {
  const original = catalog()
  const changedPrice = catalog(); changedPrice.products[0].price_usdt = 1.6
  const changedStock = catalog(); changedStock.products[0].out_of_stock = true
  assert.notEqual(rechargeGamesCatalogFingerprint(original, pricing), rechargeGamesCatalogFingerprint(changedPrice, pricing))
  assert.notEqual(rechargeGamesCatalogFingerprint(original, pricing), rechargeGamesCatalogFingerprint(changedStock, pricing))
  assert.notEqual(rechargeGamesCatalogFingerprint(original, pricing), rechargeGamesCatalogFingerprint(original, { ...pricing, usd_to_cup: 410 }))
})
