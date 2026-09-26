const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')
const { secretsMatch, getConfiguredAdminSecret } = require('../utils/adminAuth')
const { decryptActivationSecret } = require('../utils/activationSecretVault')

const ADMIN_SESSION_COOKIE = 'synthesisone_admin_session'
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000

router.use(express.urlencoded({ extended: false }))

function timingSafeHexMatch(a, b) {
  try {
    const aa = Buffer.from(String(a || ''), 'hex')
    const bb = Buffer.from(String(b || ''), 'hex')
    return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
  } catch (_) {
    return false
  }
}

function makeAdminSession(secret) {
  const ts = Date.now().toString()
  const mac = crypto.createHmac('sha256', secret).update(ts).digest('hex')
  return `${ts}.${mac}`
}

function getAdminCookie(req) {
  const raw = String(req.headers.cookie || '')
  const part = raw.split(';').map(v => v.trim()).find(v => v.startsWith(ADMIN_SESSION_COOKIE + '='))
  return part ? decodeURIComponent(part.slice(ADMIN_SESSION_COOKIE.length + 1)) : ''
}

function validAdminSession(req) {
  const configured = getConfiguredAdminSecret()
  if (!configured) return false
  const value = getAdminCookie(req)
  const [ts, mac] = value.split('.')
  const timestamp = Number(ts)
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 60 * 1000 || Date.now() - timestamp > ADMIN_SESSION_TTL_MS) return false
  const expected = crypto.createHmac('sha256', configured).update(String(ts)).digest('hex')
  return timingSafeHexMatch(mac, expected)
}

function panelHtml(req, loginError = '') {
  const authenticated = validAdminSession(req)
  let html = PANEL_HTML
    .replace('<div id="login">', `<div id="login" style="display:${authenticated ? 'none' : 'flex'}">`)
    .replace('<div id="dash">', `<div id="dash" style="display:${authenticated ? 'block' : 'none'}">`)
    .replace('<div class="err" id="login-err"></div>', `<div class="err" id="login-err" style="${loginError ? 'display:block' : ''}">${loginError}</div>`)
  const boot = `<script>window.PANEL_AUTHENTICATED=${authenticated ? 'true' : 'false'};</script>`
  html = html.replace('</head>', boot + '</head>')
  return html
}

router.get('/', (req, res) => res.send(panelHtml(req, String(req.query?.login || '') === 'error' ? 'Clave incorrecta' : '')))

router.post('/login', (req, res) => {
  const provided = String(req.body?.password || '').trim()
  if (!getConfiguredAdminSecret()) return res.redirect('/panel?login=error')
  if (!secretsMatch(provided)) return res.redirect('/panel?login=error')

  const cookie = makeAdminSession(getConfiguredAdminSecret())
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(cookie)}; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}; Path=/panel; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
  return res.redirect('/panel')
})

