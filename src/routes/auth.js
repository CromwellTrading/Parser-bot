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

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expires = new Date(expiresAt)
  return !Number.isNaN(expires.getTime()) && expires < new Date()
}

function extractToken(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}

async function fetchClientByToken(token) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, token_used, device_id, phone_number, card1, card2, card3, wallet, webhook_url, webhook_url_2, webhook_url_3, created_at, expires_at')
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
    .select('id, name, token, active, token_used, device_id, phone_number, card1, card2, card3, wallet, webhook_url, webhook_url_2, webhook_url_3, created_at, expires_at')
    .single()

  if (error) throw error
  return data
}

router.post('/verify', async (req, res) => {
  try {
    await expireDueLicenses()
    const token = extractToken(req)
    const profile = normalizeClientProfile(req.body || {})

    if (!token) return res.status(400).json({ error: 'Token requerido' })

    await requireNonRevokedToken(token)

    const client = await fetchClientByToken(token)
    if (!client) return res.status(401).json({ error: 'Token inválido' })

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
