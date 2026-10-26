const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const {
  normalizeClientProfile,
  normalizeClientProfileUpdate,
  publicClient,
  clientStatus,
} = require('../utils/clientProfile')
const { normalizePhone } = require('../utils/parser')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { expireDueLicenses } = require('../utils/licenseExpiry')
const { ensureWebhookSecret } = require('../utils/webhookDelivery')
const { normalizeWebhookTargets } = require('../utils/clientWebhooks')

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expiryMs = Date.parse(expiresAt)
  // An unreadable expiration must not accidentally grant access.
  return !Number.isFinite(expiryMs) || expiryMs <= Date.now()
}

function hasPaidLicenseTerm(client, now = Date.now()) {
  if (!client || client.active !== true || !client.expires_at) return false
  const expiryMs = Date.parse(client.expires_at)
  return Number.isFinite(expiryMs) && expiryMs > now
}

function extractToken(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

async function fetchClientByToken(token) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, token_used, device_id, phone_number, card1, card2, card3, wallet, webhook_url, webhook_url_2, webhook_url_3, created_at, expires_at, role, store_only')
    .eq('token', token)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function updateClient(clientId, patch) {
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .select('id, name, token, active, token_used, device_id, phone_number, card1, card2, card3, wallet, webhook_url, webhook_url_2, webhook_url_3, created_at, expires_at, role, store_only')
    .single()

  if (error) throw error
  return data
}

async function authorizeWebhookSettings(req, res) {
  await expireDueLicenses()
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ ok: false, error: 'Inicia sesión con una licencia activa para configurar la conexión.' })
    return null
  }

  await requireNonRevokedToken(token)
  const client = await fetchClientByToken(token)
  if (!client) {
    res.status(401).json({ ok: false, error: 'La licencia no es válida.' })
    return null
  }
  // A normal free-store session is inactive and has no expiration. A past
  // renewal bug could, however, reactivate that row as a paid license while
  // leaving store_only=true. Accept that state only when it has an active,
  // explicit future term; the flag is cleared below after device validation.
  const paidStoreOnlyRow = client.store_only === true && hasPaidLicenseTerm(client)
  if (client.store_only && !paidStoreOnlyRow) {
    res.status(403).json({ ok: false, error: 'Esta función requiere una licencia de automatización activa.' })
    return null
  }
  if (client.active !== true || isExpired(client.expires_at)) {
    res.status(403).json({ ok: false, error: 'Tu licencia no está activa o ha vencido.' })
    return null
  }

  // The role does not determine whether a license is paid: administrator
  // accounts can configure their own webhook as long as their license and
  // device binding are valid.
  const requestDeviceId = String(req.headers['x-device-id'] || '').trim()
  if (!client.device_id || !requestDeviceId || client.device_id !== requestDeviceId) {
    res.status(403).json({ ok: false, error: 'Este dispositivo no coincide con el asociado a la licencia. Sincroniza la app y vuelve a intentarlo.' })
    return null
  }

  if (paidStoreOnlyRow) {
    // One-time, compare-and-set repair for already-activated licenses that
    // were mistakenly left marked as store-only. Never promotes an inactive,
    // unexpired-less or differently-bound free-store session.
    const { data: repaired, error: repairError } = await supabase
      .from('clients')
      .update({ store_only: false })
      .eq('id', client.id)
      .eq('store_only', true)
      .eq('active', true)
      .eq('device_id', requestDeviceId)
      .gt('expires_at', new Date().toISOString())
      .select('id, name, token, active, token_used, device_id, phone_number, card1, card2, card3, wallet, webhook_url, webhook_url_2, webhook_url_3, created_at, expires_at, role, store_only')
      .maybeSingle()
    if (repairError) throw repairError
    if (!repaired) {
      res.status(403).json({ ok: false, error: 'No se pudo confirmar la licencia en este dispositivo. Sincroniza la app y vuelve a intentarlo.' })
      return null
    }
    return repaired
  }

  return client
}

