'use strict'

const express = require('express')
const crypto = require('crypto')
const supabase = require('../supabase')

const router = express.Router()

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('53')) digits = digits.slice(2)
  return /^5\d{7}$/.test(digits) ? digits : null
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex')
  const right = Buffer.from(String(b || ''), 'hex')
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)
}

function createClientPayload({ phone, deviceId, secretHash }) {
  return {
    name: `Tienda gratis ${phone}`,
    token: crypto.randomBytes(32).toString('hex'),
    webhook_secret: crypto.randomBytes(32).toString('hex'),
    webhook_url: null,
    webhook_url_2: null,
    webhook_url_3: null,
    phone_number: phone,
    card1: null,
    card2: null,
    card3: null,
    wallet: null,
    device_id: deviceId,
    expires_at: null,
    active: false,
    token_used: true,
    role: 'client',
    store_only: true,
    store_session_secret_hash: secretHash,
  }
}

router.post('/register', async (req, res) => {
  try {
    const deviceId = String(req.body?.device_id || req.body?.deviceId || '').trim()
    const phone = normalizePhone(req.body?.phone_number || req.body?.phoneNumber)
    const secret = String(req.body?.store_secret || req.body?.storeSecret || '').trim().toLowerCase()
    if (deviceId.length < 16 || deviceId.length > 160) {
      return res.status(400).json({ ok: false, error: 'Identificador de instalación inválido.' })
    }
    if (!phone) return res.status(400).json({ ok: false, error: 'Introduce un móvil cubano válido.' })
    if (!/^[a-f0-9]{64,128}$/.test(secret)) {
      return res.status(400).json({ ok: false, error: 'La clave de la sesión de tienda no es válida.' })
    }

    const secretHash = hashSecret(secret)
    const existingResult = await supabase.from('clients')
      .select('id, token, phone_number, device_id, store_session_secret_hash')
      .eq('store_only', true).eq('device_id', deviceId).maybeSingle()
    if (existingResult.error) throw existingResult.error

    if (existingResult.data) {
      const existing = existingResult.data
      if (!safeEqualHex(existing.store_session_secret_hash, secretHash)) {
        return res.status(403).json({ ok: false, error: 'Esta instalación ya tiene una sesión de tienda distinta. Por seguridad no se puede recuperar con solo el ID del dispositivo.' })
      }
      const { error: updateError } = await supabase.from('clients')
        .update({ phone_number: phone, name: `Tienda gratis ${phone}` })
        .eq('id', existing.id)
      if (updateError) throw updateError
      return res.json({ ok: true, store_only: true, store_token: existing.token, client_id: existing.id })
    }

    const { data: created, error: insertError } = await supabase.from('clients')
      .insert(createClientPayload({ phone, deviceId, secretHash }))
      .select('id, token')
      .single()
    if (insertError) {
      // A concurrent registration may have won the unique device index.
      if (insertError.code === '23505') {
        const { data: raced, error: raceError } = await supabase.from('clients')
          .select('id, token, store_session_secret_hash')
          .eq('store_only', true).eq('device_id', deviceId).maybeSingle()
        if (raceError) throw raceError
        if (raced && safeEqualHex(raced.store_session_secret_hash, secretHash)) {
          return res.json({ ok: true, store_only: true, store_token: raced.token, client_id: raced.id })
        }
        return res.status(409).json({ ok: false, error: 'No se pudo crear la sesión gratuita; vuelve a intentarlo.' })
      }
      throw insertError
    }

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'STORE_ONLY_SESSION_CREATED', client_id: created.id, device_hash: crypto.createHash('sha256').update(deviceId).digest('hex').slice(0, 12) }))
    return res.status(201).json({ ok: true, store_only: true, store_token: created.token, client_id: created.id })
  } catch (error) {
    console.error('[StoreSession] No se pudo registrar la sesión gratuita:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ ok: false, error: 'No se pudo preparar el acceso gratuito a las compras.' })
  }
})

module.exports = router
