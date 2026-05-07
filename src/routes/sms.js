const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { verifySignature } = require('../utils/hmac')
const { parseSms } = require('../utils/parser')

function pickText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const str = String(value).trim()
    if (str) return str
  }
  return null
}

function normalizeReceivedAt(value) {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function buildSignatureCandidates(payload) {
  const candidates = [
    { sender: payload.sender, body: payload.body, receivedAt: payload.receivedAt, token: payload.token },
    { token: payload.token, sender: payload.sender, body: payload.body, receivedAt: payload.receivedAt },
    { sender: payload.sender, body: payload.body, received_at: payload.receivedAt, token: payload.token },
    { token: payload.token, sender: payload.sender, body: payload.body, received_at: payload.receivedAt },
    { origin: payload.sender, message: payload.body, receivedAt: payload.receivedAt, token: payload.token },
    { token: payload.token, origin: payload.sender, message: payload.body, receivedAt: payload.receivedAt }
  ]

  return candidates.map(candidate => JSON.stringify(candidate))
}

function verifyIncomingSignature(payload, token, signature) {
  if (!signature) return process.env.REQUIRE_SMS_SIGNATURE === 'true' ? false : true
  for (const candidate of buildSignatureCandidates(payload)) {
    if (verifySignature(candidate, token, signature)) return true
  }
  return false
}

router.post('/ingest', async (req, res) => {
  try {
    console.log('📨 SMS recibido:', JSON.stringify(req.body))

    const signature = req.headers['x-signature'] || req.headers['x-hmac'] || req.body.signature
    const sender = pickText(req.body.sender, req.body.origin, req.body.from, req.body.address)
    const body = pickText(req.body.body, req.body.message, req.body.text, req.body.sms)
    const token = pickText(req.body.token, req.body.clientToken, req.headers['x-client-token'])
    const receivedAtRaw = pickText(req.body.receivedAt, req.body.received_at, req.body.timestamp, req.body.date)

    if (!sender || !body || !token) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, active, token_used, expires_at, webhook_url, webhook_url_2, webhook_url_3')
      .eq('token', token)
      .single()

    if (clientError || !client) return res.status(401).json({ error: 'Token inválido' })
    if (!client.active) return res.status(403).json({ error: 'Licencia inactiva' })
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    const payloadForSignature = {
      sender,
      body,
      receivedAt: receivedAtRaw || null,
      token
    }

    if (!verifyIncomingSignature(payloadForSignature, token, signature)) {
      return res.status(401).json({ error: 'Firma inválida' })
    }

    const parsed = req.body.parsed && typeof req.body.parsed === 'object'
      ? req.body.parsed
      : parseSms(sender, body)

    console.log('🔍 Parseado:', JSON.stringify(parsed))

    const receivedAt = normalizeReceivedAt(receivedAtRaw)
    const { data: log, error: insertError } = await supabase
      .from('sms_logs')
      .insert({
        client_id: client.id,
        sender,
        body,
        received_at: receivedAt,
        parsed
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error guardando SMS:', insertError)
      return res.status(500).json({ error: 'Error interno' })
    }

    const webhooks = [client.webhook_url, client.webhook_url_2, client.webhook_url_3].filter(Boolean)
    if (webhooks.length > 0) {
      const webhookPayload = {
        event: 'SMS_RECEIVED',
        client: client.name,
        parsed,
        sender,
        received_at: receivedAt,
        log_id: log?.id
      }

      for (const url of webhooks) {
        sendWebhook(url, webhookPayload)
      }
    }

    console.log(`✅ SMS de "${client.name}" | ${parsed.direction} | ${parsed.type} | ${parsed.amount} ${parsed.currency}`)
    return res.status(200).json({ ok: true, parsed, log_id: log?.id })
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
