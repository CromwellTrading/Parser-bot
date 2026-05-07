const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { buildClientProfilePatch, hasAnyProfileField } = require('../utils/clientProfile')

async function findClientByToken(token) {
  return supabase
    .from('clients')
    .select('id, name, active, token_used, token, phone_number, card1, card2, card3, wallet, created_at, expires_at')
    .eq('token', token)
    .single()
}

function requireToken(req, res) {
  const token = String(req.body?.token || '').trim()
  if (!token) {
    res.status(400).json({ error: 'Token requerido' })
    return null
  }
  return token
}

async function updateClientByToken(token, patch) {
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('token', token)
    .select('id, name, token, active, token_used, phone_number, card1, card2, card3, wallet, created_at, expires_at')
    .single()

  return { data, error }
}

router.post('/verify', async (req, res) => {
  const token = requireToken(req, res)
  if (!token) return

  const profilePatch = buildClientProfilePatch(req.body)

  const { data, error } = await findClientByToken(token)
  if (error || !data) return res.status(401).json({ error: 'Token inválido' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva' })
  if (data.token_used) return res.status(403).json({ error: 'Token en uso' })

  const { data: updated, error: updateError } = await updateClientByToken(token, {
    token_used: true,
    ...profilePatch
  })

  if (updateError) return res.status(500).json({ error: updateError.message })

  res.status(200).json({
    ok: true,
    client: updated,
    profile_saved: Object.keys(profilePatch).length > 0
  })
})

router.put('/profile', async (req, res) => {
  const token = requireToken(req, res)
  if (!token) return

  const profilePatch = buildClientProfilePatch(req.body)
  if (!hasAnyProfileField(req.body)) {
    return res.status(400).json({ error: 'Datos de perfil requeridos' })
  }

  const { data, error } = await findClientByToken(token)
  if (error || !data) return res.status(401).json({ error: 'Token inválido' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva' })

  const { data: updated, error: updateError } = await updateClientByToken(token, profilePatch)
  if (updateError) return res.status(500).json({ error: updateError.message })

  res.json({ ok: true, client: updated })
})

module.exports = router
