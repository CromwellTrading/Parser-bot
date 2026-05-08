const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const {
  normalizeClientProfile,
  publicClient,
  clientStatus,
} = require('../utils/clientProfile')

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expires = new Date(expiresAt)
  return !Number.isNaN(expires.getTime()) && expires < new Date()
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
    const { token } = req.body || {}
    const profile = normalizeClientProfile(req.body || {})

    if (!token) return res.status(400).json({ error: 'Token requerido' })

    const client = await fetchClientByToken(token)
    if (!client) return res.status(401).json({ error: 'Token inválido' })

    if (!client.active) {
      return res.status(403).json({ error: 'Licencia inactiva', status: 'inactive', client: publicClient(client) })
    }

    if (isExpired(client.expires_at)) {
      return res.status(403).json({ error: 'Licencia expirada', status: 'expired', client: publicClient(client) })
    }

    const deviceId = profile.device_id
    if (client.device_id && deviceId && client.device_id !== deviceId) {
      return res.status(403).json({ error: 'Token en uso', status: 'used', client: publicClient(client) })
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
    console.error('Error en /api/auth/verify:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.get('/me', async (req, res) => {
  try {
    const token = req.query.token || req.headers['x-client-token']
    if (!token) return res.status(400).json({ error: 'Token requerido' })

    const client = await fetchClientByToken(token)
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })

    return res.json({ ok: true, status: clientStatus(client), client: publicClient(client) })
  } catch (error) {
    console.error('Error en /api/auth/me:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.put('/profile', async (req, res) => {
  try {
    const { token } = req.body || {}
    const profile = normalizeClientProfile(req.body || {})
    if (!token) return res.status(400).json({ error: 'Token requerido' })

    const client = await fetchClientByToken(token)
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })

    if (client.device_id && profile.device_id && client.device_id !== profile.device_id) {
      return res.status(403).json({ error: 'Dispositivo no autorizado' })
    }

    const updated = await updateClient(client.id, profile)
    return res.json({ ok: true, client: publicClient(updated) })
  } catch (error) {
    console.error('Error en /api/auth/profile:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
