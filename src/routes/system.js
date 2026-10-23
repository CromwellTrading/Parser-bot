const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { getAutomationAvailability, setAutomationAvailability } = require('../utils/systemSettings')
const { getPaymentDestinations, getMyPaymentDestination, saveMyPaymentDestination } = require('../utils/paymentDestinations')
const { safeAutomationMessage } = require('../utils/customerMessages')

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
    .select('id, name, token, active, role, expires_at, store_only')
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
  if (String(data.role || '').toLowerCase() !== 'admin') {
    res.status(403).json({ error: 'Solo administradores', status: 'ADMIN_REQUIRED' })
    return null
  }
  if (!data.active || data.store_only) {
    res.status(403).json({ error: 'Cuenta inactiva' })
    return null
  }
  return data
}


// Public list used by checkout. Every item contains its own card + matching phone;
// customers never have to guess which number belongs to which card.
router.get('/payment-destinations', async (_req, res) => {
  try {
    const automation = await getAutomationAvailability()
    const destinations = automation.enabled ? await getPaymentDestinations() : []
    res.set('Cache-Control', 'no-store')
    return res.json({ ok: true, available: destinations.length > 0, destinations })
  } catch (error) {
    console.error('No se pudieron cargar las cuentas de transferencia:', error.code || error.message)
    return res.status(503).json({ ok: false, error: 'No se pudieron cargar las cuentas de transferencia.' })
  }
})

router.get('/payment-destinations/mine', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  try {
    const destination = await getMyPaymentDestination(client.id)
    res.set('Cache-Control', 'no-store')
    return res.json({ ok: true, destination })
  } catch (error) {
    console.error('No se pudo cargar la cuenta del administrador:', error.code || error.message)
    return res.status(503).json({ ok: false, error: 'No se pudo cargar tu cuenta de transferencia. Verifica que la actualización del servidor esté instalada.' })
  }
})

router.put('/payment-destinations/mine', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  try {
    const destination = await saveMyPaymentDestination(client, req.body || {})
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'ADMIN_PAYMENT_DESTINATION_UPDATED', admin_client_id: client.id, enabled: destination.enabled }))
    return res.json({ ok: true, destination })
  } catch (error) {
    return res.status(error.status || 503).json({ ok: false, code: error.code || 'PAYMENT_DESTINATION_SAVE_FAILED', error: error.status ? error.message : 'No se pudo guardar tu cuenta de transferencia.' })
  }
})

// Public endpoint: the Android app should poll this before showing any payment flow.
router.get('/status', async (_req, res) => {
  const availability = await getAutomationAvailability()
  res.set('Cache-Control', 'no-store')
  res.json({
    ok: true,
    automation_enabled: availability.enabled,
    automation_message: safeAutomationMessage(availability.message),
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
