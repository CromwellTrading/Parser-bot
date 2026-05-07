const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { verifySignature } = require('../utils/hmac')
const { parseSms, matchesCard } = require('../utils/parser')

router.post('/ingest', async (req, res) => {
  try {
    console.log('📨 SMS recibido:', JSON.stringify(req.body))
    const signature = req.headers['x-signature']
    if (!signature) return res.status(401).json({ error: 'Firma requerida' })

    const { sender, body, receivedAt, token } = req.body
    if (!sender || !body || !receivedAt || !token) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // 1. Buscar cliente con sus tarjetas
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('token', token)
      .single()

    if (clientError || !client) return res.status(401).json({ error: 'Token inválido' })
    if (!client.active) return res.status(403).json({ error: 'Licencia inactiva' })
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    // 2. Verificar firma HMAC
    const rawBody = JSON.stringify(req.body)
    if (!verifySignature(rawBody, token, signature)) {
      return res.status(401).json({ error: 'Firma inválida' })
    }

    // 3. Parsear SMS
    const parsed = parseSms(sender, body)
    console.log('🔍 Parseado:', JSON.stringify(parsed))

    // 4. Guardar en BD
    const { data: log, error: insertError } = await supabase
      .from('sms_logs')
      .insert({
        client_id: client.id,
        sender,
        body,
        received_at: new Date(receivedAt).toISOString(),
        parsed
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error guardando SMS:', insertError)
      return res.status(500).json({ error: 'Error interno' })
    }

    // 5. Enviar a webhooks del cliente (hasta 3)
    const webhooks = [client.webhook_url, client.webhook_url_2, client.webhook_url_3].filter(Boolean)
    if (webhooks.length > 0) {
      const webhookPayload = {
        event: 'SMS_RECEIVED',
        client: client.name,
        parsed,
        sender,
        received_at: new Date(receivedAt).toISOString(),
        log_id: log?.id
      }
      for (const url of webhooks) {
        sendWebhook(url, webhookPayload)
      }
    }

    console.log(`✅ SMS de "${client.name}" | ${parsed.direction} | ${parsed.type} | ${parsed.amount} ${parsed.currency}`)
    return res.status(200).json({ ok: true, parsed })

  } catch (err) {
    console.error('Error en /ingest:', err)
    return res.status(500).json({ error: 'Error interno' })
  }
})

async function sendWebhook(url, data) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    console.log(`📤 Webhook enviado a ${url}`)
  } catch (err) {
    console.error(`❌ Error webhook ${url}:`, err.message)
  }
}

module.exports = router
