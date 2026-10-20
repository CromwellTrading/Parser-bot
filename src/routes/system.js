const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { getAutomationAvailability, setAutomationAvailability } = require('../utils/systemSettings')

function extractToken(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

async function getRequestClient(req, res) {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Token requerido' })
    return null
  }
  try {
    await requireNonRevokedToken(token)
  } catch (error) {
    res.status(403).json({ error: 'Token revocado', status: 'REVOKED' })
    return null
  }
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, role, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: 'No se pudo validar el usuario' })
    return null
  }
  if (!data) {
    res.status(401).json({ error: 'Token inválido' })
    return null
  }
  if (data.role !== 'admin') {
    res.status(403).json({ error: 'Solo administradores', status: 'ADMIN_REQUIRED' })
    return null
  }
  if (!data.active) {
    res.status(403).json({ error: 'Cuenta inactiva' })
    return null
  }
  return data
}

// Public endpoint: the Android app should poll this before showing any payment flow.
router.get('/status', async (_req, res) => {
  const availability = await getAutomationAvailability()
  res.set('Cache-Control', 'no-store')
  res.json({
    ok: true,
    automation_enabled: availability.enabled,
    automation_message: availability.message,
    updated_at: availability.updated_at,
  })
})

// In-app admin switch. Uses the admin's own SynthesisOne client token.
router.get('/automation', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  res.json({ ok: true, ...(await getAutomationAvailability()) })
})

router.put('/automation', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  const enabled = req.body?.enabled
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled debe ser booleano' })
  try {
    const status = await setAutomationAvailability({ enabled, message: req.body?.message })
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'AUTOMATION_AVAILABILITY_CHANGED', admin_client_id: client.id, enabled: status.enabled }))
    res.json({ ok: true, ...status })
  } catch (error) {
    console.error('Error cambiando disponibilidad:', error)
    res.status(500).json({ error: 'No se pudo guardar la disponibilidad' })
  }
})

module.exports = router
