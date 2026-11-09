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
  assert.match(route, /const data = await readRowsInBatches\([\s\S]*?batchSize: 50[\s\S]*?maxRows: 100_000/)
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




test('Android SO Assistant keeps more space for chat and turns support shortcuts into useful actions', t => {
  const mainPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  if (!fs.existsSync(mainPath)) return t.skip('Android sources not mounted')
  const main = fs.readFileSync(mainPath, 'utf8')
  const start = main.indexOf('private fun showAiAssistant()')
  const end = main.indexOf('private fun scheduleFirstVisitAssistantTutor()', start)
  assert.ok(start >= 0 && end > start, 'SO Assistant screen source must be available')
  const screen = main.slice(start, end)
  assert.match(screen, /isFillViewport = false/)
  assert.match(screen, /text = "WHATSAPP"/)
  assert.match(screen, /text = "BUZÓN"/)
  assert.match(screen, /text = "RESUMEN IA"/)
  assert.doesNotMatch(screen, /CONTACTAR SOPORTE/)
})

test('Android Game Market exposes a separate direct CUBACEL Saldo Móvil checkout without Wallet debit', t => {
  const mainPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  if (!fs.existsSync(mainPath)) return t.skip('Android sources not mounted')
  const main = fs.readFileSync(mainPath, 'utf8')
  const start = main.indexOf('private fun beginOfferCheckout(')
  const end = main.indexOf('private fun beginGameRechargeWalletCheckout(', start)
  assert.ok(start >= 0 && end > start, 'Game Market checkout source must be available')
  const checkout = main.slice(start, end)
  assert.match(checkout, /Pagar directamente/)
  assert.match(checkout, /DIRECT_CUBACEL_SALDO/)
  assert.match(checkout, /No necesitas depositar en Wallet/)
  const saldoStart = main.indexOf('private fun beginGameRechargeSaldoCheckout(')
  const saldoEnd = main.indexOf('private fun beginGameRechargeCheckout(', saldoStart)
  assert.ok(saldoStart >= 0 && saldoEnd > saldoStart, 'direct Saldo checkout implementation must be available')
  const saldoCheckout = main.slice(saldoStart, saldoEnd)
  assert.match(saldoCheckout, /payment_method", "CUBACEL"/)
  assert.match(saldoCheckout, /price_basis", "SALDO"/)
})

test('Android admin payment review labels CUBACEL amounts as Saldo Móvil rather than CUP', t => {
  const mainPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  if (!fs.existsSync(mainPath)) return t.skip('Android sources not mounted')
  const main = fs.readFileSync(mainPath, 'utf8')
  const start = main.indexOf('private fun showGameRechargePaymentReviewDetails(')
  const end = main.indexOf('private fun parseRemoteGameCatalog(', start)
  assert.ok(start >= 0 && end > start, 'admin payment review source must be available')
  const screen = main.slice(start, end)
  assert.match(screen, /if \(currency == "SALDO" \|\| isCubacel\) "Saldo Móvil" else "CUP"/)
  assert.match(screen, /SALDO VERIFICADO · ENVIAR/)
})

test('Game Market direct checkout keeps CUP Transfermóvil and CUBACEL Saldo Móvil as separate payment rails', () => {
  const orders = read('src/utils/rechargeGamesOrders.js')
  assert.match(orders, /requestedMethod === 'TRANSFERMOVIL' && basis === 'CUP'/)
  assert.match(orders, /requestedMethod === 'CUBACEL' && basis === 'SALDO'/)
  assert.match(orders, /const baseAmount = Number\(isDirectSaldo \? offer\.price_saldo : offer\.price_cup\)/)
  assert.match(orders, /payment_source: isDirectSaldo \? 'CUBACEL' : 'TRANSFERMOVIL'/)
  assert.match(orders, /currencyLabel = isDirectSaldo \? 'Saldo Móvil' : 'CUP'/)
  const etecsa = read('src/utils/etecsaPricing.js')
  assert.match(etecsa, /return basis === 'CUP' \? 'CUP' : null/)
})


test('direct CUBACEL migration enforces valid payment source/currency pairs and one SMS per Game Market order', () => {
  const sql = read('supabase/migrations/036_gamemarket_direct_cubacel_payments.sql')
  assert.match(sql, /payment_source = 'TRANSFERMOVIL' AND price_basis = 'CUP'/)
  assert.match(sql, /payment_source = 'WALLET' AND price_basis IN \('CUP', 'SALDO'\)/)
  assert.match(sql, /payment_source = 'CUBACEL' AND price_basis = 'SALDO'/)
  assert.match(sql, /game_recharge_orders_payment_sms_log_unique_idx/)
  assert.match(sql, /Duplicate game_recharge_orders\.payment_sms_log_id values exist/)
})

test('external Game Market Saldo Móvil refunds are included in admin operational monitoring', () => {
  for (const file of ['src/utils/opsDashboard.js', 'src/utils/healthMonitor.js']) {
    const source = read(file)
    assert.match(source, /in\('payment_source', \['TRANSFERMOVIL', 'CUBACEL'\]\)\.eq\('status', 'REFUND_REQUIRED'\)/)
  }
  assert.match(read('src/utils/healthMonitor.js'), /No se devuelve automáticamente a Wallet/)
})

test('Game Market external checkout fails closed before collecting payment when its fulfillment provider is not configured', () => {
  const orders = read('src/utils/rechargeGamesOrders.js')
  assert.match(orders, /async function createPaymentOrder\(client, body\) \{\s*if \(!String\(process\.env\.RECHARGEGAMES_API_KEY \|\| ''\)\.trim\(\)\)/)
  assert.match(orders, /PROVIDER_NOT_CONFIGURED/)
})

test('licensed webhook configuration accepts active admin licenses and repairs an already-paid stale store-only row safely', () => {
  const auth = read('src/routes/auth.js')
  const onboarding = read('src/routes/onboarding.js')
  assert.match(auth, /function hasPaidLicenseTerm\(client/)
  assert.match(auth, /client\.store_only && !paidStoreOnlyRow/)
  assert.match(auth, /\.update\(\{ store_only: false \}\)/)
  assert.match(auth, /\.eq\('device_id', requestDeviceId\)/)
  assert.doesNotMatch(auth, /client\.role && client\.role !== ['"]client['"]/)
  assert.match(onboarding, /\.eq\('role', 'client'\)\s*\.eq\('store_only', false\)\s*\.order\('created_at'/)
  assert.match(onboarding, /role: 'client',\s*store_only: false/)
})


test('licensed webhook delivery history is client-scoped and returns only a safe summary', (t) => {
  const auth = read('src/routes/auth.js')
  const helper = read('src/utils/clientWebhookStatus.js')
  const androidPath = path.join(android, 'app/src/main/java/com/synthesisone/app/MainActivity.kt')
  assert.match(auth, /router\.get\('\/webhooks\/deliveries'/)
  assert.match(auth, /\.eq\('client_id', client\.id\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.limit\(20\)/)
  assert.match(auth, /\.map\(publicWebhookDeliverySummary\)/)
  assert.match(helper, /function publicWebhookDeliverySummary/)
  assert.doesNotMatch(helper, /response_body\s*:/)
  assert.doesNotMatch(helper, /webhook_url\s*:/)
  // Delivery history remains a client-authenticated backend capability. The
  // current Android screens do not yet expose a dedicated history view.
})

test('webhook configuration write re-checks active license, store-only flag, expiry and device binding at commit time', () => {
  const auth = read('src/routes/auth.js')
  assert.match(auth, /\.eq\('active', true\)[\s\S]*?\.eq\('store_only', false\)[\s\S]*?\.eq\('device_id', client\.device_id\)/)
  assert.match(auth, /updateQuery = updateQuery\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/)
  assert.match(auth, /updateQuery = updateQuery\.is\('expires_at', null\)/)
})
