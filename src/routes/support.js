const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { bot, ADMINS } = require('../telegram')

function extractToken(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}

async function getClient(req, res) {
  const token = extractToken(req)
  if (!token) {
    res.status(401).json({ error: 'Token requerido' })
    return null
  }
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, role, active, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: 'No se pudo validar el cliente' })
    return null
  }
  if (!data) {
    res.status(401).json({ error: 'Token inválido' })
    return null
  }
  return data
}

router.get('/messages', async (req, res) => {
  const client = await getClient(req, res)
  if (!client) return
  const rawLimit = Number(req.query.limit || 100)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 200)
  // Fetch the newest messages first so a long-running support conversation always
  // includes the latest answers, then reverse for chronological display in Android.
  const { data, error } = await supabase
    .from('support_messages')
    .select('id, client_id, sender_role, message, created_at, read_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: 'No se pudo cargar la bandeja' })
  const messages = (data || []).slice().reverse()

  const unreadIds = messages.filter(m => m.sender_role === 'admin' && !m.read_at).map(m => m.id)
  if (unreadIds.length) {
    const { error: readError } = await supabase.from('support_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds)
      .eq('client_id', client.id)
    if (readError) console.error('No se pudo marcar respuesta como leída:', readError.message)
  }
  res.set('Cache-Control', 'no-store')
  res.json({ ok: true, client_id: client.id, messages })
})

router.post('/messages', async (req, res) => {
  const client = await getClient(req, res)
  if (!client) return
  const message = String(req.body?.message || '').trim()
  if (!message) return res.status(400).json({ error: 'Escribe un mensaje' })
  if (message.length > 4000) return res.status(413).json({ error: 'El mensaje no puede superar 4000 caracteres' })

  // Small per-process rate limiter to reduce abuse without blocking real support.
  const { data: recent, error: recentError } = await supabase.from('support_messages')
    .select('id')
    .eq('client_id', client.id)
    .eq('sender_role', 'client')
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    .limit(8)
  if (recentError) return res.status(500).json({ error: 'No se pudo comprobar el límite de mensajes' })
  if ((recent || []).length >= 8) return res.status(429).json({ error: 'Espera un minuto antes de enviar más mensajes' })

  const { data, error } = await supabase.from('support_messages').insert({
    client_id: client.id,
    sender_role: 'client',
    message,
    created_at: new Date().toISOString(),
  }).select('id, client_id, sender_role, message, created_at, read_at').single()
  if (error) return res.status(500).json({ error: 'No se pudo enviar el mensaje' })
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'SUPPORT_MESSAGE_RECEIVED', client_id: client.id, message_id: data.id }))
  // Notify Telegram admins without making the client's request wait for Telegram.
  for (const adminId of ADMINS) {
    bot.sendMessage(adminId, `🆘 Nuevo mensaje de soporte\nCliente: ${client.name || client.id}\nMensaje: ${message.slice(0, 700)}`).catch(error => {
      console.error('No se pudo notificar soporte al admin:', error.message)
    })
  }
  res.status(201).json({ ok: true, message: data })
})

module.exports = router
