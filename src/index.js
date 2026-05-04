require('dotenv').config()
const express = require('express')
const app = express()

// Middleware para capturar el body raw (necesario para verificar HMAC)
app.use((req, res, next) => {
  let data = ''
  req.on('data', chunk => { data += chunk })
  req.on('end', () => {
    req.rawBody = data
    try {
      req.body = data ? JSON.parse(data) : {}
    } catch {
      req.body = {}
    }
    next()
  })
})

app.use(express.json())

// Rutas
const smsRoutes = require('./routes/sms')
const adminRoutes = require('./routes/admin')

app.use('/api/sms', smsRoutes)
app.use('/api/admin', adminRoutes)

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SynthesisOne Backend' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 SynthesisOne backend corriendo en puerto ${PORT}`)
})
