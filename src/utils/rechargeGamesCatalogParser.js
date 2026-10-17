'use strict'

const { pickImageUrl } = require('./gameThumbnailResolver')

function cleanText(value, max = 500) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : ''
}

function cleanProductKey(value, max = 500) {
  // Provider product_key must be forwarded exactly; only remove unsafe controls.
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

function safeSlug(value) {
  return cleanText(value, 200).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function humanizeRegion(value) {
  const raw = cleanText(value, 160)
  const slug = safeSlug(raw)
  const aliases = {
    global: 'Global', eu: 'Europe (EU)', europe: 'Europe (EU)', latam: 'Latin America (LATAM)',
    mena: 'Middle East & North Africa (MENA)', cis: 'CIS',
    'sg-my-kh-first-recharge-bonus': 'SG/MY/KH First Recharge Bonus',
    'singapore-malaysia': 'Singapore / Malaysia', 'south-korea': 'South Korea',
    'hong-kong': 'Hong Kong', 'united-states': 'United States', 'united-kingdom': 'United Kingdom',
  }
  if (aliases[slug]) return aliases[slug]
  const acronyms = new Set(['eu', 'us', 'usa', 'uk', 'ca', 'br', 'bd', 'cis', 'latam', 'mena', 'sg', 'my', 'kh', 'jp', 'kr', 'th', 'vn', 'id', 'ph', 'tw', 'tr', 'sa', 'ae'])
  return raw.split(/[\s_-]+/).filter(Boolean).map(part => acronyms.has(part.toLowerCase())
    ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ')
}

function extractCategories(payload) {
  if (Array.isArray(payload?.categories)) return payload.categories
  if (Array.isArray(payload?.data?.categories)) return payload.data.categories
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

function normalizeCatalog(payload) {
  const categories = extractCategories(payload)
  const games = []
  const products = []
  const stats = {
    source_category_count: categories.length,
    source_group_count: 0,
    source_product_count: 0,
    accepted_product_count: 0,
    skipped_missing_name: 0,
    skipped_missing_key: 0,
    skipped_invalid_price: 0,
    skipped_unsupported_delivery: 0,
  }

  for (const category of categories) {
    const sourceGameSlug = cleanProductKey(category?.slug, 160)
    const gameSlug = safeSlug(sourceGameSlug)
    const gameName = cleanText(category?.name, 100)
    if (!gameSlug || !gameName) continue
    const kind = String(category?.kind || 'topup').trim().toLowerCase()
    if (!['topup', 'giftcard'].includes(kind)) continue
    const groups = Array.isArray(category?.groups) ? category.groups
      : Array.isArray(category?.regions) ? category.regions : []
    const game = {
      slug: gameSlug,
      source_slug: sourceGameSlug,
      name: gameName,
      kind,
      image_url: pickImageUrl(category),
      groups,
    }
    games.push(game)

    for (const group of groups) {
      stats.source_group_count += 1
      const sourceRegionSlug = cleanProductKey(group?.slug || group?.region_slug, 160)
      const regionSlug = safeSlug(sourceRegionSlug || group?.name || group?.label || 'global')
      const explicitRegionName = cleanText(group?.name || group?.label || group?.region, 100)
      const regionName = (explicitRegionName || humanizeRegion(sourceRegionSlug || 'Global')).slice(0, 100)
      const groupProducts = Array.isArray(group?.products) ? group.products : []
      for (const product of groupProducts) {
        stats.source_product_count += 1
        if (!game.image_url) game.image_url = pickImageUrl(product)
        const productName = cleanText(product?.name || product?.title || product?.label, 120)
        if (!productName) { stats.skipped_missing_name += 1; continue }
        // Documentation defines a key as kind/category slug/region slug/product name.
        // Use the provider's exact key when present; derive it from the same documented
        // components only when the API response omits that redundant field.
        const providedKey = cleanProductKey(product?.product_key || product?.productKey, 500)
        const derivedKey = sourceGameSlug && sourceRegionSlug ? `${kind}/${sourceGameSlug}/${sourceRegionSlug}/${productName}` : ''
        const productKey = providedKey || cleanProductKey(derivedKey, 500)
        if (!productKey) { stats.skipped_missing_key += 1; continue }
        const rawPrice = product?.price ?? product?.price_usdt ?? product?.priceUsdt
        const price = typeof rawPrice === 'string' ? Number(rawPrice.trim()) : Number(rawPrice)
        if (rawPrice === null || rawPrice === undefined || rawPrice === '' || !Number.isFinite(price) || price < 0) {
          stats.skipped_invalid_price += 1; continue
        }
        const delivery = String(product?.delivery || product?.delivery_type || '').trim().toLowerCase()
        if (!['player_id', 'code'].includes(delivery)) { stats.skipped_unsupported_delivery += 1; continue }
        products.push({
          game_slug: gameSlug,
          source_game_slug: sourceGameSlug,
          game_name: gameName,
          game_image_url: game.image_url,
          kind,
          region_slug: regionSlug,
          source_region_slug: sourceRegionSlug,
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

  const uniqueGames = new Map()
  for (const game of games) {
    const previous = uniqueGames.get(game.slug)
    if (!previous || (!previous.image_url && game.image_url)) uniqueGames.set(game.slug, game)
  }
  const uniqueProducts = new Map()
  for (const product of products) uniqueProducts.set(product.product_key, product)
  const normalizedProducts = [...uniqueProducts.values()]
  stats.accepted_product_count = normalizedProducts.length
  return { games: [...uniqueGames.values()], products: normalizedProducts, stats }
}

module.exports = { cleanText, cleanProductKey, safeSlug, humanizeRegion, extractCategories, normalizeCatalog }
