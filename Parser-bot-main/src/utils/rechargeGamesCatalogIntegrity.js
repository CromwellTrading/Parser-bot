'use strict'

const { calculateOfferPrices } = require('./gamePricing')

function rounded(value, decimals) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const factor = 10 ** decimals
  return Math.round((number + Number.EPSILON) * factor) / factor
}

function sameMoney(actual, expected, decimals) {
  const actualRounded = rounded(actual, decimals)
  const expectedRounded = rounded(expected, decimals)
  return actualRounded !== null && expectedRounded !== null && actualRounded === expectedRounded
}

/**
 * Confirms that the complete current provider catalog is safely represented in
 * Supabase. Historical offers are allowed to remain, but they must be hidden.
 * This deliberately validates persisted rows rather than trusting a fingerprint
 * stored separately from the catalog tables.
 */
function verifyRechargeGamesCatalogIntegrity({ catalog, pricing, games = [], offers = [] }) {
  const storedGamesBySlug = new Map()
  for (const row of games) {
    const slug = String(row?.slug || '')
    if (!slug) continue
    if (storedGamesBySlug.has(slug)) return { ok: false, reason: 'duplicate_game_slug', slug }
    storedGamesBySlug.set(slug, row)
  }

  const gameIdsBySlug = new Map()
  for (const game of catalog?.games || []) {
    const stored = storedGamesBySlug.get(String(game.slug))
    if (!stored) return { ok: false, reason: 'missing_game', slug: game.slug }
    if (!stored.id || stored.is_active !== true) return { ok: false, reason: 'inactive_or_invalid_game', slug: game.slug }
    gameIdsBySlug.set(String(game.slug), stored.id)
  }

  const expectedByKey = new Map()
  for (const product of catalog?.products || []) {
    const key = String(product?.product_key || '')
    if (!key) return { ok: false, reason: 'invalid_expected_product_key' }
    if (expectedByKey.has(key)) return { ok: false, reason: 'duplicate_expected_product_key', product_key: key }
    expectedByKey.set(key, product)
  }

  const storedOffersByKey = new Map()
  for (const row of offers) {
    const key = String(row?.provider_product_key || '')
    if (!key) continue
    if (storedOffersByKey.has(key)) return { ok: false, reason: 'duplicate_stored_product_key', product_key: key }
    storedOffersByKey.set(key, row)
  }

  for (const [key, product] of expectedByKey) {
    const stored = storedOffersByKey.get(key)
    if (!stored) return { ok: false, reason: 'missing_offer', product_key: key }

    const expectedGameId = gameIdsBySlug.get(String(product.game_slug))
    if (!expectedGameId || String(stored.game_id) !== String(expectedGameId)) {
      return { ok: false, reason: 'offer_game_mismatch', product_key: key }
    }

    const expectedAvailable = product.out_of_stock !== true
    if (stored.published !== true) return { ok: false, reason: 'unpublished_offer', product_key: key }
    if (stored.available !== expectedAvailable) return { ok: false, reason: 'offer_availability_mismatch', product_key: key }
    if ((stored.provider_out_of_stock === true) !== (product.out_of_stock === true)) {
      return { ok: false, reason: 'offer_stock_state_mismatch', product_key: key }
    }

    const expectedPrices = calculateOfferPrices(product.price_usdt, pricing)
    if (!sameMoney(stored.base_cost_usd, product.price_usdt, 4)) {
      return { ok: false, reason: 'offer_cost_mismatch', product_key: key }
    }
    if (!sameMoney(stored.price_cup, expectedPrices.price_cup, 2)) {
      return { ok: false, reason: 'offer_cup_price_mismatch', product_key: key }
    }
    if (!sameMoney(stored.price_saldo, expectedPrices.price_saldo, 2)) {
      return { ok: false, reason: 'offer_saldo_price_mismatch', product_key: key }
    }
  }

  // Offers removed from the provider are retained for order history, but must
  // never remain visible or purchasable in the public catalog.
  for (const [key, stored] of storedOffersByKey) {
    if (!expectedByKey.has(key) && (stored.published === true || stored.available === true)) {
      return { ok: false, reason: 'stale_offer_still_active', product_key: key }
    }
  }

  return {
    ok: true,
    game_count: (catalog?.games || []).length,
    product_count: expectedByKey.size,
  }
}

module.exports = { verifyRechargeGamesCatalogIntegrity }
