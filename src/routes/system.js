const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { getAutomationAvailability, readMasterAutomation, setAutomationAvailability } = require('../utils/systemSettings')
const { getPaymentDestinations, getMyPaymentDestination, saveMyPaymentDestination, setMyPaymentDestinationEnabled, readConfiguredRows } = require('../utils/paymentDestinations')
const { refreshActiveReceivers } = require('../utils/paymentReceiverGuard')
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
    return res.json({
      ok: true,
      available: automation.enabled && destinations.length > 0,
      automation_enabled: automation.enabled,
      automation_message: safeAutomationMessage(automation.message),
      updated_at: automation.updated_at || null,
      generated_at: new Date().toISOString(),
      destinations,
    })
  } catch (error) {
    console.error('No se pudieron cargar las cuentas de transferencia:', error.code || error.message)
    return res.status(503).json({ ok: false, error: 'No se pudieron cargar las cuentas de transferencia.' })
  }
})

// Admin-only: who is receiving payments right now and exactly what customers can see. This exists so an
// administrator never has to guess whether switching their account off really removed it from customers.
router.get('/payment-destinations/overview', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  try {
    const [availability, rows] = await Promise.all([getAutomationAvailability(), readConfiguredRows()])
    const ids = [...new Set(rows.map(row => String(row.admin_client_id || '')).filter(Boolean))]
    const names = new Map()
    if (ids.length) {
      const { data } = await supabase.from('clients').select('id, name').in('id', ids)
      for (const row of data || []) names.set(String(row.id), String(row.name || ''))
    }
    const visible = availability.enabled ? new Set((await getPaymentDestinations()).map(item => item.id)) : new Set()
    const accounts = rows.filter(row => row.card_number).map(row => ({
      id: String(row.id),
      owner: names.get(String(row.admin_client_id)) || 'Administrador',
      is_mine: String(row.admin_client_id) === String(client.id),
      card_last4: String(row.card_number || '').replace(/\D/g, '').slice(-4),
      enabled: row.enabled === true,
      visible_to_customers: visible.has(String(row.id)),
    }))
    res.set('Cache-Control', 'no-store')
    return res.json({
      ok: true,
      master_enabled: availability.master_enabled,
      customers_can_pay: availability.enabled,
      visible_count: visible.size,
      accounts,
      generated_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('No se pudo cargar el resumen de cuentas:', error.code || error.message)
    return res.status(503).json({ ok: false, error: 'No se pudo cargar el resumen de cuentas de pago.' })
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
    await refreshActiveReceivers({ force: true })
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

// In-app admin switch. It is PER ADMINISTRATOR: it turns the caller's own account on or off. Turning it off
// removes that administrator's card and confirmation/saldo number from every customer screen immediately,
// without affecting the accounts of other administrators. The shared message is what customers read when no
// account is active. The global master switch is only changed from the web panel.
async function ownAutomationStatus(client) {
  const [availability, master, mine] = await Promise.all([
    getAutomationAvailability(), readMasterAutomation(), getMyPaymentDestination(client.id),
  ])
  const configured = Boolean(mine.card_number && mine.confirmation_phone)
  return {
    ok: true,
    enabled: mine.enabled === true && master.enabled,
    message: master.message,
    updated_at: master.updated_at || availability.updated_at || null,
    own_account: { configured, enabled: mine.enabled === true },
    master_enabled: master.enabled,
    effective_enabled: availability.enabled,
    active_destinations: availability.active_destinations,
  }
}

router.get('/automation', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  try {
    res.set('Cache-Control', 'no-store')
    return res.json(await ownAutomationStatus(client))
  } catch (error) {
    console.error('Error leyendo disponibilidad del administrador:', error.code || error.message)
    return res.status(500).json({ error: 'No se pudo leer la disponibilidad' })
  }
})

router.put('/automation', async (req, res) => {
  const client = await getRequestClient(req, res)
  if (!client) return
  const enabled = req.body?.enabled
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled debe ser booleano' })
  try {
    await setMyPaymentDestinationEnabled(client.id, enabled)
    const master = await readMasterAutomation()
    // Turning an account on also lifts a global "off" so it takes effect; turning it off never touches
    // the global switch or any other administrator.
    if (enabled && !master.enabled) await setAutomationAvailability({ enabled: true, message: req.body?.message })
    else if (typeof req.body?.message === 'string') await setAutomationAvailability({ enabled: master.enabled, message: req.body.message })
    await refreshActiveReceivers({ force: true })
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'ADMIN_AUTOMATION_CHANGED', admin_client_id: client.id, enabled }))
    res.set('Cache-Control', 'no-store')
    return res.json(await ownAutomationStatus(client))
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, code: error.code, error: error.message })
    console.error('Error cambiando disponibilidad:', error)
    return res.status(500).json({ error: 'No se pudo guardar la disponibilidad' })
  }
})

module.exports = router
