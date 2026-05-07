require('dotenv').config()
const express = require('express')
const app = express()
const supabase = require('./supabase')

app.use(express.json())

// ── Endpoint público — verificar token desde la app Android ──────────────────
app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Token requerido' })

  const { data, error } = await supabase
    .from('clients')
    .select('id, active, token_used')
    .eq('token', token)
    .single()

  if (error || !data) return res.status(401).json({ error: 'Token inválido' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva' })
  if (data.token_used) return res.status(403).json({ error: 'Token en uso' })

  await supabase.from('clients').update({ token_used: true }).eq('token', token)
  res.status(200).json({ ok: true })
})

// ── Rutas principales ────────────────────────────────────────────────────────
const smsRoutes   = require('./routes/sms')
const panelRoutes = require('./routes/panel')

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
