require('dotenv').config()
const express = require('express')
const app = express()

app.use((req, res, next) => {
  let data = ''
  req.on('data', chunk => { data += chunk })
  req.on('end', () => {
    req.rawBody = data
    try { req.body = data ? JSON.parse(data) : {} }
    catch { req.body = {} }
    next()
  })
})

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