async function readWebhookSettings(clientId) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, webhook_url, webhook_url_2, webhook_url_3, webhook_secret, active, expires_at, role, store_only, device_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return ensureWebhookSecret(data)
}

function publicWebhookSettings(client) {
  return {
    webhook_url: client.webhook_url || null,
    webhook_url_2: client.webhook_url_2 || null,
    webhook_url_3: client.webhook_url_3 || null,
    configured: Boolean(client.webhook_url || client.webhook_url_2 || client.webhook_url_3),
    signing_secret: client.webhook_secret,
  }
}

router.get('/webhooks', async (req, res) => {
  try {
    const client = await authorizeWebhookSettings(req, res)
    if (!client) return
    const settings = await readWebhookSettings(client.id)
    if (!settings) return res.status(404).json({ ok: false, error: 'No se encontró la configuración de esta licencia.' })
    res.set('Cache-Control', 'no-store')
    return res.json({ ok: true, ...publicWebhookSettings(settings) })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') return res.status(403).json({ ok: false, error: 'La licencia fue revocada.' })
    console.error('Error en GET /api/auth/webhooks:', error)
    return res.status(500).json({ ok: false, error: 'No se pudo cargar la configuración de conexión.' })
  }
})

router.put('/webhooks', async (req, res) => {
  try {
    const client = await authorizeWebhookSettings(req, res)
    if (!client) return
    const current = await readWebhookSettings(client.id)
    if (!current) return res.status(404).json({ ok: false, error: 'No se encontró la configuración de esta licencia.' })

    const normalized = normalizeWebhookTargets(req.body || {}, current)
    if (!normalized.ok) return res.status(400).json({ ok: false, error: normalized.error, field: normalized.field || null })

    const { data: updated, error } = await supabase
      .from('clients')
      .update(normalized.patch)
      .eq('id', client.id)
      .eq('active', true)
      .select('id, webhook_url, webhook_url_2, webhook_url_3, webhook_secret, active, expires_at, role, store_only, device_id')
      .maybeSingle()
    if (error) throw error
    if (!updated) return res.status(403).json({ ok: false, error: 'La licencia dejó de estar activa. Vuelve a verificarla antes de guardar.' })

    const secured = await ensureWebhookSecret(updated)
    res.set('Cache-Control', 'no-store')
    return res.json({ ok: true, ...publicWebhookSettings(secured), message: normalized.configured ? 'Conexión guardada.' : 'Conexión desactivada.' })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') return res.status(403).json({ ok: false, error: 'La licencia fue revocada.' })
    console.error('Error en PUT /api/auth/webhooks:', error)
    return res.status(500).json({ ok: false, error: 'No se pudo guardar la configuración de conexión.' })
  }
})

