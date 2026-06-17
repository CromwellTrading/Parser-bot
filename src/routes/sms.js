const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')
const { bot, ADMINS } = require('../telegram');
const { verifySignature } = require('../utils/hmac')
const { parseSms } = require('../utils/parser')

function digestFallback(sender, body, receivedAt, token) {
  return crypto
    .createHash('sha256')
    .update(`${token}::${sender}::${receivedAt}::${body}`)
    .digest('hex')
}

async function sendWebhook(url, data) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    console.log(`📤 Webhook enviado a ${url}`)
  } catch (error) {
    console.error(`❌ Error webhook ${url}:`, error.message)
  }
}

async function sendTelegramAlert(parsed, sender, clientName, receivedIso) {
  // Solo notificar si hay monto (es una transacción financiera)
  if (parsed.amount == null) return;

  const dir = parsed.direction === 'RECIBIDO' ? '📥 RECIBIDO' : '📤 ENVIADO';
  const amount = parsed.amount != null
    ? `💰 *${parsed.amount.toFixed(2)} ${parsed.currency ?? 'CUP'}*`
    : '';
  const type = parsed.type?.replace(/_/g, ' → ') ?? 'DESCONOCIDO';
  const date = new Date(receivedIso).toLocaleString('es-CU', { timeZone: 'America/Havana' });

  const remitente = parsed.sender_phone ?? null;
  const receptor = parsed.receiver_phone ?? parsed.receiver_account ?? null;

  const lines = [
    `${dir} — ${type}`,
    amount,
    remitente ? `👤 De: \`${remitente}\`` : null,
    receptor ? `👤 Para: \`${receptor}\`` : null,
    parsed.transaction_id ? `🔖 TX: \`${parsed.transaction_id}\`` : null,
    `🏪 Cliente: ${clientName}`,
    `🕐 ${date}`,
  ];

  const text = lines.filter(Boolean).join('\n');

  // Enviar a cada administrador
  for (const adminId of ADMINS) {
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`Error enviando a admin ${adminId}:`, err.message);
    }
  }
}

router.post('/ingest', async (req, res) => {
  try {
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {})
    console.log('📨 SMS recibido:', rawBody)

    const signature = req.headers['x-signature']
    if (!signature) return res.status(401).json({ error: 'Firma requerida' })

    const { sender, body, receivedAt, token, messageId, smsId, deviceId } = req.body || {}
    if (!sender || !body || !receivedAt || !token) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, token, active, token_used, device_id, expires_at, webhook_url, webhook_url_2, webhook_url_3')
      .eq('token', token)
      .maybeSingle()

    if (clientError) {
      console.error('Error buscando cliente:', clientError)
      return res.status(500).json({ error: 'Error interno' })
    }

    if (!client) return res.status(401).json({ error: 'Token inválido' })
    if (!client.active) return res.status(403).json({ error: 'Licencia inactiva' })
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    if (client.device_id && deviceId && client.device_id !== deviceId) {
      return res.status(403).json({ error: 'Dispositivo no autorizado' })
    }

    if (!verifySignature(rawBody, token, signature)) {
      return res.status(401).json({ error: 'Firma inválida' })
    }

    const parsed = parseSms(sender, body)
    const receivedIso = new Date(receivedAt).toISOString()
    const smsHash = messageId || smsId || digestFallback(sender, body, receivedIso, token)

    const { data: existing } = await supabase
      .from('sms_logs')
      .select('id')
      .eq('client_id', client.id)
      .eq('sender', sender)
      .eq('body', body)
      .eq('received_at', receivedIso)
      .maybeSingle()

    if (existing) {
      return res.status(200).json({ ok: true, duplicate: true, parsed, log_id: existing.id, status: 'SENT' })
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
      return res.status(500).json({ error: 'Error interno' })
    }

    const webhooks = [client.webhook_url, client.webhook_url_2, client.webhook_url_3].filter(Boolean)
    if (webhooks.length) {
      const webhookPayload = {
        event: 'SMS_RECEIVED',
        client: client.name,
        client_id: client.id,
        parsed,
        sender,
        received_at: receivedIso,
        log_id: log?.id,
        message_id: smsHash,
      }
      for (const url of webhooks) {
        sendWebhook(url, webhookPayload)
      }
    }

    // Notificación Telegram
    sendTelegramAlert(parsed, sender, client.name, receivedIso)

    console.log(`✅ SMS de "${client.name}" | ${parsed.direction} | ${parsed.type} | ${parsed.amount ?? '—'} ${parsed.currency ?? ''}`)
    return res.status(200).json({ ok: true, parsed, log_id: log?.id, status: 'SENT' })
  } catch (error) {
    console.error('Error en /ingest:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
