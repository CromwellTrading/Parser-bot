'use strict'

function cleanText(value, max = 500) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : ''
}

function cleanProductKey(value, max = 500) {
  // product_key must be forwarded exactly as RechargeGames defines it; only strip
  // surrounding whitespace and unsafe control characters, not internal spacing.
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

function safeSlug(value) {
  return cleanText(value, 200).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function normalizeCatalog(payload) {
  const categories = Array.isArray(payload?.categories) ? payload.categories : []
  const games = []
  const products = []
  for (const category of categories) {
    const gameSlug = safeSlug(category?.slug)
    const gameName = cleanText(category?.name, 100)
    if (!gameSlug || !gameName) continue
    const kind = String(category?.kind || 'topup').toLowerCase()
    if (!['topup', 'giftcard'].includes(kind)) continue
    const game = {
      slug: gameSlug,
      source_slug: cleanText(category.slug, 160),
      name: gameName,
      kind,
      groups: Array.isArray(category?.groups) ? category.groups : [],
    }
    games.push(game)
    for (const group of game.groups) {
      const regionSlug = safeSlug(group?.slug)
      const regionName = cleanText(group?.name || group?.label || group?.slug || 'Global', 100)
      for (const product of (Array.isArray(group?.products) ? group.products : [])) {
        const productName = cleanText(product?.name, 120)
        const productKey = cleanProductKey(product?.product_key, 500)
        const price = Number(product?.price)
        const delivery = String(product?.delivery || '').toLowerCase()
        if (!productName || !productKey || !Number.isFinite(price) || price <= 0 || !['player_id', 'code'].includes(delivery)) continue
        products.push({
          game_slug: game.slug,
          source_game_slug: game.source_slug,
          game_name: game.name,
          kind,
          region_slug: regionSlug,
          region_name: regionName,
          product_name: productName,
          product_key: productKey,
          price_usdt: price,
          delivery,
          out_of_stock: product?.out_of_stock === true,
        })
      }
    }
  }
  const unique = new Map()
  for (const product of products) unique.set(product.product_key, product)
  return { games, products: [...unique.values()] }
}

module.exports = { cleanText, cleanProductKey, safeSlug, normalizeCatalog }
