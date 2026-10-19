'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCatalog } = require('./src/utils/rechargeGamesCatalogParser')
const { clientSafePackageData } = require('./src/utils/clientSafePackageData')

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
      delivery: 'player_id', delivery_label: 'Recarga a ID de jugador', region_name: 'Latin America (LATAM)', region_slug: 'latam', provider_kind: 'topup', out_of_stock: false,
    },
    cosmetic: 'visible',
  })
  assert.equal(safe.cosmetic, 'visible')
  assert.equal(safe.rechargegames.automatic, true)
  assert.equal(safe.rechargegames.delivery, 'player_id')
  assert.equal(safe.rechargegames.region_name, 'Latin America (LATAM)')
  assert.equal(safe.rechargegames.region_slug, 'latam')
  assert.equal(safe.rechargegames.product_key, undefined)
  assert.equal(safe.rechargegames.provider_price_usdt, undefined)
  assert.equal(safe.rechargegames.currency, undefined)
  assert.equal(safe.rechargegames.provider, undefined)
})

test('keeps all source regions and derives documented product keys only when absent', () => {
  const result = normalizeCatalog({ data: { categories: [
    { slug: 'mobile-legends', name: 'Mobile Legends', kind: 'topup', thumbnail_url: 'https://cdn.example.test/ml.jpg', groups: [
      { slug: 'global', name: 'Global', products: [
        { name: '86 Diamonds', price: '0.75', delivery: 'player_id' },
      ] },
      { slug: 'europe', name: 'Europe', products: [
        { name: 'Weekly Pass', price: 1.15, delivery: 'player_id', product_key: 'topup/mobile-legends/europe/Weekly Pass' },
      ] },
    ] },
  ] } })
  assert.equal(result.games.length, 1)
  assert.equal(result.games[0].image_url, 'https://cdn.example.test/ml.jpg')
  assert.equal(result.products.length, 2)
  assert.equal(result.products[0].product_key, 'topup/mobile-legends/global/86 Diamonds')
  assert.equal(result.products[1].region_name, 'Europe')
  assert.equal(result.stats.source_group_count, 2)
  assert.equal(result.stats.source_product_count, 2)
})

test('reports source offers skipped by invalid price or delivery instead of silently hiding counts', () => {
  const result = normalizeCatalog({ categories: [{ slug: 'test-game', name: 'Test Game', groups: [{ slug: 'global', products: [
    { name: 'Valid', price: 1, delivery: 'code', product_key: 'topup/test-game/global/Valid' },
    { name: 'No price', price: null, delivery: 'code', product_key: 'topup/test-game/global/No price' },
    { name: 'Unsupported', price: 1, delivery: 'manual', product_key: 'topup/test-game/global/Unsupported' },
  ] }] }] })
  assert.equal(result.products.length, 1)
  assert.equal(result.stats.skipped_invalid_price, 1)
  assert.equal(result.stats.skipped_unsupported_delivery, 1)
})
