const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { verifySignature } = require('../utils/hmac')
const { parseSms } = require('../utils/parser')
const { pushInbox, patchInbox, listInbox } = require('../utils/inboxStore')

router.get('/inbox', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200)
  res.json(listInbox(limit))
})

router.post('/ingest', async (req, res) => {
  const signature = req.headers['x-signature']
  const inboxId = pushInbox({
    status: 'received',
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,
    payload: req.body,
    signature: signature || null
  })

  try {
    if (!signature) {
      patchInbox(inboxId, { status: 'rejected', error: 'Firma requerida' })
      return res.status(401).json({ error: 'Firma requerida' })
    }

    // El payload es el body como string para verificar firma
    const rawBody = JSON.stringify(req.body)
    const { sender, body, receivedAt, token } = req.body

    if (!sender || !body || !receivedAt || !token) {
      patchInbox(inboxId, { status: 'rejected', error: 'Datos incompletos' })
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // 1. Buscar cliente por token
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('token', token)
      .single()

    if (clientError || !client) {
      patchInbox(inboxId, { status: 'rejected', error: 'Token inválido', sender, body, receivedAt })
      return res.status(401).json({ error: 'Token inválido' })
    }

    // 2. Verificar que el cliente está activo
    if (!client.active) {
      patchInbox(inboxId, { status: 'rejected', error: 'Licencia inactiva', clientName: client.name, sender, body, receivedAt })
      return res.status(403).json({ error: 'Licencia inactiva' })
    }

    // 3. Verificar licencia no expirada
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      patchInbox(inboxId, { status: 'rejected', error: 'Licencia expirada', clientName: client.name, sender, body, receivedAt })
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    // 4. Verificar firma HMAC
    const validSignature = verifySignature(rawBody, token, signature)
    if (!validSignature) {
      patchInbox(inboxId, { status: 'rejected', error: 'Firma inválida', clientName: client.name, sender, body, receivedAt })
      return res.status(401).json({ error: 'Firma inválida' })
    }

    // 5. Parsear el SMS
    const parsed = parseSms(sender, body)

    // 6. Guardar en Supabase
    const { error: insertError } = await supabase
      .from('sms_logs')
      .insert({
        client_id: client.id,
        sender,
        body,
        received_at: new Date(receivedAt).toISOString(),
        parsed
      })

    if (insertError) {
      patchInbox(inboxId, { status: 'db_error', error: insertError.message, clientName: client.name, sender, body, receivedAt, parsed })
      console.error('Error guardando SMS:', insertError)
      return res.status(500).json({ error: 'Error interno' })
    }

    // 7. Reenviar al webhook del cliente si tiene configurado
    if (client.webhook_url) {
      sendWebhook(client.webhook_url, { parsed, sender, receivedAt, raw: req.body })
    }

    patchInbox(inboxId, {
      status: 'stored',
      clientName: client.name,
      sender,
      body,
      receivedAt,
      parsed
    })

    console.log(`✅ SMS recibido de cliente "${client.name}" | Tipo: ${parsed.type} | Monto: ${parsed.amount} ${parsed.currency}`)
    console.log('📦 RAW ENTRANTE:', JSON.stringify(req.body))

    return res.status(200).json({ ok: true, parsed, inboxId, raw: req.body })

  } catch (err) {
    patchInbox(inboxId, { status: 'error', error: err.message })
    console.error('Error en /ingest:', err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

// Envío de webhook en background (no bloquea la respuesta)
async function sendWebhook(url, data) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
  } catch (err) {
    console.error('Error enviando webhook:', err.message)
  }
}
  
module.exports = router
