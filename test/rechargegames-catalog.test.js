'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCatalog } = require('../src/utils/rechargeGamesCatalogParser')
const { clientSafePackageData } = require('../src/utils/clientSafePackageData')
const { isConnectedRechargeGamesOffer, isLegacyEtecsaGame, packageDataForCatalog } = require('../src/utils/gameMarketCatalogSafety')

const sample = {
  currency: 'USDT',
  categories: [
    {
      slug: 'free-fire', name: 'Free Fire', kind: 'topup',
      groups: [
        { slug: 'brazil', products: [
          { name: '100 Diamonds', price: 0.94, delivery: 'player_id', product_key: 'topup/free-fire/brazil/100 Diamonds' },
          { name: 'Out of stock', price: 1.5, delivery: 'player_id', product_key: 'topup/free-fire/brazil/Out of stock', out_of_stock: true },
          { name: 'Invalid price', price: null, delivery: 'player_id', product_key: 'topup/free-fire/brazil/Invalid price' },
          { name: 'Unknown delivery', price: 2, delivery: 'manual', product_key: 'topup/free-fire/brazil/Unknown delivery' },
        ] },
      ],
    },
    { slug: 'invalid', name: 'Invalid', kind: 'unknown', groups: [] },
  ],
}

test('normalizes topup products and preserves exact provider product_key', () => {
  const result = normalizeCatalog(sample)
  assert.equal(result.games.length, 1)
  assert.equal(result.products.length, 2)
  assert.equal(result.products[0].game_slug, 'free-fire')
  assert.equal(result.products[0].price_usdt, 0.94)
  assert.equal(result.products[0].product_key, 'topup/free-fire/brazil/100 Diamonds')
  assert.equal(result.products[1].out_of_stock, true)
})

test('skips catalog product keys over the provider OpenAPI 300-character limit without truncating', () => {
  const longName = 'x'.repeat(290)
  const result = normalizeCatalog({ categories: [{ slug: 'free-fire', name: 'Free Fire', kind: 'topup', groups: [{ slug: 'brazil', products: [{ name: longName, price: 1, delivery: 'player_id', product_key: `topup/free-fire/brazil/${longName}` }] }] }] })
  assert.equal(result.products.length, 0)
  assert.equal(result.stats.skipped_invalid_key_length, 1)
})

test('normalizes giftcard catalog rows and removes duplicate product keys', () => {
  const result = normalizeCatalog({ categories: [
    { slug: 'steam', name: 'Steam', kind: 'giftcard', groups: [
      { slug: 'global', products: [
        { name: 'Gift 5', price: '5.25', delivery: 'code', product_key: 'giftcard/steam/global/Gift 5' },
        { name: 'Gift 5 duplicate', price: '5.25', delivery: 'code', product_key: 'giftcard/steam/global/Gift 5' },
      ] },
    ] },
  ] })
  assert.equal(result.games[0].kind, 'giftcard')
  assert.equal(result.products.length, 1)
  assert.equal(result.products[0].delivery, 'code')
})

test('client catalog keeps the automatic-offer marker but hides wholesale provider details', () => {
  const safe = clientSafePackageData({
    rechargegames: {
      provider: 'rechargegames', product_key: 'topup/free-fire/brazil/100 Diamonds',
      provider_price_usdt: 0.94, currency: 'USDT', game_slug: 'free-fire',
      delivery: 'player_id', delivery_label: 'Recarga a ID de jugador',
    },
    cosmetic: 'visible',
  })
  assert.equal(safe.cosmetic, 'visible')
  assert.equal(safe.rechargegames.automatic, true)
  assert.equal(safe.rechargegames.delivery, 'player_id')
  assert.equal(safe.rechargegames.product_key, undefined)
  assert.equal(safe.rechargegames.provider_price_usdt, undefined)
  assert.equal(safe.rechargegames.currency, undefined)
  assert.equal(safe.rechargegames.provider, undefined)
})


test('client-visible Game Market offers must be linked to a valid RechargeGames product key', () => {
  assert.equal(isConnectedRechargeGamesOffer({ provider: 'rechargegames', provider_product_key: 'topup/free-fire/global/100 Diamonds' }), true)
  assert.equal(isConnectedRechargeGamesOffer({ provider: null, provider_product_key: 'topup/free-fire/global/100 Diamonds' }), false)
  assert.equal(isConnectedRechargeGamesOffer({ provider: 'rechargegames', provider_product_key: '' }), false)
  assert.equal(isConnectedRechargeGamesOffer({ provider: 'rechargegames', provider_product_key: 'x'.repeat(301) }), false)
})

test('catalog package data restores region and delivery metadata from trusted provider columns without exposing SKU', () => {
  const row = {
    provider: 'rechargegames', provider_product_key: 'topup/mobile-legends/europe/86 Diamonds',
    provider_game_slug: 'mobile-legends', provider_region_slug: 'europe', provider_region_name: 'Europe (EU)',
    provider_delivery: 'player_id', provider_out_of_stock: false, package_data: {},
  }
  const client = packageDataForCatalog(row)
  assert.equal(client.rechargegames.automatic, true)
  assert.equal(client.rechargegames.game_slug, 'mobile-legends')
  assert.equal(client.rechargegames.region_slug, 'europe')
  assert.equal(client.rechargegames.region_name, 'Europe (EU)')
  assert.equal(client.rechargegames.product_key, undefined)
  const admin = packageDataForCatalog(row, { admin: true })
  assert.equal(admin.rechargegames.automatic, true)
})

test('legacy ETECSA placeholder is recognized so live ETECSA catalog is not duplicated', () => {
  assert.equal(isLegacyEtecsaGame({ name: 'ETECSA', slug: 'etecsa' }), true)
  assert.equal(isLegacyEtecsaGame({ name: 'ETECSA / Soky', slug: 'etecsa-soky' }), true)
  assert.equal(isLegacyEtecsaGame({ name: 'Free Fire', slug: 'free-fire' }), false)
})
