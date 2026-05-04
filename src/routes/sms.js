const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { verifySignature } = require('../utils/hmac')
const { parseSms } = require('../utils/parser')

/**
 * POST /api/sms/ingest
 * Recibe un SMS desde la app Android, valida el token y la firma,
 * parsea el contenido y lo guarda en Supabase.
 */
router.post('/ingest', async (req, res) => {
  try {
    const signature = req.headers['x-signature']
    if (!signature) {
      return res.status(401).json({ error: 'Firma requerida' })
    }

    // El payload es el body como string para verificar firma
    const rawBody = JSON.stringify(req.body)
    const { sender, body, receivedAt, token } = req.body

    if (!sender || !body || !receivedAt || !token) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // 1. Buscar cliente por token
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('token', token)
      .single()

    if (clientError || !client) {
      return res.status(401).json({ error: 'Token inválido' })
    }

    // 2. Verificar que el cliente está activo
    if (!client.active) {
      return res.status(403).json({ error: 'Licencia inactiva' })
    }

    // 3. Verificar licencia no expirada
    if (client.expires_at && new Date(client.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Licencia expirada' })
    }

    // 4. Verificar firma HMAC
    const validSignature = verifySignature(rawBody, token, signature)
    if (!validSignature) {
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
      console.error('Error guardando SMS:', insertError)
      return res.status(500).json({ error: 'Error interno' })
    }

    // 7. Reenviar al webhook del cliente si tiene configurado
    if (client.webhook_url) {
      sendWebhook(client.webhook_url, { parsed, sender, receivedAt })
    }

    console.log(`✅ SMS recibido de cliente "${client.name}" | Tipo: ${parsed.type} | Monto: ${parsed.amount} ${parsed.currency}`)

    return res.status(200).json({ ok: true, parsed })

  } catch (err) {
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
