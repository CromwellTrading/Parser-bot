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

app.get('/healthz', (req, res) => res.status(200).json({ ok: true, status: 'HEALTHY' }))
app.get('/readyz', async (req, res) => {
  try {
    const { error } = await supabase.from('clients').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) throw error
    return res.status(200).json({ ok: true, status: 'READY', database: 'UP' })
  } catch (_) {
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
