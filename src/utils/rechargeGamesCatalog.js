'use strict'

const supabase = require('../supabase')
const { rechargeGamesRequest, RechargeGamesApiError } = require('./rechargeGamesApi')
const { DEFAULT_MARKET_PRICING, normalizeMarketPricing, calculateOfferPrices } = require('./gamePricing')

const PROVIDER = 'rechargegames'
const requestedRefreshInterval = Number(process.env.RECHARGEGAMES_CATALOG_REFRESH_MS || 3 * 60 * 60 * 1000)
const CATALOG_REFRESH_MS = Math.max(5 * 60 * 1000, Number.isFinite(requestedRefreshInterval) && requestedRefreshInterval > 0 ? requestedRefreshInterval : 3 * 60 * 60 * 1000)
let workerStarted = false
let refreshInFlight = null

const { cleanText, normalizeCatalog } = require('./rechargeGamesCatalogParser')

async function getPlatformStoreId() {
  const { data, error } = await supabase.from('game_market_stores')
    .select('id').eq('is_platform_store', true).maybeSingle()
  if (error) throw error
  if (!data?.id) {
    const e = new Error('Official Game Market store is missing')
    e.code = 'PLATFORM_STORE_MISSING'
    throw e
  }
  return data.id
}

async function getPricingSettings() {
  const { data, error } = await supabase.from('synthesisone_settings')
    .select('value').eq('key', 'game_market_pricing:synthesisone').maybeSingle()
  if (error) throw error
  return normalizeMarketPricing(data?.value || DEFAULT_MARKET_PRICING)
}

