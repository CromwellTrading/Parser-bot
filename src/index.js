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
const { startCatalogWorker: startEtecsaCatalogWorker } = require('./utils/etecsaCatalog')
const { startEtecsaOrderWorker } = require('./utils/etecsaOrders')
const { startRechargeGamesCatalogWorker } = require('./utils/rechargeGamesCatalog')
const { startRechargeGamesOrderWorker } = require('./utils/rechargeGamesOrders')
const { startWebhookWorker } = require('./utils/webhookDelivery')
const { startLicenseExpiryWorker } = require('./utils/licenseExpiry')
const { startPaymentSmsReconciler } = require('./utils/paymentSmsReconciler')

app.use('/api/store-session', storeSessionRoutes)
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
