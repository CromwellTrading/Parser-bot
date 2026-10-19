'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const android = path.resolve(root, '../SMS-relay-main')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('production entrypoint mounts ETECSA, RechargeGames, Store and store-session API routes and starts their workers', () => {
  const src = read('src/index.js')
  for (const route of ["app.use('/api/etecsa', etecsaRoutes)", "app.use('/api/game-recharges', gameRechargesRoutes)", "app.use('/api/store', storeAccountRoutes)", "app.use('/api/store-session', storeSessionRoutes)"]) assert.ok(src.includes(route), `missing route ${route}`)
  for (const worker of ['startCatalogWorker', 'startEtecsaOrderWorker', 'startRechargeGamesCatalogWorker', 'startRechargeGamesOrderWorker', 'startPaymentSmsReconciler']) assert.ok(src.includes(worker), `missing worker ${worker}`)
})

test('Game Market catalog worker uses persisted rate config and does not fall back to unimplemented pricing exports', () => {
  const catalog = read('src/utils/rechargeGamesCatalog.js')
  const pricing = read('src/utils/gamePricing.js')
  assert.match(catalog, /game_market_pricing:normal/)
  assert.doesNotMatch(catalog, /DEFAULT_MARKET_PRICING/)
  for (const symbol of ['normalizeMarketPricing', 'calculateOfferPrices']) assert.match(pricing, new RegExp(`function ${symbol}\\(`))
})


test('Game Market API paginates games and offers so regions/server markets are not silently truncated at 1,000 rows', () => {
  const route = read('src/routes/gameMarket.js')
  assert.match(route, /require\(['"]\.\.\/utils\/supabasePagination['"]\)/)
  assert.match(route, /const games = await readAllRows\([\s\S]*?maxRows: 10_000/)
  assert.match(route, /const data = await readAllRows\([\s\S]*?maxRows: 100_000/)
  assert.match(route, /\.order\('title'\)\.order\('id'\)/)
})

test('Telegram administrator allowlist has no baked-in IDs', () => {
  const telegram = read('src/telegram.js')
  assert.match(telegram, /process\.env\.ADMIN_TELEGRAM_IDS\s*\|\|\s*""/)
  assert.doesNotMatch(telegram, /5387882635|5376388604/)
})

test('Reseller activation requires detected deposit and records manual review outcome', () => {
  const route = read('src/routes/gameMarket.js')
  assert.match(route, /app\.deposit_payment_status !== 'PAYMENT_DETECTED_PENDING_ADMIN'/)
  assert.match(route, /deposit_payment_status: 'APPROVED'/)
  assert.match(route, /deposit_reviewed_by: String\(req\.client\.id\)/)
  const wallet = read('src/utils/storeWallet.js')
  assert.match(wallet, /Number\(topup\.amount_cup\) >= 50000/)
  assert.match(wallet, /PAYMENT_DETECTED_PENDING_ADMIN/)
  assert.match(wallet, /Keep reseller activation manual/i)
})

test('Android admin cannot activate reseller before a qualifying Wallet deposit is detected', t => {
  const mainPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  if (!fs.existsSync(mainPath)) return t.skip('Android sources not mounted')
  const main = fs.readFileSync(mainPath, 'utf8')
  assert.match(main, /deposit_payment_status/)
  assert.match(main, /isEnabled = depositStatus == "PAYMENT_DETECTED_PENDING_ADMIN"/)
  assert.doesNotMatch(main, /Esta versión no reconcilia depósitos automáticamente/)
})

test('wallet refund recovery can repair the known missing service_incidents-table dependency', () => {
  const sql = read('supabase/migrations/020_game_wallet_refund_reliability.sql')
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS public.service_incidents') < sql.indexOf('INSERT INTO public.service_incidents'))
  assert.match(sql, /ALTER TABLE public\.service_incidents ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.service_incidents FROM anon, authenticated/)
})

test('fresh database migrations do not create hardcoded Game Market placeholder titles', () => {
  for (const migration of ['supabase/migrations/009_profiles_game_market.sql', 'supabase/migrations/009_profiles_game_market_reseller_offline.sql']) {
    const sql = read(migration)
    assert.doesNotMatch(sql, /INSERT INTO public\.game_market_games[\s\S]{0,900}free-fire[\s\S]{0,400}mobile-legends/)
  }
  assert.match(read('supabase/migrations/023_game_market_pricing_configuration.sql'), /provider_game_slug IS NULL[\s\S]*NOT EXISTS/)
})

test('Android catalog no longer exposes the hidden-game toggle or a hardcoded demo list', t => {
  const mainPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  if (!fs.existsSync(mainPath)) return t.skip('Android sources not mounted')
  const main = fs.readFileSync(mainPath, 'utf8')
  assert.doesNotMatch(main, /Incluir juegos ocultos|Mostrar elementos no publicados|defaultGameCatalog/)
})


test('external Game Market transfer checkout cannot mislabel a Saldo Móvil retail price as CUP', () => {
  const orders = read('src/utils/rechargeGamesOrders.js')
  assert.match(orders, /basis !== 'CUP'/)
  assert.match(orders, /const amount = Number\(offer\.price_cup\)/)
  assert.match(orders, /Saldo Móvil se muestra como referencia/)
  const etecsa = read('src/utils/etecsaPricing.js')
  assert.match(etecsa, /return basis === 'CUP' \? 'CUP' : null/)
})
