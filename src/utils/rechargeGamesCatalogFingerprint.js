'use strict'

const crypto = require('crypto')

function rechargeGamesCatalogFingerprint(catalog, pricing) {
  const games = (catalog?.games || []).map(game => ({
    slug: game.slug, source_slug: game.source_slug, name: game.name, kind: game.kind, image_url: game.image_url || null,
  })).sort((a, b) => String(a.slug).localeCompare(String(b.slug)))

  const products = (catalog?.products || []).map(product => ({
    game_slug: product.game_slug, source_game_slug: product.source_game_slug, game_name: product.game_name,
    game_image_url: product.game_image_url || null, kind: product.kind, region_slug: product.region_slug,
    source_region_slug: product.source_region_slug, region_name: product.region_name, product_name: product.product_name,
    product_key: product.product_key, price_usdt: Number(product.price_usdt), delivery: product.delivery,
    out_of_stock: product.out_of_stock === true,
  })).sort((a, b) => String(a.product_key).localeCompare(String(b.product_key)))

  const normalizedPricing = {
    usd_to_cup: Number(pricing?.usd_to_cup),
    usd_to_saldo: Number(pricing?.usd_to_saldo),
    profit_margin_pct: Number(pricing?.profit_margin_pct),
    cup_rounding_step: Number(pricing?.cup_rounding_step),
    saldo_rounding_step: Number(pricing?.saldo_rounding_step),
    rounding_mode: String(pricing?.rounding_mode || 'ceil'),
  }
  return crypto.createHash('sha256').update(JSON.stringify({ games, products, pricing: normalizedPricing })).digest('hex')
}

module.exports = { rechargeGamesCatalogFingerprint }