function clearAdminSession(res) {
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/panel; HttpOnly; SameSite=Lax`)
  res.redirect('/panel')
}

router.post('/logout', (req, res) => clearAdminSession(res))
router.get('/logout', (req, res) => clearAdminSession(res))

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (secretsMatch(secret) || validAdminSession(req)) return next()
  {
    if (!getConfiguredAdminSecret()) {
      return res.status(503).json({ error: 'Panel admin sin contraseña configurada' })
    }
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

router.use('/api', (req, res, next) => {
  // /api/auth/verify es llamado por la app Android — no requiere admin secret
  if (req.path === '/auth/verify') return next()
  adminAuth(req, res, next)
})

// Explicit panel authentication endpoint used by the web UI.
// It is behind adminAuth, so a successful response proves the password is accepted.
router.get('/api/auth/check', (req, res) => {
  res.json({ ok: true, authenticated: true })
})

// ── Clients CRUD ──────────────────────────────────────────────────────────────

const ONBOARDING_CLIENT_PREFIX = 'onboarding:'

function isExpiredDate(expiresAt) {
  if (!expiresAt) return false
  const date = new Date(expiresAt)
  return Number.isFinite(date.getTime()) && date < new Date()
}

async function getPendingOnboardingClients() {
  const { data, error } = await supabase
    .from('license_activation_sessions')
    .select('activation_id, phone_number, device_id, status, client_id, created_at, updated_at, paid_at, payment_started_at, payment_deadline_at, confirmation_deadline_at, last_payment_reason')
    .is('client_id', null)
    .in('status', ['READY_TO_PAY', 'WAITING_PAYMENT', 'WAITING_LATE_CONFIRMATION'])
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw error

  // No mostrar pre-registros que ya corresponden a un cliente activo y vigente.
  // Esto evita que el panel presente el mismo teléfono como "pendiente" y "registrado".
  const { data: activeClients, error: activeError } = await supabase
    .from('clients')
    .select('phone_number, active, expires_at')
    .eq('role', 'client')
    .eq('active', true)
    .limit(1000)
  if (activeError) throw activeError

  const activePhones = new Set(
    (activeClients || [])
      .filter(client => client.phone_number && !isExpiredDate(client.expires_at))
      .map(client => String(client.phone_number).trim())
  )

  return (data || []).filter(session => !activePhones.has(String(session.phone_number || '').trim())).map(session => ({
    id: `${ONBOARDING_CLIENT_PREFIX}${session.activation_id}`,
    name: `Cliente ${session.phone_number}`,
    token: null,
    active: false,
    token_used: false,
    webhook_url: null,
    webhook_url_2: null,
    webhook_url_3: null,
    phone_number: session.phone_number,
    card1: null,
    card2: null,
    card3: null,
    wallet: null,
    device_id: session.device_id,
    created_at: session.created_at,
    expires_at: null,
    role: 'client',
    webhook_secret: null,
    pending_activation: true,
    activation_status: session.status,
    payment_started_at: session.payment_started_at || null,
    payment_deadline_at: session.payment_deadline_at || null,
    confirmation_deadline_at: session.confirmation_deadline_at || null,
    last_payment_reason: session.last_payment_reason || null,
  }))
}

router.get('/api/clients/:id/details', async (req, res) => {
  try {
    const rawId = String(req.params.id || '')

    // A phone registration exists first as an onboarding session.
    // Show it in the admin panel before a real client/token is created.
    if (rawId.startsWith(ONBOARDING_CLIENT_PREFIX)) {
      const activationId = rawId.slice(ONBOARDING_CLIENT_PREFIX.length)
      if (!activationId) return res.status(404).json({ error: 'Sesión de activación no encontrada' })

      const { data: session, error: sessionError } = await supabase
        .from('license_activation_sessions')
        .select('activation_id, phone_number, device_id, status, client_id, created_at, updated_at, paid_at, payment_started_at, payment_deadline_at, confirmation_deadline_at, last_payment_reason, activation_secret_encrypted')
        .eq('activation_id', activationId)
        .maybeSingle()

      if (sessionError) throw sessionError
      if (!session) return res.status(404).json({ error: 'Sesión de activación no encontrada' })

      let activationSecret = null
      let activationSecretError = null
      if (session.activation_secret_encrypted) {
        try {
          activationSecret = decryptActivationSecret(session.activation_secret_encrypted)
        } catch (error) {
          activationSecretError = 'No se pudo descifrar la credencial. Verifica ACTIVATION_SECRET_ENCRYPTION_KEY.'
        }
      }

      let payment = null
      const { data: paymentData, error: paymentError } = await supabase
        .from('license_payments')
        .select('id, activation_id, client_id, sender, amount, currency, transaction_id, transaction_at, received_at, status, reason, created_at, parsed')
        .eq('activation_id', activationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (paymentError) throw paymentError
      payment = paymentData || null

      return res.json({
        client: {
          id: null,
          name: `Cliente ${session.phone_number}`,
          token: null,
          active: false,
          token_used: false,
          webhook_url: null,
          webhook_url_2: null,
          webhook_url_3: null,
          phone_number: session.phone_number,
          card1: null,
          card2: null,
          card3: null,
          wallet: null,
          device_id: session.device_id,
          created_at: session.created_at,
          expires_at: null,
          role: 'client',
          webhook_secret: null,
          pending_activation: true,
        },
        activation: {
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
          activation_secret: activationSecret,
          activation_secret_available: Boolean(session.activation_secret_encrypted),
          activation_secret_error: activationSecretError,
        },
        payment,
        payment_config: {
          amount: process.env.LICENSE_PRICE_AMOUNT ? Number(process.env.LICENSE_PRICE_AMOUNT) : null,
          currency: String(process.env.LICENSE_PRICE_CURRENCY || 'CUP').trim().toUpperCase(),
          card: String(process.env.LICENSE_PAYMENT_CARD || '').trim() || null,
          confirmation_phone: String(process.env.LICENSE_PAYMENT_PHONE || '').trim() || null,
        },
      })
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, token, active, token_used, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, created_at, expires_at, role, webhook_secret')
      .eq('id', req.params.id)
      .maybeSingle()

    if (clientError) throw clientError
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })

    let session = null
    if (client.id) {
      const { data, error } = await supabase
        .from('license_activation_sessions')
        .select('activation_id, phone_number, device_id, status, client_id, created_at, updated_at, paid_at, payment_started_at, payment_deadline_at, confirmation_deadline_at, last_payment_reason, activation_secret_encrypted')
        .eq('client_id', client.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      session = data || null
    }

    // Compatibility for older clients whose session was not linked to client_id.
    if (!session && client.phone_number && client.device_id) {
      const { data, error } = await supabase
        .from('license_activation_sessions')
        .select('activation_id, phone_number, device_id, status, client_id, created_at, updated_at, paid_at, payment_started_at, payment_deadline_at, confirmation_deadline_at, last_payment_reason, activation_secret_encrypted')
        .eq('phone_number', client.phone_number)
        .eq('device_id', client.device_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      session = data || null
    }

    let activationSecret = null
    let activationSecretError = null
    if (session?.activation_secret_encrypted) {
      try {
        activationSecret = decryptActivationSecret(session.activation_secret_encrypted)
      } catch (error) {
        activationSecretError = 'No se pudo descifrar la credencial. Verifica ACTIVATION_SECRET_ENCRYPTION_KEY.'
      }
    }

    let payment = null
    if (session?.activation_id) {
      const { data, error } = await supabase
        .from('license_payments')
        .select('id, activation_id, client_id, sender, amount, currency, transaction_id, transaction_at, received_at, status, reason, created_at, parsed')
        .eq('activation_id', session.activation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      payment = data || null
    }

    res.json({
      client,
      activation: session ? {
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
        activation_secret: activationSecret,
        activation_secret_available: Boolean(session.activation_secret_encrypted),
        activation_secret_error: activationSecretError,
      } : null,
      payment,
      payment_config: {
        amount: process.env.LICENSE_PRICE_AMOUNT ? Number(process.env.LICENSE_PRICE_AMOUNT) : null,
        currency: String(process.env.LICENSE_PRICE_CURRENCY || 'CUP').trim().toUpperCase(),
        card: String(process.env.LICENSE_PAYMENT_CARD || '').trim() || null,
        confirmation_phone: String(process.env.LICENSE_PAYMENT_PHONE || '').trim() || null,
      },
    })
  } catch (error) {
    console.error('Error en detalles de cliente:', error)
    res.status(500).json({ error: 'Error obteniendo detalles: ' + error.message })
  }
})

router.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, token, active, token_used, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, created_at, expires_at, role, webhook_secret')
      .order('created_at', { ascending: false })

    if (error) throw error

    const pending = await getPendingOnboardingClients()
    const combined = [...(data || []), ...pending]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

    res.json(combined)
  } catch (error) {
    console.error('Error listando clientes/sesiones:', error)
    res.status(500).json({ error: error.message })
  }
});

router.post('/api/clients', async (req, res) => {
  const { name, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, expires_at, plan, expires_in_days, role } = req.body
  if (!name) return res.status(400).json({ error: 'Nombre requerido' })

  const token = crypto.randomBytes(32).toString('hex')
  const webhookSecret = crypto.randomBytes(32).toString('hex')
  
  // Determinar expiración según rol
  const userRole = role || 'client' // por defecto cliente
  let finalExpiresAt = null
  if (userRole === 'admin') {
    // Administradores nunca expiran
    finalExpiresAt = null
  } else {
    const days = Number.isFinite(Number(expires_in_days)) ? Number(expires_in_days) : (plan === 'trial' ? 3 : 30)
    finalExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  }

  const payload = {
    name,
    token,
    webhook_secret: webhookSecret,
    webhook_url: webhook_url || null,
    webhook_url_2: webhook_url_2 || null,
    webhook_url_3: webhook_url_3 || null,
    phone_number: phone_number || null,
    card1: card1 || null,
    card2: card2 || null,
    card3: card3 || null,
    wallet: wallet || null,
    device_id: device_id || null,
    expires_at: finalExpiresAt,
    active: true,
    token_used: false,
    role: userRole,
  }

  const { data, error } = await supabase
    .from('clients').insert(payload).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.put('/api/clients/:id/toggle', async (req, res) => {
  const { data: client } = await supabase.from('clients').select('active, token').eq('id', req.params.id).single()
  if (!client) return res.status(404).json({ error: 'No encontrado' })

  const nowActive = !client.active

  if (!nowActive && client.token) {
    const { error: revokeError } = await supabase
      .from('token_blacklist')
      .delete().eq('token', client.token)
    if (revokeError) return res.status(500).json({ error: 'No se pudo preparar la revocación del token' })

    const { error: blacklistError } = await supabase
      .from('token_blacklist')
      .insert({
        token: client.token,
        client_id: req.params.id,
        reason: 'SUSPENDED_BY_ADMIN',
        invalidated_at: new Date().toISOString(),
      })
    if (blacklistError) return res.status(500).json({ error: 'No se pudo revocar el token' })
    console.log(`🔴 Token suspendido para cliente ${req.params.id}`)
  } else if (nowActive && client.token) {
    const { error: restoreError } = await supabase
      .from('token_blacklist')
      .delete().eq('token', client.token)
    if (restoreError) return res.status(500).json({ error: 'No se pudo restaurar el token' })
    console.log(`🟢 Token restaurado para cliente ${req.params.id}`)
  }

  const { data, error } = await supabase.from('clients').update({ active: nowActive }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/webhooks', async (req, res) => {
  const { webhook_url, webhook_url_2, webhook_url_3 } = req.body
  const { data, error } = await supabase
    .from('clients')
    .update({ webhook_url: webhook_url || null, webhook_url_2: webhook_url_2 || null, webhook_url_3: webhook_url_3 || null })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/profile', async (req, res) => {
  const { phone_number, card1, card2, card3, wallet, device_id } = req.body
  const patch = {
    phone_number: phone_number || null,
    card1: card1 || null,
    card2: card2 || null,
    card3: card3 || null,
    wallet: wallet || null,
    device_id: device_id || null,
  }
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/renew-token', async (req, res) => {
  const { data: client } = await supabase.from('clients').select('role, token').eq('id', req.params.id).single()
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' })

  // 1. Desactivar primero (igual que toggle → esto sí funciona en la app)
  await supabase.from('clients').update({ active: false }).eq('id', req.params.id)
  console.log(`🔴 Cliente desactivado antes de renovar ${req.params.id}`)

  // 2. Meter token viejo en blacklist
  if (client.token) {
    await supabase.from('token_blacklist').delete().eq('token', client.token)
    const { error: blacklistError } = await supabase
      .from('token_blacklist')
      .insert({
        token: client.token,
        client_id: req.params.id,
        reason: 'TOKEN_RENEWED',
        invalidated_at: new Date().toISOString(),
      })
    if (blacklistError) return res.status(500).json({ error: 'No se pudo invalidar el token anterior' })
    console.log(`🚫 Token viejo invalidado para cliente ${req.params.id}`)
  }

  // 3. Generar nuevo token y reactivar
  const newToken = crypto.randomBytes(32).toString('hex')
  const expiresInDays = Number.isFinite(Number(req.body?.expires_in_days)) ? Number(req.body.expires_in_days) : 30

  let expiresAt = null
  if (client.role === 'admin') {
    expiresAt = null
  } else {
    expiresAt = req.body?.expires_at || new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  }

  const { data, error } = await supabase
    .from('clients')
    .update({ token: newToken, token_used: false, device_id: null, expires_at: expiresAt, active: true })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  console.log(`🔄 Token renovado para cliente ${data.name}`)
  res.json(data)
})

router.delete('/api/clients/:id', async (req, res) => {
  try {
    // 1. Obtener el token del cliente
    const { data: client } = await supabase
      .from('clients')
      .select('token')
      .eq('id', req.params.id)
      .single();

    // 2. Desactivar primero (igual que toggle → esto sí funciona en la app)
    await supabase.from('clients').update({ active: false }).eq('id', req.params.id)
    console.log(`🔴 Cliente desactivado antes de eliminar ${req.params.id}`)

    // 3. Invalidar el token en blacklist
    if (client?.token) {
      await supabase.from('token_blacklist').delete().eq('token', client.token)
      const { error: blacklistError } = await supabase
        .from('token_blacklist')
        .insert({
          token: client.token,
          client_id: req.params.id,
          reason: 'CLIENT_DELETED',
          invalidated_at: new Date().toISOString(),
        });
      
      if (blacklistError) throw new Error(`No se pudo invalidar token antes de eliminar: ${blacklistError.message}`)
      console.log(`✅ Token invalidado para cliente ${req.params.id}`)
    }

    // 4. Eliminar logs del cliente
    await supabase
      .from('sms_logs')
      .delete()
      .eq('client_id', req.params.id);

    // 5. Eliminar el cliente
    const { error: deleteError } = await supabase
      .from('clients')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;

    console.log(`✅ Cliente ${req.params.id} eliminado correctamente`);
    res.json({ ok: true, message: 'Cliente eliminado y token invalidado' });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/activations', async (req, res) => {
  const { status, limit = 100 } = req.query
  let query = supabase
    .from('license_activation_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(parseInt(limit) || 100, 250))
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.get('/api/logs', async (req, res) => {
  const { client_id, limit = 50 } = req.query
  let query = supabase
    .from('sms_logs').select('*, clients(name)')
    .order('created_at', { ascending: false }).limit(parseInt(limit))
  if (client_id) query = query.eq('client_id', client_id)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── Auth verify (used by Android app) ────────────────────────────────────────

router.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Token requerido' })

  // 🔒 Verificar blacklist (tokens eliminados, renovados o suspendidos)
  const { data: blacklisted } = await supabase
    .from('token_blacklist').select('token').eq('token', token).maybeSingle()
  if (blacklisted) return res.status(403).json({ error: 'Token revocado', status: 'REVOKED' })

  const { data, error } = await supabase
    .from('clients').select('id, active, token_used').eq('token', token).single()
  if (error || !data) return res.status(404).json({ error: 'Token inválido', status: 'REVOKED' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva', status: 'REVOKED' })
  if (data.token_used) return res.status(403).json({ error: 'Token en uso', status: 'USED' })
  await supabase.from('clients').update({ token_used: true }).eq('token', token)
  res.status(200).json({ ok: true })
})

// ── HTML ──────────────────────────────────────────────────────────────────────

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SynthesisOne</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#1a1a24;--border:#1e1e2e;
  --red:#cc0033;--purple:#7b2fbe;--green:#00c853;--error:#ff1744;
  --text:#e8e8f0;--muted:#555570;--text2:#9999bb;
}
body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;min-height:100vh}
.badge-role{background:#0088ff22;color:#4db8ff}
/* LOGIN */
#login{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 0%,#cc003318 0%,transparent 60%)}
.login-box{width:100%;max-width:420px;padding:48px 40px;background:var(--surface);
  border:1px solid var(--border);position:relative}
.login-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),var(--purple))}
.logo{font-size:10px;letter-spacing:4px;color:var(--red);font-family:'Space Mono',monospace;margin-bottom:28px}
.login-box h1{font-size:26px;font-weight:800;margin-bottom:6px}
.login-box p{color:var(--muted);font-size:14px;margin-bottom:32px}
input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);
  padding:14px 16px;font-family:'Space Mono',monospace;font-size:13px;outline:none;
  transition:border-color .2s;border-radius:4px}
input:focus{border-color:var(--red)}
input::placeholder{color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:13px 24px;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;
  cursor:pointer;border:none;border-radius:4px;transition:all .2s;letter-spacing:.5px}
.btn-primary{background:linear-gradient(90deg,var(--red),var(--purple));color:#fff;width:100%;margin-top:14px}
.btn-primary:hover{opacity:.9}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-sm{padding:7px 14px;font-size:11px;font-family:'Space Mono',monospace}
.btn-green{background:#00c85322;color:var(--green);border:1px solid #00c85344}
.btn-green:hover{background:#00c85333}
.btn-red{background:#ff174422;color:var(--error);border:1px solid #ff174444}
.btn-red:hover{background:#ff174433}
.btn-blue{background:#0088ff22;color:#4db8ff;border:1px solid #0088ff44}
.btn-blue:hover{background:#0088ff33}
.btn-purple{background:#7b2fbe22;color:var(--purple);border:1px solid #7b2fbe44}
.btn-purple:hover{background:#7b2fbe33}
.err{color:var(--error);font-size:12px;font-family:'Space Mono',monospace;margin-top:10px;display:none}

/* DASHBOARD */
#dash{display:none}
header{background:var(--surface);border-bottom:1px solid var(--border);
  padding:16px 24px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:10}
.h-logo{font-size:10px;letter-spacing:3px;color:var(--red);font-family:'Space Mono',monospace}
.h-right{display:flex;align-items:center;gap:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);
  box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.dot-label{font-size:11px;color:var(--muted);font-family:'Space Mono',monospace}

main{padding:24px;max-width:1100px;margin:0 auto}


input, select {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 14px 16px;
  font-family: 'Space Mono', monospace;
  font-size: 13px;
  outline: none;
  transition: border-color .2s;
  border-radius: 4px;
  appearance: none;
  -webkit-appearance: none;
  height: auto;
  line-height: normal;
  cursor: pointer;
}
input:focus, select:focus {
  border-color: var(--red);
}
input::placeholder {
  color: var(--muted);
}

/* TABS */
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:28px}
.tab{padding:12px 20px;font-size:11px;font-weight:700;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--muted);cursor:pointer;
  border-bottom:2px solid transparent;transition:all .2s}
.tab.on{color:var(--red);border-bottom-color:var(--red)}

/* STATS */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
.stat{background:var(--surface);border:1px solid var(--border);padding:20px 18px;position:relative;border-radius:4px}
.stat::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),transparent)}
.stat-label{font-size:9px;letter-spacing:2px;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:10px;text-transform:uppercase}
.stat-val{font-size:32px;font-weight:800;color:var(--red)}

/* SECTION */
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px}
.sec-title{font-size:10px;letter-spacing:2px;color:var(--muted);font-family:'Space Mono',monospace;text-transform:uppercase}

/* FORM */
.form-panel{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  padding:20px;margin-bottom:20px;display:none}
.form-panel.open{display:block}
.form-row{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:stretch}
.form-row .btn-primary { align-self: center; }
@media(max-width:600px){.form-row{grid-template-columns:1fr}}
label{display:block;font-size:9px;letter-spacing:2px;color:var(--muted);
  font-family:'Space Mono',monospace;margin-bottom:6px;text-transform:uppercase}

/* TABLE */
.tbl-wrap{background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:600px}
th{text-align:left;padding:12px 16px;font-size:9px;letter-spacing:2px;color:var(--muted);
  font-family:'Space Mono',monospace;border-bottom:1px solid var(--border);background:var(--bg);text-transform:uppercase}
td{padding:14px 16px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff04}
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
  font-size:10px;font-family:'Space Mono',monospace;border-radius:2px}
.badge-on{background:#00c85320;color:var(--green)}
.badge-off{background:#ff174420;color:var(--error)}
.badge-used{background:#7b2fbe20;color:var(--purple)}
.token-cell{font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);
  cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.token-cell:hover{color:var(--text)}
.acts{display:flex;gap:6px;flex-wrap:wrap}
.client-search{max-width:420px;margin-bottom:14px}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}
.detail-item{background:var(--bg);border:1px solid var(--border);padding:11px 12px;border-radius:4px;min-width:0}
.detail-item.full{grid-column:1 / -1}
.detail-key{font-size:8px;letter-spacing:1.5px;color:var(--muted);font-family:'Space Mono',monospace;text-transform:uppercase;margin-bottom:5px}
.detail-val{font-size:11px;color:var(--text2);font-family:'Space Mono',monospace;word-break:break-word}
.detail-val.secret{color:#7ee787}
@media(max-width:600px){.detail-grid{grid-template-columns:1fr}.detail-item.full{grid-column:auto}}

/* MODAL */
.modal-bg{position:fixed;inset:0;background:#000000cc;display:flex;align-items:center;
  justify-content:center;z-index:100;display:none;padding:16px}
.modal-bg.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  padding:28px;width:100%;max-width:480px;position:relative}
.modal::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),var(--purple))}
.modal h3{font-size:18px;font-weight:800;margin-bottom:20px}
.modal-footer{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.inp-group{margin-bottom:14px}

/* LOGS */
.log-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  border-left:3px solid var(--red);padding:16px 18px;margin-bottom:10px}
.log-card.enviado{border-left-color:var(--purple)}
.log-card.desconocido{border-left-color:var(--muted)}
.log-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.log-amount{font-size:22px;font-weight:800;color:var(--red)}
.log-amount.enviado{color:var(--purple)}
.log-time{font-size:11px;color:var(--muted);font-family:'Space Mono',monospace}
.log-client{font-size:11px;color:#4db8ff;font-family:'Space Mono',monospace;margin-bottom:4px}
.log-type{font-size:10px;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:8px}
.log-body{font-size:12px;color:var(--text2);line-height:1.6;font-family:'Space Mono',monospace}
.empty{padding:48px 20px;text-align:center;color:var(--muted);font-family:'Space Mono',monospace;font-size:12px}

/* TOAST */
#toast{position:fixed;bottom:24px;right:24px;background:var(--green);color:#000;
  padding:12px 20px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;
  opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none;z-index:200;border-radius:4px}
#toast.show{opacity:1;transform:translateY(0)}
#toast.err{background:var(--error);color:#fff}

.loading{color:var(--muted);font-family:'Space Mono',monospace;font-size:12px;padding:40px;text-align:center}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="login">
  <div class="login-box">
    <div class="logo">SYNTHESISONE</div>
    <h1>Panel Admin</h1>
    <p>Acceso restringido</p>
    <form id="login-form" method="post" action="/panel/login" autocomplete="off">
      <input type="password" id="sec-in" name="password" placeholder="Clave de administrador" autocomplete="current-password" />
      <button type="submit" class="btn btn-primary" id="login-btn">Acceder →</button>
    </form>
    <div class="err" id="login-err"></div>
    <div id="login-status" style="margin-top:10px;color:var(--muted);font-family:'Space Mono',monospace;font-size:11px;min-height:16px"></div>
  </div>
</div>

<!-- DASHBOARD -->
<div id="dash">
  <header>
    <div class="h-logo">SYNTHESISONE / ADMIN</div>
    <div class="h-right">
      <div class="dot"></div>
      <span class="dot-label">Online</span>
      <button class="btn btn-sm btn-red" onclick="logout()">Salir</button>
    </div>
  </header>

  <main>
    <div class="stats">
      <div class="stat"><div class="stat-label">Activos</div><div class="stat-val" id="s-active">—</div></div>
      <div class="stat"><div class="stat-label">Total</div><div class="stat-val" id="s-total">—</div></div>
      <div class="stat"><div class="stat-label">SMS hoy</div><div class="stat-val" id="s-sms">—</div></div>
    </div>

    <div class="tabs">
      <div class="tab on" onclick="tab('clients')">Clientes</div>
      <div class="tab" onclick="tab('logs')">SMS Logs</div>
    </div>

    <!-- CLIENTES -->
    <div id="tab-clients">
      <div class="sec-head">
        <span class="sec-title">Licencias</span>
        <button class="btn btn-sm btn-green" onclick="toggleForm()">+ Nuevo</button>
      </div>

      <div class="form-panel" id="new-form">
  <div class="form-row">
    <div class="inp-group" style="margin:0">
      <label>Nombre del cliente</label>
      <input type="text" id="new-name" placeholder="Ej: Juan Pérez" />
    </div>
    <div class="inp-group" style="margin:0">
      <label>Rol</label>
      <select id="new-role">
        <option value="client">Cliente</option>
        <option value="admin">Administrador</option>
      </select>
    </div>
    <button class="btn btn-primary btn-sm" style="margin:0;width:auto" onclick="createClient()">Crear</button>
  </div>
</div>

      <input class="client-search" id="client-search" placeholder="Buscar por nombre, teléfono, cuenta o device ID…" oninput="filterClients()" />

      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Rol</th><th>Token</th><th>Estado</th><th>Token</th><th>Creado</th><th>Acciones</th>
          </tr></thead>
          <tbody id="clients-tb"><tr><td colspan="7"><div class="loading">Cargando...</div></td></tr></tbody>
          </table>
      </div>
    </div>

    <!-- LOGS -->
    <div id="tab-logs" style="display:none">
      <div class="sec-head">
        <span class="sec-title">SMS Recibidos</span>
        <button class="btn btn-sm btn-blue" onclick="loadLogs()">↻ Actualizar</button>
      </div>
      <div id="logs-cont"><div class="loading">Cargando...</div></div>
    </div>
  </main>
</div>

<!-- MODAL WEBHOOKS -->
<div class="modal-bg" id="wh-modal">
  <div class="modal">
    <h3>Webhooks del cliente</h3>
    <input type="hidden" id="wh-client-id" />
    <div class="inp-group"><label>Webhook 1</label><input type="url" id="wh-1" placeholder="https://..." /></div>
    <div class="inp-group"><label>Webhook 2 (opcional)</label><input type="url" id="wh-2" placeholder="https://..." /></div>
    <div class="inp-group"><label>Webhook 3 (opcional)</label><input type="url" id="wh-3" placeholder="https://..." /></div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-sm" style="width:auto" onclick="saveWebhooks()">Guardar</button>
      <button class="btn btn-sm btn-red" onclick="closeModal('wh-modal')">Cancelar</button>
    </div>
  </div>
</div>

<!-- MODAL INFO CLIENTE -->
<div class="modal-bg" id="info-modal">
  <div class="modal">
    <h3 id="info-name"></h3>
    <div id="info-body" style="font-family:'Space Mono',monospace;font-size:12px;line-height:1.8;color:var(--text2)"></div>
    <div class="modal-footer">
      <button class="btn btn-sm btn-red" onclick="closeModal('info-modal')">Cerrar</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
let SECRET = ''

// ── Auth ──────────────────────────────────────────────────────────────────────
async function login(event) {
  if (event) {
    // Let the native POST /panel/login handle authentication. This works even if
    // the WebView/browser blocks the JavaScript fetch path.
    if (!event.submitter || event.submitter.type === 'submit') {
      const input = document.getElementById('sec-in')
      const err = document.getElementById('login-err')
      const status = document.getElementById('login-status')
      const s = String(input?.value || '').trim()
      err.style.display = 'none'
      err.textContent = ''
      status.textContent = ''
      if (!s) {
        event.preventDefault()
        err.textContent = 'Introduce la contraseña de administrador'
        err.style.display = 'block'
        return
      }
      status.textContent = 'Comprobando…'
      return
    }
  }
}

function logout() {
  window.location.href = '/panel/logout'
}

const loginForm = document.getElementById('login-form')
if (loginForm) loginForm.addEventListener('submit', login)

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, opts={}) {
  const r = await fetch('/panel/api'+path, {
    ...opts,
    cache: 'no-store',
    headers:{'Content-Type':'application/json','x-admin-secret':SECRET,...(opts.headers||{})}
  })
  const text = await r.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch (_) {
    data = { error: text || ('HTTP ' + r.status) }
  }
  if (!r.ok && !data.error) data.error = 'HTTP ' + r.status
  return data
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadAll() { await Promise.all([loadClients(), loadLogs()]) }
if (window.PANEL_AUTHENTICATED) { loadAll().catch(e => console.error('Error cargando panel:', e)) }

let CLIENTS = []

async function loadClients() {
  try {
    const clients = await api('/clients')
    if (!Array.isArray(clients)) {
      const msg = clients?.error || 'No se pudieron cargar los clientes'
      document.getElementById('clients-tb').innerHTML = '<tr><td colspan="7"><div class="empty">' + escapeHtml(msg) + '</div></td></tr>'
      document.getElementById('s-total').textContent = '—'
      document.getElementById('s-active').textContent = '—'
      return
    }
    CLIENTS = clients
    document.getElementById('s-total').textContent = clients.length
    document.getElementById('s-active').textContent = clients.filter(c=>c.active).length
    renderClients(clients)
  } catch (error) {
    console.error('Error cargando clientes:', error)
    document.getElementById('clients-tb').innerHTML = '<tr><td colspan="7"><div class="empty">Error cargando clientes</div></td></tr>'
  }
}

function filterClients() {
  const q = (document.getElementById('client-search')?.value || '').trim().toLowerCase()
  if (!q) return renderClients(CLIENTS)
  renderClients(CLIENTS.filter(c => [c.name, c.phone_number, c.wallet, c.card1, c.card2, c.card3, c.device_id, c.id, c.activation_status].filter(Boolean).some(v => String(v).toLowerCase().includes(q))))
}

async function loadLogs() {
  try {
    const logs = await api('/logs?limit=100')
    document.getElementById('s-sms').textContent = Array.isArray(logs) ? logs.length : '—'
    renderLogs(logs)
  } catch (error) {
    console.error('Error cargando logs:', error)
    document.getElementById('s-sms').textContent = '—'
    renderLogs([])
  }
}

// ── Clients ───────────────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderClients(clients) {
  const tb = document.getElementById('clients-tb')
  if (!Array.isArray(clients) || !clients.length) {
    tb.innerHTML='<tr><td colspan="7"><div class="empty">Sin clientes</div></td></tr>'
    return
  }

  tb.innerHTML = clients.map(function(c) {
    const pending = c.pending_activation === true
    const roleLabel = pending ? 'Pre-registro' : (c.role === 'admin' ? 'Admin' : 'Cliente')
    const tokenText = c.token ? String(c.token).slice(0,12) + '...' : '—'

    let statusText
    if (pending) {
      if (c.activation_status === 'WAITING_PAYMENT') statusText = '◌ ESPERANDO PAGO'
      else if (c.activation_status === 'WAITING_LATE_CONFIRMATION') statusText = '◌ CONFIRMACIÓN TARDÍA'
      else statusText = '◌ LISTO PARA PAGAR'
    } else {
      statusText = c.active ? '● ACTIVO' : '○ INACTIVO'
    }

    const id = escapeHtml(c.id)
    const name = escapeHtml(c.name || '')
    const phone = escapeHtml(c.phone_number || '')
    const token = escapeHtml(c.token || '')
    const role = escapeHtml(roleLabel)
    const created = c.created_at ? new Date(c.created_at).toLocaleDateString('es') : '—'

    let actionButtons
    if (pending) {
      actionButtons = '<button class="btn btn-sm btn-blue" data-id="' + id + '" onclick="showInfo(this.dataset.id)">Detalles</button>'
    } else {
      const activeClass = c.active ? 'btn-red' : 'btn-green'
      const activeText = c.active ? 'Desactivar' : 'Activar'
      actionButtons =
        '<button class="btn btn-sm ' + activeClass + '" data-id="' + id + '" onclick="toggle(this.dataset.id)">' + activeText + '</button>' +
        '<button class="btn btn-sm btn-blue" data-id="' + id + '" onclick="openWebhooksById(this.dataset.id)">Webhooks</button>' +
        '<button class="btn btn-sm btn-purple" data-id="' + id + '" onclick="renewToken(this.dataset.id, this.dataset.name)" data-name="' + name + '">↺ Token</button>' +
        '<button class="btn btn-sm btn-blue" data-id="' + id + '" onclick="showInfo(this.dataset.id)">Detalles</button>' +
        '<button class="btn btn-sm btn-red" data-id="' + id + '" onclick="deleteClient(this.dataset.id, this.dataset.name)" data-name="' + name + '">Eliminar</button>'
    }

    const tokenCell = c.token
      ? '<div class="token-cell" data-token="' + token + '" onclick="copyT(this.dataset.token)" title="Click para copiar">' + tokenText + '</div>'
      : '<div class="token-cell">—</div>'

    const tokenBadge = pending ? 'SIN TOKEN' : (c.token_used ? 'EN USO' : 'LIBRE')
    const tokenBadgeClass = pending ? 'badge-off' : (c.token_used ? 'badge-used' : 'badge-on')
    const statusClass = pending ? 'badge-off' : (c.active ? 'badge-on' : 'badge-off')

    return '<tr>' +
      '<td><strong>' + name + '</strong><div style="font-family:Space Mono,monospace;font-size:10px;color:var(--muted);margin-top:3px">' + phone + '</div></td>' +
      '<td><span class="badge badge-role">' + role + '</span></td>' +
      '<td>' + tokenCell + '</td>' +
      '<td><span class="badge ' + statusClass + '">' + escapeHtml(statusText) + '</span></td>' +
      '<td><span class="badge ' + tokenBadgeClass + '">' + tokenBadge + '</span></td>' +
      '<td style="font-family:Space Mono,monospace;font-size:11px;color:var(--muted)">' + escapeHtml(created) + '</td>' +
      '<td><div class="acts">' + actionButtons + '</div></td>' +
      '</tr>'
  }).join('')
}

async function createClient() {
  const name = document.getElementById('new-name').value.trim()
  if (!name) return toast('Nombre requerido', true)
  const role = document.getElementById('new-role').value
  const c = await api('/clients', { method:'POST', body: JSON.stringify({ name, role }) })
  if (c.error) return toast(c.error, true)
  copyT(c.token, false)
  toast('Cliente creado — token copiado')
  document.getElementById('new-name').value=''
  document.getElementById('new-form').classList.remove('open')
  loadClients()
}

async function toggle(id) {
  await api('/clients/'+id+'/toggle', {method:'PUT'})
  toast('Estado actualizado')
  loadClients()
}

async function renewToken(id, name) {
  if (!confirm(\`¿Renovar token de "\${name}"? El usuario deberá activar de nuevo con el nuevo token.\`)) return
  const c = await api('/clients/'+id+'/renew-token', {method:'PUT'})
  if (c.error) return toast(c.error, true)
  copyT(c.token, false)
  toast('Token renovado — nuevo token copiado')
  loadClients()
}

async function deleteClient(id, name) {
  if (!confirm(\`¿Eliminar "\${name}" y todos sus SMS? Esta acción no se puede deshacer.\`)) return
  const r = await api('/clients/'+id, {method:'DELETE'})
  if (r.error) return toast(r.error, true)
  toast('Cliente eliminado')
  loadClients()
}

async function showInfo(id) {
  document.getElementById('info-name').textContent = 'Cargando detalles…'
  document.getElementById('info-body').innerHTML = '<div class="loading">Cargando…</div>'
  document.getElementById('info-modal').classList.add('open')

  const data = await api('/clients/' + id + '/details')
  if (data.error) {
    document.getElementById('info-name').textContent = 'Error'
    document.getElementById('info-body').textContent = data.error
    return
  }

  const c = data.client || {}
  const a = data.activation || {}
  const p = data.payment || {}
  const cfg = data.payment_config || {}
  const cards = [c.card1, c.card2, c.card3].filter(Boolean)
  const roleLabel = c.role === 'admin' ? 'Administrador' : 'Cliente'
  const fmt = v => v ? new Date(v).toLocaleString('es') : '—'
  const secretText = a.activation_secret || (a.activation_secret_error ? a.activation_secret_error : (a.activation_secret_available ? 'Disponible, pero no se pudo recuperar' : 'No disponible (sesión antigua)'))

  document.getElementById('info-name').textContent = c.name || 'Cliente'
  document.getElementById('info-body').innerHTML = \`
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-key">Teléfono registrado</div><div class="detail-val">\${c.phone_number || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Device ID</div><div class="detail-val">\${c.device_id || a.device_id || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Activation ID</div><div class="detail-val">\${a.activation_id || '—'}</div></div>
      <div class="detail-item full"><div class="detail-key">Activation Secret</div><div class="detail-val secret">\${secretText}</div><div style="margin-top:8px"><button class="btn btn-sm btn-green" onclick="copyValue(\${JSON.stringify(a.activation_secret || '').replace(/"/g, '&quot;')}, 'Activation Secret')" \${a.activation_secret ? '' : 'disabled'}>📋 Copiar secret</button></div></div>
      <div class="detail-item"><div class="detail-key">Estado activación</div><div class="detail-val">\${a.status || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Cliente ID</div><div class="detail-val">\${c.id || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Token</div><div class="detail-val">\${c.token || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Token usado</div><div class="detail-val">\${c.token_used ? 'Sí' : 'No'}</div></div>
      <div class="detail-item"><div class="detail-key">Pago iniciado</div><div class="detail-val">\${fmt(a.payment_started_at)}</div></div>
      <div class="detail-item"><div class="detail-key">Vencimiento pago</div><div class="detail-val">\${fmt(a.payment_deadline_at)}</div></div>
      <div class="detail-item"><div class="detail-key">Fin gracia</div><div class="detail-val">\${fmt(a.confirmation_deadline_at)}</div></div>
      <div class="detail-item"><div class="detail-key">Pago confirmado</div><div class="detail-val">\${fmt(a.paid_at)}</div></div>
      <div class="detail-item"><div class="detail-key">Tarjeta 1</div><div class="detail-val">\${c.card1 || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Tarjeta 2 / 3</div><div class="detail-val">\${[c.card2,c.card3].filter(Boolean).join(' · ') || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Monedero</div><div class="detail-val">\${c.wallet || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Número a confirmar</div><div class="detail-val">\${cfg.confirmation_phone || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Tarjeta receptora</div><div class="detail-val">\${cfg.card || '—'}</div></div>
      <div class="detail-item"><div class="detail-key">Precio licencia</div><div class="detail-val">\${cfg.amount || '—'} \${cfg.currency || ''}</div></div>
      <div class="detail-item"><div class="detail-key">Último pago</div><div class="detail-val">\${p.status || '—'} · \${p.amount || '—'} \${p.currency || ''}</div></div>
      <div class="detail-item full"><div class="detail-key">TX / motivo</div><div class="detail-val">\${p.transaction_id || '—'} \${p.reason ? ' · ' + p.reason : ''}</div></div>
      <div class="detail-item full"><div class="detail-key">Webhooks</div><div class="detail-val">1: \${c.webhook_url || '—'}<br>2: \${c.webhook_url_2 || '—'}<br>3: \${c.webhook_url_3 || '—'}</div></div>
      <div class="detail-item full"><div class="detail-key">WebHook Secret</div><div class="detail-val">\${c.webhook_secret || 'No generado'}</div></div>
      <div class="detail-item"><div class="detail-key">Creado</div><div class="detail-val">\${fmt(c.created_at)}</div></div>
      <div class="detail-item"><div class="detail-key">Expira licencia</div><div class="detail-val">\${fmt(c.expires_at)}</div></div>
      <div class="detail-item full"><div class="detail-key">Último motivo de pago</div><div class="detail-val">\${a.last_payment_reason || '—'}</div></div>
    </div>
  \`
}

// ── Webhooks modal ────────────────────────────────────────────────────────────
function openWebhooksById(id) {
  const client = CLIENTS.find(x => String(x.id) === String(id))
  if (!client) return toast('Cliente no encontrado', true)
  openWebhooks(client)
}

function openWebhooks(c) {
  document.getElementById('wh-client-id').value = c.id
  document.getElementById('wh-1').value = c.webhook_url || ''
  document.getElementById('wh-2').value = c.webhook_url_2 || ''
  document.getElementById('wh-3').value = c.webhook_url_3 || ''
  document.getElementById('wh-modal').classList.add('open')
}

async function saveWebhooks() {
  const id = document.getElementById('wh-client-id').value
  const r = await api('/clients/'+id+'/webhooks', {
    method:'PUT',
    body: JSON.stringify({
      webhook_url: document.getElementById('wh-1').value.trim(),
      webhook_url_2: document.getElementById('wh-2').value.trim(),
      webhook_url_3: document.getElementById('wh-3').value.trim()
    })
  })
  if (r.error) return toast(r.error, true)
  toast('Webhooks guardados')
  closeModal('wh-modal')
  loadClients()
}

function closeModal(id) { document.getElementById(id).classList.remove('open') }

// ── Logs ──────────────────────────────────────────────────────────────────────
function renderLogs(logs) {
  const cont = document.getElementById('logs-cont')
  if (!Array.isArray(logs) || !logs.length) { cont.innerHTML='<div class="empty">Sin SMS recibidos aún</div>'; return }
  cont.innerHTML = logs.map(l => {
    const p = l.parsed || {}
    const incoming = p.direction === 'RECIBIDO'
    const amount = p.amount ? \`\${p.amount} \${p.currency||''}\` : 'Monto no detectado'
    const typeLabel = p.type ? p.type.replace(/_/g,' ') : 'DESCONOCIDO'
    return \`
      <div class="log-card \${incoming?'':'enviado'}">
        <div class="log-client">\${l.clients?.name||'—'}</div>
        <div class="log-top">
          <div>
            <div class="log-amount \${incoming?'':'enviado'}">\${incoming?'↓ ':'↑ '}\${amount}</div>
            <div class="log-type">\${typeLabel}</div>
          </div>
          <div class="log-time">\${new Date(l.created_at).toLocaleString('es')}</div>
        </div>
        <div class="log-body">\${l.body}</div>
      </div>
    \`
  }).join('')
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function tab(name) {
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('on',['clients','logs'][i]===name))
  document.getElementById('tab-clients').style.display = name==='clients'?'block':'none'
  document.getElementById('tab-logs').style.display = name==='logs'?'block':'none'
  if (name==='logs') loadLogs()
}

function toggleForm() { document.getElementById('new-form').classList.toggle('open') }

// ── Utils ─────────────────────────────────────────────────────────────────────
function copyT(t, notify=true) {
  navigator.clipboard.writeText(t)
  if (notify) toast('Token copiado')
}

function copyValue(value, label='Valor') {
  if (!value) return
  navigator.clipboard.writeText(value)
    .then(()=>toast(label+' copiado'))
    .catch(()=>toast('No se pudo copiar', true))
}

function toast(msg, isErr=false) {
  const t = document.getElementById('toast')
  t.textContent=msg; t.className='show'+(isErr?' err':'')
  setTimeout(()=>t.className='',3000)
}
</script>
</body>
</html>`

module.exports = router
