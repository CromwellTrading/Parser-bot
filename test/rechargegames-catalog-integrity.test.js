'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateOfferPrices } = require('../src/utils/gamePricing')
const { verifyRechargeGamesCatalogIntegrity } = require('../src/utils/rechargeGamesCatalogIntegrity')

const pricing = {
  usd_to_cup: 400,
  usd_to_saldo: 300,
  profit_margin_pct: 10,
  cup_rounding_step: 5,
  saldo_rounding_step: 5,
  rounding_mode: 'ceil',
}

function fixture() {
  const catalog = {
    games: [
      { slug: 'free-fire', name: 'Free Fire' },
      { slug: 'steam', name: 'Steam' },
    ],
    products: [
      { game_slug: 'free-fire', product_key: 'topup/free-fire/global/100 Diamonds', price_usdt: 1.25, out_of_stock: false },
      { game_slug: 'steam', product_key: 'giftcard/steam/global/5 USD', price_usdt: 5, out_of_stock: true },
    ],
  }
  const games = [
    { id: 'game-1', slug: 'free-fire', is_active: true },
    { id: 'game-2', slug: 'steam', is_active: true },
  ]
  const offers = catalog.products.map(product => ({
    game_id: product.game_slug === 'free-fire' ? 'game-1' : 'game-2',
    provider_product_key: product.product_key,
    published: true,
    available: !product.out_of_stock,
    provider_out_of_stock: product.out_of_stock,
    base_cost_usd: Number(product.price_usdt).toFixed(4),
    ...calculateOfferPrices(product.price_usdt, pricing),
  }))
  return { catalog, games, offers }
}

test('accepts a complete catalog with matching games, offers, prices and stock states', () => {
  const state = fixture()
  assert.deepEqual(verifyRechargeGamesCatalogIntegrity({ ...state, pricing }), {
    ok: true,
    game_count: 2,
    product_count: 2,
  })
})

test('detects a missing game or offer even when a previous fingerprint exists', () => {
  const state = fixture()
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...state, games: state.games.slice(1), pricing }).reason, 'missing_game')
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...state, offers: state.offers.slice(1), pricing }).reason, 'missing_offer')
})

test('detects offers that were accidentally unpublished or made unavailable', () => {
  const unpublished = fixture()
  unpublished.offers[0].published = false
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...unpublished, pricing }).reason, 'unpublished_offer')

  const unavailable = fixture()
  unavailable.offers[0].available = false
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...unavailable, pricing }).reason, 'offer_availability_mismatch')
})

test('detects price and game-link corruption', () => {
  const badPrice = fixture()
  badPrice.offers[0].price_cup += 5
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...badPrice, pricing }).reason, 'offer_cup_price_mismatch')

  const badLink = fixture()
  badLink.offers[0].game_id = 'game-2'
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...badLink, pricing }).reason, 'offer_game_mismatch')
})

test('allows historical removed offers only when they are hidden and unavailable', () => {
  const state = fixture()
  state.offers.push({
    game_id: 'game-1',
    provider_product_key: 'topup/free-fire/global/Removed pack',
    published: false,
    available: false,
    provider_out_of_stock: false,
    base_cost_usd: '0.5000',
    price_cup: 220,
    price_saldo: 165,
  })
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...state, pricing }).ok, true)

  state.offers[state.offers.length - 1].published = true
  assert.equal(verifyRechargeGamesCatalogIntegrity({ ...state, pricing }).reason, 'stale_offer_still_active')
})
