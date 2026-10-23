require('dotenv').config()
require('./telegram')
const express = require('express')
const supabase = require('./supabase')
const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
})

app.use(express.json({
  // KYC images are downscaled on-device and posted as base64; normal payloads remain small.
  limit: '8mb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8') }
}))
app.use(express.urlencoded({ extended: false, limit: '64kb' }))

const authRoutes = require('./routes/auth')
const smsRoutes = require('./routes/sms')
const onboardingRoutes = require('./routes/onboarding')
const panelRoutes = require('./routes/panel')
const adminRoutes = require('./routes/admin')
const supportRoutes = require('./routes/support')
const systemRoutes = require('./routes/system')
const gameMarketRoutes = require('./routes/gameMarket')
const etecsaRoutes = require('./routes/etecsa')
const gameRechargesRoutes = require('./routes/gameRecharges')
const storeAccountRoutes = require('./routes/storeAccount')
const storeSessionRoutes = require('./routes/storeSession')
const rewardsRoutes = require('./routes/rewards')
const storeCartRoutes = require('./routes/storeCart')
const appUpdatesRoutes = require('./routes/appUpdates')

app.use('/api/auth', authRoutes)
app.use('/api/sms', smsRoutes)
app.use('/api/onboarding', onboardingRoutes)
app.use('/panel', panelRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/game-market', gameMarketRoutes)
// These APIs were implemented but not mounted on the actual Express entrypoint.
app.use('/api/etecsa', etecsaRoutes)
app.use('/api/game-recharges', gameRechargesRoutes)
app.use('/api/store', storeAccountRoutes)
app.use('/api/store-session', storeSessionRoutes)
app.use('/api/rewards', rewardsRoutes)
app.use('/api/store/cart', storeCartRoutes)
app.use('/api/app-updates', appUpdatesRoutes)

app.get('/healthz', (req, res) => res.status(200).json({ ok: true, status: 'HEALTHY' }))
app.get('/readyz', async (_req, res) => {
  try {
    // Liveness alone is not sufficient for payments. Validate the critical tables
    // and columns needed for dual-currency Wallet reconciliation and refunds.
    const checks = await Promise.all([
      supabase.from('clients').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('store_wallets').select('balance_cup,balance_saldo', { head: true, count: 'exact' }).limit(1),
      supabase.from('store_wallet_transactions').select('currency,amount_cup,amount_saldo,balance_after_cup,balance_after_saldo', { head: true, count: 'exact' }).limit(1),
      supabase.from('store_wallet_topups').select('currency,amount_cup,amount_saldo,payment_review_at', { head: true, count: 'exact' }).limit(1),
      supabase.from('game_recharge_orders').select('price_basis,payment_source,wallet_refunded_at', { head: true, count: 'exact' }).limit(1),
    ])
    const failed = checks.find(result => result?.error)
    if (failed) throw failed.error
    // Rewards/cart are optional modules: their migrations must not gate service readiness
    // or stop existing customers from reaching payments during staged rollout.
    return res.status(200).json({ ok: true, status: 'READY', database: 'UP', checks: { database: 'ok', dual_currency_wallet: 'ok', refund_tracking: 'ok' } })
  } catch (error) {
    // Do not leak schema/table names or SQL errors into public health responses.
    console.error(JSON.stringify({ event: 'READY_CHECK_FAILED', code: error?.code || null }))
    return res.status(503).json({ ok: false, status: 'NOT_READY', database: 'DOWN' })
  }
})
app.get('/', (req, res) => res.json({ status: 'ok', service: 'SynthesisOne Backend' }))

let workersStarted = false
function startWorkers() {
  if (workersStarted) return
  workersStarted = true
  require('./utils/webhookDelivery').startWebhookWorker()
  require('./utils/licenseExpiry').startLicenseExpiryWorker()
  require('./utils/etecsaCatalog').startCatalogWorker()
  require('./utils/etecsaOrders').startEtecsaOrderWorker()
  require('./utils/rechargeGamesCatalog').startRechargeGamesCatalogWorker()
  require('./utils/rechargeGamesOrders').startRechargeGamesOrderWorker()
  require('./utils/paymentSmsReconciler').startPaymentSmsReconciler()
  require('./utils/storeCartOrders').startStoreCartWorker()
  require('./utils/healthMonitor').startHealthMonitor()
}

function start() {
  startWorkers()
  const PORT = process.env.PORT || 3000
  const server = app.listen(PORT, () => {
    console.log(`🚀 SynthesisOne backend corriendo en puerto ${PORT}`)
    // Hosted platforms already manage health checks; retain a lightweight keep-alive only on Render.
    const SELF_URL = process.env.RENDER_EXTERNAL_URL
    if (SELF_URL) {
      const timer = setInterval(async () => {
        try { await fetch(`${SELF_URL}/healthz`) } catch (err) { console.error('Keep alive error:', err.message) }
      }, 4 * 60 * 1000)
      timer.unref?.()
    }
  })
  return server
}

if (require.main === module) start()
module.exports = { app, start, startWorkers }
