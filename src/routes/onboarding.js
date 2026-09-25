const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const supabase = require('../supabase')
const { verifySignature } = require('../utils/hmac')
const { parseSms } = require('../utils/parser')
const {
  evaluateLicensePayment,
  generateActivationCredentials,
  getLicenseConfig,
  hashActivationSecret,
  normalizeRegisteredPhone,
  paymentFingerprint,
} = require('../utils/onboarding')
const { bot, ADMINS } = require('../telegram')
const { evaluateActivationTiming } = require('../utils/onboarding')

const SESSION_TTL_HOURS = Number(process.env.ACTIVATION_SESSION_TTL_HOURS || 24)
const MAX_BOOTSTRAP_SMS_AGE_MS = Number(process.env.ACTIVATION_MAX_SMS_AGE_MS || 2 * 60 * 60 * 1000)
const MIN_BOOTSTRAP_GAP_MS = Number(process.env.ACTIVATION_MIN_BOOTSTRAP_GAP_MS || 2000)
const PAYMENT_WINDOW_MS = Number(process.env.ACTIVATION_PAYMENT_WINDOW_MS || 5 * 60 * 1000)
const CONFIRMATION_GRACE_MS = Number(process.env.ACTIVATION_CONFIRMATION_GRACE_MS || 15 * 60 * 1000)
const PAYMENT_CLOCK_SKEW_MS = Number(process.env.ACTIVATION_PAYMENT_CLOCK_SKEW_MS || 120000)
const CONFIG = getLicenseConfig()
const TRUSTED_SMS_SENDERS = [
  'PAGOMOVIL', 'PAGOxMOVIL', 'TRANSFERMOVIL', 'CUBACEL', 'ETECSA', 'BANDEC', 'BPA'
]

function isTrustedSmsSender(sender) {
  const value = String(sender || '').toUpperCase()
  return TRUSTED_SMS_SENDERS.some(item => value.includes(item.toUpperCase()))
}

function nowIso() {
  return new Date().toISOString()
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const d = new Date(expiresAt)
  return Number.isFinite(d.getTime()) && d < new Date()
}

function publicActivation(session, includeSecret = false) {
  if (!session) return null
  const result = {
    activation_id: session.activation_id,
    phone_number: session.phone_number,
    device_id: session.device_id,
    status: session.status,
    client_id: session.client_id || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    paid_at: session.paid_at || null,
    payment_started_at: session.payment_started_at || null,
    payment_deadline_at: session.payment_deadline_at || null,
    confirmation_deadline_at: session.confirmation_deadline_at || null,
    last_payment_reason: session.last_payment_reason || null,
    payment: {
      amount: CONFIG.amount,
      currency: CONFIG.currency,
      card: CONFIG.paymentCard || null,
      confirmation_phone: CONFIG.paymentPhone || null,
    },
  }
  if (includeSecret) result.activation_secret = includeSecret === true ? session.activation_secret : undefined
  return result
}

