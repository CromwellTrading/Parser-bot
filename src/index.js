require('dotenv').config()
const express = require('express')
const app = express()

app.use(express.json())

// ── Rutas principales ────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth')
const smsRoutes = require('./routes/sms')
const panelRoutes = require('./routes/panel')

app.use('/api/auth', authRoutes)
app.use('/api/sms', smsRoutes)
app.use('/panel', panelRoutes)

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SynthesisOne Backend' })
})

// ── Servidor ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 SynthesisOne backend corriendo en puerto ${PORT}`)

  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
  setInterval(async () => {
    try { await fetch(`${SELF_URL}/`) }
    catch (err) { console.error('Keep alive error:', err.message) }
  }, 4 * 60 * 1000)
})
