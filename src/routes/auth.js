// src/routes/auth.js
const express = require('express')
const router = express.Router()
const supabase = require('../supabase')

router.post('/verify', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Token requerido' })

  const { data, error } = await supabase
    .from('clients')
    .select('id, active, token_used')
    .eq('token', token)
    .single()

  if (error || !data) return res.status(401).json({ error: 'Token inválido' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva' })
  if (data.token_used) return res.status(403).json({ error: 'Token ya en uso' })

  // Marcar como en uso
  await supabase.from('clients').update({ token_used: true }).eq('token', token)

  res.status(200).json({ ok: true })
})

module.exports = router
