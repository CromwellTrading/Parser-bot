require('dotenv').config()
require("./telegram");
const express = require('express')
const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
})

app.use(express.json({
  // Optimized gallery images are sent as base64 to the backend before upload to Supabase Storage.
  limit: '3mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8')
  }
}))

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
const storeSessionRoutes = require('./routes/storeSession')
const storeAccountRoutes = require('./routes/storeAccount')
const { startCatalogWorker: startEtecsaCatalogWorker } = require('./utils/etecsaCatalog')
const { startEtecsaOrderWorker } = require('./utils/etecsaOrders')
const { startRechargeGamesCatalogWorker } = require('./utils/rechargeGamesCatalog')
const { startRechargeGamesOrderWorker } = require('./utils/rechargeGamesOrders')
const { startWebhookWorker } = require('./utils/webhookDelivery')
const { startLicenseExpiryWorker } = require('./utils/licenseExpiry')
const { startPaymentSmsReconciler } = require('./utils/paymentSmsReconciler')
const { startHealthMonitor } = require('./utils/healthMonitor')
const supabase = require('./supabase')

app.use('/api/store-session', storeSessionRoutes)
app.use('/api/store/account', storeAccountRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/sms', smsRoutes)
app.use('/api/onboarding', onboardingRoutes)
app.use('/panel', panelRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/game-market', gameMarketRoutes)
app.use('/api/etecsa', etecsaRoutes)
app.use('/api/game-recharges', gameRechargesRoutes)

startWebhookWorker()
startLicenseExpiryWorker()
startEtecsaCatalogWorker()
startEtecsaOrderWorker()
startRechargeGamesCatalogWorker()
startRechargeGamesOrderWorker()
startPaymentSmsReconciler()
startHealthMonitor()

// Liveness is deliberately dependency-free; readiness tests the database without exposing internals.
app.get('/healthz', (_req, res) => res.json({ ok: true, status: 'UP', uptime_seconds: Math.floor(process.uptime()), checked_at: new Date().toISOString() }))
app.get('/readyz', async (_req, res) => {
  try {
    // Check key schema contracts too: a live database with missing store migrations is
    // not ready to accept paid orders. Do not expose table/column names or DB errors.
    const checks = await Promise.all([
      supabase.from('clients').select('id').limit(1),
      supabase.from('store_wallet_topups').select('payment_review_at').limit(0),
      supabase.from('game_recharge_orders').select('wallet_refunded_at,payment_source').limit(0),
      supabase.from('store_wallet_transactions').select('id').limit(0),
      supabase.from('service_incidents').select('id').limit(0),
    ])
    const failed = checks.find(result => result.error)
    if (failed) throw failed.error
    return res.json({ ok: true, status: 'READY', database: 'UP', checked_at: new Date().toISOString() })
  } catch (_) {
    return res.status(503).json({ ok: false, status: 'NOT_READY', database: 'DOWN', checked_at: new Date().toISOString() })
  }
})

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SynthesisOne Backend' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 SynthesisOne backend corriendo en puerto ${PORT}`)

  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
  setInterval(async () => {
    try {
      await fetch(`${SELF_URL}/`)
    } catch (err) {
      console.error('Keep alive error:', err.message)
    }
  }, 4 * 60 * 1000)
})
