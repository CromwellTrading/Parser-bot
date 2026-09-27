const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')
const { bot, ADMINS } = require('../telegram')
const { verifySignature } = require('../utils/hmac')
const { parseSms, normalizePhone } = require('../utils/parser')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { createEventId, ensureWebhookSecret, queueWebhookDeliveries } = require('../utils/webhookDelivery')

const MAX_SMS_AGE_MS = Number(process.env.MAX_SMS_AGE_MS || 30 * 24 * 60 * 60 * 1000)
const MAX_FUTURE_SKEW_MS = Number(process.env.MAX_SMS_FUTURE_SKEW_MS || 5 * 60 * 1000)
const MAX_BODY_CHARS = Number(process.env.MAX_SMS_BODY_CHARS || 20_000)

function digestFallback(sender, body, receivedAt, token) {
  return crypto
    .createHash('sha256')
    .update(`${token}::${sender}::${receivedAt}::${body}`)
    .digest('hex')
}

const { buildWebhookPayload } = require('../utils/webhookPayload')
async function sendTelegramAlert(parsed, sender, clientName, receivedIso) {
  if (parsed.amount == null) return

  const dir = parsed.direction === 'RECIBIDO' ? '📥 RECIBIDO' : '📤 ENVIADO'
  const amount = parsed.amount != null
    ? `💰 *${parsed.amount.toFixed(2)} ${parsed.currency ?? 'CUP'}*`
    : ''
  const type = parsed.type?.replace(/_/g, ' → ') ?? 'DESCONOCIDO'
  const date = new Date(receivedIso).toLocaleString('es-CU', { timeZone: 'America/Havana' })

  const remitente = parsed.sender_phone ?? null
  const receptor = parsed.receiver_phone ?? parsed.receiver_account ?? null

  const lines = [
    `${dir} — ${type}`,
    amount,
    remitente ? `👤 De: \`${remitente}\`` : null,
    receptor ? `👤 Para: \`${receptor}\`` : null,
    parsed.transaction_id ? `🔖 TX: \`${parsed.transaction_id}\`` : null,
    `🏪 Cliente: ${clientName}`,
    `🕐 ${date}`,
  ]

  const text = lines.filter(Boolean).join('\n')

  for (const adminId of ADMINS) {
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'Markdown' })
    } catch (err) {
      console.error(`Error enviando a admin ${adminId}:`, err.message)
    }
  }
}

function extractBearerToken(req) {
  const auth = String(req.headers.authorization || '')
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  return auth.slice(7).trim() || null
}

