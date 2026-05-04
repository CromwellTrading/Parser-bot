require('dotenv').config()
const express = require('express')
const app = express()

// Un solo parser — simple y limpio
app.use(express.json())

const smsRoutes = require('./routes/sms')
const panelRoutes = require('./routes/panel')

app.use('/api/sms', smsRoutes)
app.use('/panel', panelRoutes)

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SynthesisOne Backend' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 SynthesisOne backend corriendo en puerto ${PORT}`)
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
  setInterval(async () => {
    try { await fetch(`${SELF_URL}/`) }
    catch (err) { console.error('Keep alive error:', err.message) }
  }, 4 * 60 * 1000)
})
