'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCatalog } = require('../src/utils/rechargeGamesCatalogParser')
const { clientSafePackageData } = require('../src/utils/clientSafePackageData')

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