router.post('/verify', async (req, res) => {
  try {
    await expireDueLicenses()
    const token = extractToken(req)
    const profile = normalizeClientProfile(req.body || {})

    if (!token) return res.status(400).json({ error: 'Token requerido' })

    await requireNonRevokedToken(token)

    const client = await fetchClientByToken(token)
    if (!client) return res.status(401).json({ error: 'Token inválido' })
    if (client.store_only) return res.status(403).json({ error: 'La sesión gratuita solo permite compras en la tienda oficial.', status: 'LICENSE_REQUIRED' })

    if (isExpired(client.expires_at)) {
      return res.status(403).json({ error: 'Licencia expirada', status: 'expired', client: publicClient({ ...client, active: false }) })
    }

    if (!client.active) {
      return res.status(403).json({ error: 'Licencia inactiva', status: 'inactive', client: publicClient(client) })
    }

    const deviceId = profile.device_id
    if (client.device_id && deviceId && client.device_id !== deviceId) {
      return res.status(403).json({ error: 'Token en uso', status: 'used', client: publicClient(client) })
    }

    if (client.phone_number && profile.phone_number && normalizePhone(client.phone_number) !== normalizePhone(profile.phone_number)) {
      return res.status(403).json({ error: 'Teléfono no autorizado', status: 'phone_mismatch', client: publicClient(client) })
    }

    if (client.token_used && !deviceId && !client.device_id) {
      return res.status(403).json({ error: 'Token en uso', status: 'used', client: publicClient(client) })
    }

    const patch = {
      token_used: true,
      ...profile,
    }

    if (deviceId && !client.device_id) patch.device_id = deviceId
    if (profile.phone_number) patch.phone_number = profile.phone_number
    if (profile.card1) patch.card1 = profile.card1
    if (profile.card2) patch.card2 = profile.card2
    if (profile.card3) patch.card3 = profile.card3
    if (profile.wallet) patch.wallet = profile.wallet

    const updated = await updateClient(client.id, patch)

    return res.status(200).json({
      ok: true,
      status: clientStatus(updated),
      client: publicClient(updated),
    })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') {
      return res.status(403).json({ error: 'Token revocado', status: 'REVOKED' })
    }
    console.error('Error en /api/auth/verify:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.get('/me', async (req, res) => {
  try {
    await expireDueLicenses()
    const token = extractToken(req)
    if (!token) return res.status(400).json({ error: 'Token requerido' })

    await requireNonRevokedToken(token)

    const client = await fetchClientByToken(token)
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })
    if (client.store_only) return res.status(403).json({ error: 'La sesión gratuita solo permite compras en la tienda oficial.', status: 'LICENSE_REQUIRED' })

    return res.json({ ok: true, status: clientStatus(client), client: publicClient(client) })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') {
      return res.status(403).json({ error: 'Token revocado', status: 'REVOKED' })
    }
    console.error('Error en /api/auth/me:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.put('/profile', async (req, res) => {
  try {
    await expireDueLicenses()
    const token = extractToken(req)
    const profile = normalizeClientProfileUpdate(req.body || {})
    if (!token) return res.status(400).json({ error: 'Token requerido' })

    await requireNonRevokedToken(token)

    const client = await fetchClientByToken(token)
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })
    if (client.store_only) return res.status(403).json({ error: 'La sesión gratuita solo permite compras en la tienda oficial.', status: 'LICENSE_REQUIRED' })

    if (!client.active) return res.status(403).json({ error: 'Licencia inactiva', status: 'inactive' })
    if (isExpired(client.expires_at)) return res.status(403).json({ error: 'Licencia expirada', status: 'expired' })

    if (client.device_id && profile.device_id && client.device_id !== profile.device_id) {
      return res.status(403).json({ error: 'Dispositivo no autorizado' })
    }

    if (client.device_id && !profile.device_id) {
      return res.status(400).json({ error: 'Dispositivo requerido' })
    }

    if (client.phone_number && profile.phone_number && normalizePhone(client.phone_number) !== normalizePhone(profile.phone_number)) {
      return res.status(403).json({ error: 'Teléfono no autorizado', status: 'phone_mismatch' })
    }

    if (profile.phone_number && !/^5\d{7}$/.test(normalizePhone(profile.phone_number))) {
      return res.status(400).json({ error: 'Número de teléfono inválido' })
    }
    for (const key of ['card1', 'card2', 'card3']) {
      if (profile[key] && !/^\d{4}-\d{4}$/.test(profile[key])) {
        return res.status(400).json({ error: `${key} debe tener formato XXXX-XXXX` })
      }
    }
    if (profile.wallet && !/^\d{8,12}$/.test(profile.wallet)) {
      return res.status(400).json({ error: 'Monedero inválido' })
    }

    const updated = await updateClient(client.id, profile)
    return res.json({ ok: true, client: publicClient(updated) })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') {
      return res.status(403).json({ error: 'Token revocado', status: 'REVOKED' })
    }
    console.error('Error en /api/auth/profile:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