router.post('/ingest', async (req, res) => {
  try {
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {})
    const signature = req.headers['x-signature']
    if (!signature) return res.status(401).json({ error: 'Firma requerida' })

    const bodyJson = req.body || {}
    const token = bodyJson.token || extractBearerToken(req)
    const { sender, body, receivedAt, messageId, message_id: messageIdAlt, smsId, deviceId, phone_number: phoneNumber } = bodyJson

    if (!sender || typeof body !== 'string' || !receivedAt || !token) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }
    if (body.length > MAX_BODY_CHARS) {
      return res.status(413).json({ error: 'SMS demasiado largo' })
    }

    const receivedDate = new Date(receivedAt)
    if (Number.isNaN(receivedDate.getTime())) {
      return res.status(400).json({ error: 'receivedAt inválido' })
    }
    const now = Date.now()
    if (receivedDate.getTime() > now + MAX_FUTURE_SKEW_MS) {
      return res.status(400).json({ error: 'receivedAt en el futuro' })
    }
    if (now - receivedDate.getTime() > MAX_SMS_AGE_MS) {
      return res.status(400).json({ error: 'SMS demasiado antiguo' })
    }

    await requireNonRevokedToken(token)

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, token, active, token_used, device_id, phone_number, wallet, card1, card2, card3, expires_at, webhook_url, webhook_url_2, webhook_url_3, webhook_secret')
      .eq('token', token)
      .maybeSingle()

    if (clientError) {
      console.error('Error buscando cliente:', clientError)
      return res.status(500).json({ error: 'Error interno' })
    }
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })
    if (!client.active) return res.status(403).json({ error: 'Licencia inactiva' })
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    if (client.device_id && (!deviceId || client.device_id !== deviceId)) {
      return res.status(403).json({ error: 'Dispositivo no autorizado' })
    }
    if (client.phone_number && (!phoneNumber || normalizePhone(client.phone_number) !== normalizePhone(phoneNumber))) {
      return res.status(403).json({ error: 'Teléfono no autorizado' })
    }

    if (!verifySignature(rawBody, token, signature)) {
      return res.status(401).json({ error: 'Firma inválida' })
    }

    const parsed = parseSms(sender, body, receivedAt)
    const receivedIso = receivedDate.toISOString()
    const messageHash = messageId || messageIdAlt || smsId || digestFallback(sender, body, receivedIso, token)
    const eventId = createEventId({ clientId: client.id, sender, body, receivedAt: receivedIso })

    const { data: existing } = await supabase
      .from('sms_logs')
      .select('id, created_at')
      .eq('client_id', client.id)
      .eq('sender', sender)
      .eq('body', body)
      .eq('received_at', receivedIso)
      .maybeSingle()

    if (existing) {
      const webhookPayload = buildWebhookPayload(client, parsed, sender, body, receivedIso, eventId, existing.id, messageHash)
      let webhookClient = client
      if (client.webhook_url || client.webhook_url_2 || client.webhook_url_3) {
        webhookClient = await ensureWebhookSecret(client)
        await queueWebhookDeliveries({ client: webhookClient, payload: webhookPayload, eventId, logId: existing.id })
      }
      return res.status(200).json({ ok: true, duplicate: true, parsed, log_id: existing.id, event_id: eventId, status: 'QUEUED' })
    }

    const payload = {
      client_id: client.id,
      sender,
      body,
      received_at: receivedIso,
      parsed,
    }

    const { data: log, error: insertError } = await supabase
      .from('sms_logs')
      .insert(payload)
      .select('id, created_at')
      .single()

    if (insertError) {
      console.error('Error guardando SMS:', insertError)
      // If another request won a race and inserted the same SMS, locate the
      // winner and rebuild any missing webhook deliveries.
      if (insertError.code === '23505') {
        const { data: raced } = await supabase
          .from('sms_logs')
          .select('id, created_at')
          .eq('client_id', client.id)
          .eq('sender', sender)
          .eq('body', body)
          .eq('received_at', receivedIso)
          .maybeSingle()
        if (raced) {
          const webhookPayload = buildWebhookPayload(client, parsed, sender, body, receivedIso, eventId, raced.id, messageHash)
          if (client.webhook_url || client.webhook_url_2 || client.webhook_url_3) {
            const webhookClient = await ensureWebhookSecret(client)
            await queueWebhookDeliveries({ client: webhookClient, payload: webhookPayload, eventId, logId: raced.id })
          }
          return res.status(200).json({ ok: true, duplicate: true, parsed, log_id: raced.id, event_id: eventId, status: 'QUEUED' })
        }
      }
      return res.status(500).json({ error: 'Error interno' })
    }

    const webhookPayload = buildWebhookPayload(client, parsed, sender, body, receivedIso, eventId, log?.id, messageHash)
    const hasWebhooks = Boolean(client.webhook_url || client.webhook_url_2 || client.webhook_url_3)

    if (hasWebhooks) {
      const webhookClient = await ensureWebhookSecret(client)
      await queueWebhookDeliveries({ client: webhookClient, payload: webhookPayload, eventId, logId: log?.id })
    }

    sendTelegramAlert(parsed, sender, client.name, receivedIso)
      .catch(error => console.error('❌ Telegram alert:', error.message))

    console.log(`✅ SMS de "${client.name}" | ${parsed.direction} | ${parsed.type} | ${parsed.amount ?? '—'} ${parsed.currency ?? ''} | event=${eventId}`)
    return res.status(200).json({
      ok: true,
      parsed,
      log_id: log?.id,
      event_id: eventId,
      status: hasWebhooks ? 'QUEUED' : 'STORED',
    })
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') {
      return res.status(403).json({ error: 'Token revocado' })
    }
    console.error('❌ Error en /ingest:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