async function writeCatalogError(error) {
  const message = String(error?.code || error?.message || 'CATALOG_REFRESH_FAILED').slice(0, 300)
  await supabase.from('rechargegames_catalog_state').upsert({
    id: 1,
    last_attempt_at: new Date().toISOString(),
    last_error: message,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).then(({ error: saveError }) => {
    if (saveError) console.error('[RechargeGames] No se pudo guardar el estado del catálogo:', saveError.message)
  })
}

async function refreshCatalog({ reason = 'scheduled' } = {}) {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const startedAt = new Date().toISOString()
    try {
      const response = await rechargeGamesRequest('/v1/products', { query: { all: 'true' } })
      const catalog = normalizeCatalog(response.data)
      if (!catalog.products.length) {
        throw new RechargeGamesApiError('RechargeGames catalog did not contain any priced products', { status: 502, code: 'empty_catalog' })
      }
      const storeId = await getPlatformStoreId()
      const pricing = await getPricingSettings()
      const now = new Date().toISOString()
      const gameIds = new Map()

      // Create/update one game row per provider category. Existing manually created offers on
      // the same game remain untouched; only provider-owned offers are synchronized below.
      for (const game of catalog.games) {
        const isGiftcard = game.kind === 'giftcard'
        const gameRow = {
          store_id: storeId,
          slug: game.slug,
          provider_game_slug: game.source_slug,
          name: game.name,
          description: isGiftcard ? `Tarjetas regalo de ${game.name}.` : `Recargas automáticas para ${game.name}.`,
          category: isGiftcard ? 'Tarjetas regalo' : 'Recargas automáticas',
          badge: isGiftcard ? 'GIFT CARD' : 'AUTOMÁTICO',
          is_active: true,
          updated_at: now,
        }
        const { data, error } = await supabase.from('game_market_games')
          .upsert(gameRow, { onConflict: 'store_id,slug' }).select('id').single()
        if (error) throw error
        gameIds.set(game.slug, data.id)
      }

      const offerRows = []
      for (const product of catalog.products) {
        const gameId = gameIds.get(product.game_slug)
        if (!gameId) continue
        const prices = calculateOfferPrices(product.price_usdt, pricing)
        const title = cleanText(`${product.product_name} · ${product.region_name}`, 120)
        const deliveryLabel = product.delivery === 'code' ? 'Entrega de código' : 'Recarga a ID de jugador'
        const packageData = {
          rechargegames: {
            provider: PROVIDER,
            product_key: product.product_key,
            provider_kind: product.kind,
            game_slug: product.source_game_slug,
            game_name: product.game_name,
            region_slug: product.region_slug,
            region_name: product.region_name,
            product_name: product.product_name,
            delivery: product.delivery,
            delivery_label: deliveryLabel,
            out_of_stock: product.out_of_stock,
            currency: 'USDT',
            provider_price_usdt: product.price_usdt,
          },
        }
        offerRows.push({
          store_id: storeId,
          game_id: gameId,
          provider: PROVIDER,
          provider_product_key: product.product_key,
          provider_product_name: product.product_name,
          provider_game_slug: product.source_game_slug,
          provider_region_slug: product.region_slug,
          provider_region_name: product.region_name,
          provider_delivery: product.delivery,
          provider_out_of_stock: product.out_of_stock,
          provider_last_seen_at: now,
          title,
          description: product.out_of_stock ? 'Paquete temporalmente agotado.' : deliveryLabel,
          category: product.kind === 'giftcard' ? 'Tarjeta regalo' : 'Recarga automática',
          package_data: packageData,
          base_cost_usd: product.price_usdt,
          auto_pricing: true,
          price_cup: prices.price_cup,
          price_saldo: prices.price_saldo,
          available: !product.out_of_stock,
          published: true,
          sort_order: 0,
          updated_at: now,
        })
      }

      for (let i = 0; i < offerRows.length; i += 100) {
        const chunk = offerRows.slice(i, i + 100)
        const { error } = await supabase.from('game_market_offers')
          .upsert(chunk, { onConflict: 'store_id,provider,provider_product_key' })
        if (error) throw error
      }

      // Offers removed by the provider remain in history but disappear from the buyable catalog.
      const { error: staleError } = await supabase.from('game_market_offers')
        .update({ available: false, published: false, updated_at: now })
        .eq('store_id', storeId).eq('provider', PROVIDER).lt('provider_last_seen_at', now)
      if (staleError) throw staleError

      const availableProducts = catalog.products.filter(product => !product.out_of_stock).length
      const state = {
        id: 1,
        last_attempt_at: startedAt,
        last_success_at: now,
        last_error: null,
        game_count: catalog.games.length,
        product_count: offerRows.length,
        available_product_count: availableProducts,
        updated_at: now,
      }
      const { error: stateError } = await supabase.from('rechargegames_catalog_state').upsert(state, { onConflict: 'id' })
      if (stateError) throw stateError
      console.log(JSON.stringify({ ts: now, event: 'RECHARGEGAMES_CATALOG_REFRESHED', reason, source_game_count: catalog.games.length, product_count: offerRows.length, available_product_count: availableProducts }))
      return { ok: true, games: catalog.games.length, products: offerRows.length, available_products: availableProducts, last_success_at: now }
    } catch (error) {
      await writeCatalogError(error)
      console.error('[RechargeGames] No se pudo actualizar el catálogo:', JSON.stringify({ code: error?.code || 'catalog_error', http_status: error?.status || null }))
      throw error
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function getCatalogStatus() {
  const { data, error } = await supabase.from('rechargegames_catalog_state').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return data || { last_success_at: null, last_attempt_at: null, last_error: null, game_count: 0, product_count: 0, available_product_count: 0 }
}

function startRechargeGamesCatalogWorker() {
  if (workerStarted) return
  workerStarted = true
  if (!String(process.env.RECHARGEGAMES_API_KEY || '').trim()) {
    console.log('[RechargeGames] Catálogo automático en espera: falta configurar RECHARGEGAMES_API_KEY.')
  } else {
    setTimeout(() => refreshCatalog({ reason: 'startup' }).catch(() => {}), 8_000)
  }
  setInterval(() => {
    if (!String(process.env.RECHARGEGAMES_API_KEY || '').trim()) return
    refreshCatalog({ reason: 'scheduled' }).catch(() => {})
  }, CATALOG_REFRESH_MS)
}

module.exports = { PROVIDER, normalizeCatalog, refreshCatalog, getCatalogStatus, startRechargeGamesCatalogWorker, getPlatformStoreId }