async function getSession(activationId) {
  const { data, error } = await supabase
    .from('license_activation_sessions')
    .select('*')
    .eq('activation_id', activationId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function updateSession(activationId, patch) {
  const { data, error } = await supabase
    .from('license_activation_sessions')
    .update({ ...patch, updated_at: nowIso() })
    .eq('activation_id', activationId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function notifyAdmins(text) {
  for (const adminId of ADMINS) {
    try {
      await bot.sendMessage(adminId, text, { parse_mode: 'Markdown' })
    } catch (error) {
      console.error(`Error Telegram admin ${adminId}:`, error.message)
    }
  }
}

async function createClientFromPayment(session, parsed, receivedIso) {
  const token = crypto.randomBytes(32).toString('hex')
  const webhookSecret = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + CONFIG.durationDays * 24 * 60 * 60 * 1000).toISOString()
  const name = `Cliente ${session.phone_number}`

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      name,
      token,
      webhook_secret: webhookSecret,
      webhook_url: null,
      webhook_url_2: null,
      webhook_url_3: null,
      phone_number: session.phone_number,
      card1: null,
      card2: null,
      card3: null,
      wallet: null,
      device_id: session.device_id,
      expires_at: expiresAt,
      active: true,
      token_used: true,
      role: 'client',
    })
    .select('*')
    .single()

  if (error) throw error

  return { client, expiresAt, token, receivedIso, parsed }
}

router.get('/config', (req, res) => {
  res.json({
    ok: true,
    configured: CONFIG.configured,
    payment: {
      amount: CONFIG.amount,
      currency: CONFIG.currency,
      card: CONFIG.paymentCard || null,
      confirmation_phone: CONFIG.paymentPhone || null,
      duration_days: CONFIG.durationDays,
      payment_window_ms: PAYMENT_WINDOW_MS,
      confirmation_grace_ms: CONFIRMATION_GRACE_MS,
    },
  })
})

router.post('/register', async (req, res) => {
  try {
    const phoneNumber = normalizeRegisteredPhone(req.body?.phone_number || req.body?.phoneNumber)
    const deviceId = String(req.body?.device_id || req.body?.deviceId || '').trim()

    if (!phoneNumber) return res.status(400).json({ error: 'Número de teléfono requerido' })
    if (!/^5\d{7}$/.test(phoneNumber)) return res.status(400).json({ error: 'Número de teléfono inválido' })
    if (!deviceId) return res.status(400).json({ error: 'Dispositivo requerido' })

    // A secret is intentionally returned only once. If the app registers again,
    // invalidate prior waiting sessions for this device/phone and issue fresh credentials.
    const { data: previous, error: previousError } = await supabase
      .from('license_activation_sessions')
      .select('activation_id')
      .eq('phone_number', phoneNumber)
      .eq('device_id', deviceId)
      .in('status', ['READY_TO_PAY', 'WAITING_PAYMENT', 'WAITING_LATE_CONFIRMATION'])
    if (previousError) throw previousError
    for (const item of previous || []) {
      await updateSession(item.activation_id, { status: 'EXPIRED' })
    }

    const { activationId, activationSecret, secretHash } = generateActivationCredentials()
    const { data: session, error } = await supabase
      .from('license_activation_sessions')
      .insert({
        activation_id: activationId,
        secret_hash: secretHash,
        phone_number: phoneNumber,
        device_id: deviceId,
        status: 'READY_TO_PAY',
        client_id: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        paid_at: null,
        payment_started_at: null,
        payment_deadline_at: null,
        confirmation_deadline_at: null,
        last_payment_reason: null,
        last_bootstrap_at: null,
      })
      .select('*')
      .single()

    if (error) throw error

    return res.status(201).json({
      ok: true,
      activation: {
        ...publicActivation(session),
        activation_secret: activationSecret,
      },
    })
  } catch (error) {
    console.error('Error en /api/onboarding/register:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/start', async (req, res) => {
  try {
    const session = await authorizeSession(req, res)
    if (!session) return
    if (!['READY_TO_PAY', 'WAITING_PAYMENT', 'WAITING_LATE_CONFIRMATION'].includes(session.status)) {
      return res.status(409).json({ error: 'Sesión no disponible para iniciar el pago', status: session.status })
    }

    if (session.status === 'READY_TO_PAY') {
      const started = Date.now()
      const paymentDeadline = started + PAYMENT_WINDOW_MS
      const confirmationDeadline = paymentDeadline + CONFIRMATION_GRACE_MS
      const updated = await updateSession(session.activation_id, {
        status: 'WAITING_PAYMENT',
        payment_started_at: new Date(started).toISOString(),
        payment_deadline_at: new Date(paymentDeadline).toISOString(),
        confirmation_deadline_at: new Date(confirmationDeadline).toISOString(),
        last_payment_reason: null,
      })
      return res.status(200).json({ ok: true, activation: publicActivation(updated) })
    }

    return res.status(200).json({ ok: true, activation: publicActivation(session) })
  } catch (error) {
    console.error('Error en /api/onboarding/start:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

async function authorizeSession(req, res) {
  const activationId = String(req.body?.activation_id || req.query?.activation_id || '').trim()
  const secret = String(req.headers['x-activation-secret'] || req.body?.activation_secret || req.query?.activation_secret || '').trim()
  if (!activationId || !secret) {
    res.status(401).json({ error: 'Credenciales de activación requeridas' })
    return null
  }

  const session = await getSession(activationId)
  if (!session) {
    res.status(404).json({ error: 'Sesión de activación no encontrada' })
    return null
  }

  const expectedHash = hashActivationSecret(secret)
  if (expectedHash !== session.secret_hash) {
    res.status(401).json({ error: 'Sesión de activación inválida' })
    return null
  }

  if (session.status === 'EXPIRED') {
    res.status(410).json({ error: 'Sesión expirada', status: 'EXPIRED' })
    return null
  }

  const confirmationDeadline = session.confirmation_deadline_at ? new Date(session.confirmation_deadline_at).getTime() : 0
  if (confirmationDeadline > 0 && Date.now() > confirmationDeadline && session.status !== 'ACTIVATED' && session.status !== 'READY_TO_PAY') {
    await updateSession(session.activation_id, { status: 'EXPIRED', last_payment_reason: 'CONFIRMATION_WINDOW_EXPIRED' })
    res.status(410).json({ error: 'Ventana de confirmación expirada', status: 'EXPIRED' })
    return null
  }

  const age = Date.now() - new Date(session.created_at).getTime()
  if (age > SESSION_TTL_HOURS * 60 * 60 * 1000 && session.status !== 'ACTIVATED') {
    await updateSession(session.activation_id, { status: 'EXPIRED' })
    res.status(410).json({ error: 'Sesión expirada', status: 'EXPIRED' })
    return null
  }

  return session
}

router.get('/status', async (req, res) => {
  try {
    const activationId = String(req.query?.activation_id || '').trim()
    const secret = String(req.headers['x-activation-secret'] || req.query?.activation_secret || '').trim()
    if (!activationId || !secret) return res.status(401).json({ error: 'Credenciales requeridas' })

    const session = await getSession(activationId)
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' })
    if (hashActivationSecret(secret) !== session.secret_hash) return res.status(401).json({ error: 'Sesión inválida' })

    const result = publicActivation(session)
    if (session.status === 'ACTIVATED' && session.client_id) {
      const { data: client, error } = await supabase
        .from('clients')
        .select('id, name, token, active, token_used, phone_number, device_id, expires_at, role')
        .eq('id', session.client_id)
        .maybeSingle()
      if (error) throw error
      if (client) {
        result.token = client.token
        result.client = {
          id: client.id,
          name: client.name,
          active: client.active,
          token_used: client.token_used,
          phone_number: client.phone_number,
          device_id: client.device_id,
          expires_at: client.expires_at,
          role: client.role,
        }
      }
    }

    return res.json({ ok: true, activation: result })
  } catch (error) {
    console.error('Error en /api/onboarding/status:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

router.post('/sms', async (req, res) => {
  try {
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {})
    const signature = String(req.headers['x-signature'] || '')
    if (!signature) return res.status(401).json({ error: 'Firma requerida' })

    const session = await authorizeSession(req, res)
    if (!session) return
    if (!['WAITING_PAYMENT', 'WAITING_LATE_CONFIRMATION', 'ACTIVATED'].includes(session.status)) {
      return res.status(200).json({ ok: true, activated: false, status: session.status, reason: 'PAYMENT_WINDOW_NOT_STARTED' })
    }

    const {
      activation_id: activationId,
      sender,
      body,
      receivedAt,
      messageId,
      smsId,
      deviceId,
      phone_number: phoneNumber,
    } = req.body || {}

    if (activationId !== session.activation_id) return res.status(400).json({ error: 'activation_id inválido' })
    if (!sender || !body || !receivedAt || !deviceId || !phoneNumber) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }
    if (!isTrustedSmsSender(sender)) {
      return res.status(400).json({ ok: true, activated: false, status: session.status, reason: 'UNTRUSTED_SMS_SENDER' })
    }
    if (deviceId !== session.device_id) return res.status(403).json({ error: 'Dispositivo no autorizado' })
    if (normalizeRegisteredPhone(phoneNumber) !== session.phone_number) return res.status(403).json({ error: 'Teléfono no autorizado' })

    const activationSecret = String(req.headers['x-activation-secret'] || req.body?.activation_secret || req.query?.activation_secret || '').trim()
    if (!verifySignature(rawBody, activationSecret, signature)) {
      return res.status(401).json({ error: 'Firma inválida' })
    }

    const receivedDate = new Date(receivedAt)
    if (Number.isNaN(receivedDate.getTime())) return res.status(400).json({ error: 'receivedAt inválido' })
    if (Date.now() - receivedDate.getTime() > MAX_BOOTSTRAP_SMS_AGE_MS) {
      return res.status(400).json({ ok: true, activated: false, status: session.status, reason: 'SMS_TOO_OLD' })
    }

    if (session.last_bootstrap_at) {
      const delta = Date.now() - new Date(session.last_bootstrap_at).getTime()
      if (delta < MIN_BOOTSTRAP_GAP_MS) return res.status(429).json({ error: 'Demasiadas solicitudes' })
    }
    await updateSession(session.activation_id, { last_bootstrap_at: nowIso() })

    if (session.status === 'ACTIVATED' && session.client_id) {
      const { data: client } = await supabase
        .from('clients').select('token, id, name, active, expires_at, phone_number, device_id, role')
        .eq('id', session.client_id).maybeSingle()
      return res.json({
        ok: true,
        activated: true,
        status: 'ACTIVATED',
        token: client?.token || null,
        client: client ? { id: client.id, name: client.name, active: client.active, expires_at: client.expires_at, phone_number: client.phone_number, device_id: client.device_id, role: client.role } : null,
      })
    }

    const receivedIso = receivedDate.toISOString()
    const parsed = parseSms(sender, body, receivedIso)
    const evaluation = evaluateLicensePayment(parsed, session, CONFIG)
    const timing = evaluateActivationTiming({
      paymentStartedAt: session.payment_started_at,
      paymentDeadlineAt: session.payment_deadline_at,
      confirmationDeadlineAt: session.confirmation_deadline_at,
      receivedAt: receivedIso,
      transactionAt: parsed.transaction_at,
      clockSkewMs: PAYMENT_CLOCK_SKEW_MS,
    })
    const timingMatched = timing.withinPaymentWindow && timing.receivedWithinConfirmationWindow
    const latePending = evaluation.matched && timing.lateUnknown
    const timingRejected = evaluation.matched && !timingMatched && !latePending
    const fingerprint = paymentFingerprint({ activationId: session.activation_id, sender, body, receivedAt: receivedIso, messageId, smsId })

    const { data: payment, error: paymentInsertError } = await supabase
      .from('license_payments')
      .insert({
        payment_key: fingerprint,
        activation_id: session.activation_id,
        client_id: null,
        sender,
        body,
        received_at: receivedIso,
        parsed,
        amount: parsed.amount,
        currency: parsed.currency,
        transaction_id: parsed.transaction_id,
        transaction_at: parsed.transaction_at,
        status: !evaluation.matched ? 'REJECTED' : (timingMatched ? 'PROCESSING' : (latePending ? 'PENDING_LATE' : 'REJECTED')),
        reason: !evaluation.matched ? evaluation.reason : (timingMatched ? evaluation.reason : (latePending ? 'PAYMENT_DETECTED_LATE_TIME_UNKNOWN' : `PAYMENT_TIMING_REJECTED:${timing.withinPaymentWindow ? 'CONFIRMATION_WINDOW' : 'OUTSIDE_PAYMENT_WINDOW'}`)),
        created_at: nowIso(),
      })
      .select('*')
      .single()

    if (paymentInsertError && paymentInsertError.code !== '23505') {
      console.error('Error guardando license_payment:', paymentInsertError)
      return res.status(500).json({ error: 'Error interno' })
    }

    // A retry/concurrent delivery of the same SMS must never mint a second token.
    if (paymentInsertError?.code === '23505') {
      const { data: existingPayment, error: existingPaymentError } = await supabase
        .from('license_payments')
        .select('*')
        .eq('payment_key', fingerprint)
        .maybeSingle()
      if (existingPaymentError) throw existingPaymentError
      if (existingPayment?.client_id) {
        const { data: existingClient } = await supabase
          .from('clients')
          .select('token, id, name, active, expires_at, phone_number, device_id, role')
          .eq('id', existingPayment.client_id)
          .maybeSingle()
        return res.json({
          ok: true,
          activated: true,
          status: 'ACTIVATED',
          token: existingClient?.token || null,
          activation_id: session.activation_id,
          payment_id: existingPayment.id,
          client: existingClient ? { id: existingClient.id, name: existingClient.name, active: existingClient.active, expires_at: existingClient.expires_at, phone_number: existingClient.phone_number, device_id: existingClient.device_id, role: existingClient.role } : null,
        })
      }
      if (existingPayment?.status === 'MATCHED' || existingPayment?.status === 'PROCESSING') {
        return res.json({ ok: true, activated: false, status: session.status, reason: 'PAYMENT_BEING_PROCESSED' })
      }
    }

    if (!evaluation.matched) {
      await updateSession(session.activation_id, { last_payment_reason: evaluation.reason })
      return res.json({
        ok: true,
        activated: false,
        status: session.status,
        reason: evaluation.reason,
        parsed,
        payment_id: payment?.id || null,
      })
    }

    if (latePending) {
      await updateSession(session.activation_id, { status: 'WAITING_LATE_CONFIRMATION', last_payment_reason: 'PAYMENT_DETECTED_LATE_TIME_UNKNOWN' })
      return res.json({
        ok: true,
        activated: false,
        status: 'WAITING_LATE_CONFIRMATION',
        reason: 'PAYMENT_DETECTED_LATE_TIME_UNKNOWN',
        parsed,
        payment_id: payment?.id || null,
      })
    }

    if (timingRejected || !timingMatched) {
      await updateSession(session.activation_id, { last_payment_reason: `PAYMENT_TIMING_REJECTED:${timing.withinPaymentWindow ? 'CONFIRMATION_WINDOW' : 'OUTSIDE_PAYMENT_WINDOW'}` })
      return res.json({
        ok: true,
        activated: false,
        status: session.status,
        reason: 'PAYMENT_TIMING_REJECTED',
        timing,
        parsed,
        payment_id: payment?.id || null,
      })
    }

    const paidAt = parsed.transaction_at || receivedIso
    const { client, expiresAt, token } = await createClientFromPayment(session, parsed, paidAt)

    await supabase
      .from('license_payments')
      .update({ client_id: client.id })
      .eq('payment_key', fingerprint)

    const activatedSession = await updateSession(session.activation_id, {
      status: 'ACTIVATED',
      client_id: client.id,
      paid_at: paidAt,
      last_payment_reason: evaluation.reason,
    })

    const { data: log, error: logError } = await supabase
      .from('sms_logs')
      .insert({
        client_id: client.id,
        sender,
        body,
        received_at: receivedIso,
        parsed: {
          ...parsed,
          license_payment: true,
          activation_id: session.activation_id,
        },
      })
      .select('id')
      .single()

    if (logError) console.error('Error guardando SMS inicial en sms_logs:', logError)

    await notifyAdmins(
      `✅ *Licencia activada automáticamente*\n\n` +
      `📱 Cliente: \`${session.phone_number}\`\n` +
      `💰 Pago: *${parsed.amount?.toFixed(2) || '—'} ${parsed.currency || ''}*\n` +
      `🔖 TX: \`${parsed.transaction_id || '—'}\`\n` +
      `🆔 Cliente ID: \`${client.id}\`\n` +
      `📅 Expira: ${new Date(expiresAt).toLocaleDateString('es-CU')}`
    )

    console.log(`✅ Activación automática: ${session.phone_number} → cliente ${client.id}`)

    return res.status(201).json({
      ok: true,
      activated: true,
      status: 'ACTIVATED',
      token,
      activation_id: activatedSession.activation_id,
      payment_id: payment?.id || null,
      log_id: log?.id || null,
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        expires_at: expiresAt,
        phone_number: client.phone_number,
        device_id: client.device_id,
        role: client.role,
      },
    })
  } catch (error) {
    console.error('Error en /api/onboarding/sms:', error)
    return res.status(500).json({ error: 'Error interno' })
  }
})

module.exports = router
