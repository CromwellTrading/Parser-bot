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
  limit: '64kb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8')
  }
}))

const authRoutes = require('./routes/auth')
const smsRoutes = require('./routes/sms')
const onboardingRoutes = require('./routes/onboarding')
const panelRoutes = require('./routes/panel')
const adminRoutes = require('./routes/admin')
const { startWebhookWorker } = require('./utils/webhookDelivery')
const { startLicenseExpiryWorker } = require('./utils/licenseExpiry')

app.use('/api/auth', authRoutes)
app.use('/api/sms', smsRoutes)
app.use('/api/onboarding', onboardingRoutes)
app.use('/panel', panelRoutes)
app.use('/api/admin', adminRoutes)

startWebhookWorker()
startLicenseExpiryWorker()

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
