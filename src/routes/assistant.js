'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const { rewardsEnabled, rewardsSchemaReady } = require('../utils/rewards')
const opsDashboard = require('../utils/opsDashboard')
const { getAutomationAvailability } = require('../utils/systemSettings')
const {
  assistantProviderConfig, assistantConfigured, assistantUsageLimits, normalizeMessages, buildSystemPrompt, loadRelevantKnowledge, needsAccountContext,
  safeOrderStatus, safeCouponStatus, shortTicket, extractAssistantPayload, buildCustomerInsights, buildAdminInsights,
} = require('../utils/assistantService')

const router = express.Router()
const minuteRequests = new Map()
let providerModelCursor = 0

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

async function requireClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ ok: false, error: 'Vuelve a conectar con tu cuenta para utilizar el asistente.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase.from('clients')
      .select('id,active,role,expires_at,device_id,store_only')
      .eq('token', token).maybeSingle()
    if (error) throw error
    if (!client || !canUseOfficialStore(client)) return res.status(401).json({ ok: false, error: 'La sesión no está activa. Vuelve a conectarte.' })
    const boundDevice = String(client.device_id || '').trim()
    const requestDevice = String(req.headers['x-device-id'] || '').trim()
    if (boundDevice && (!requestDevice || requestDevice !== boundDevice)) {
      return res.status(403).json({ ok: false, error: 'Esta instalación no coincide con tu sesión.' })
    }
    req.assistantClient = client
    return next()
  } catch (error) {
    if (error?.code === 'TOKEN_REVOKED') return res.status(403).json({ ok: false, error: 'La sesión ya no está activa.' })
    console.error(JSON.stringify({ event: 'AI_ASSISTANT_AUTH_FAILED', code: error?.code || 'unknown' }))
    return res.status(500).json({ ok: false, error: 'No se pudo validar la sesión.' })
  }
}

function configValues() {
  return assistantUsageLimits(process.env)
}

function allowMinuteRate(clientId) {
  const now = Date.now()
  const prior = minuteRequests.get(clientId)
  if (!prior || now - prior.startedAt >= 60_000) {
    minuteRequests.set(clientId, { startedAt: now, count: 1 })
    return true
  }
  if (prior.count >= 5) return false
  prior.count += 1
  if (minuteRequests.size > 10000) {
    for (const [key, value] of minuteRequests) {
      if (now - value.startedAt >= 60_000) minuteRequests.delete(key)
    }
  }
  return true
}

async function buildAccountContext(client, userMessage = '') {
  const message = String(userMessage || '').toLowerCase()
  const asksOverview = /resumen|mis movimientos|mi actividad|c[oó]mo voy|estado general/.test(message)
  const wantsOrders = asksOverview || /pedido|compra|pago|transfer|recarga|historial|no me llega|no recib[ií]|estado de mi/.test(message)
  const wantsCoupons = asksOverview || /cup[oó]n|descuento|misi[oó]n|recompensa|referid/.test(message)
  const wantsWallet = asksOverview || /wallet|saldo|balance|dep[oó]sito|dinero disponible/.test(message)
  const wantsLicense = /licencia|activaci[oó]n|vencimiento/.test(message)
  const expiry = client.expires_at ? Date.parse(client.expires_at) : null
  const context = {}

  if (wantsLicense) {
    context.licencia = client.store_only === true
      ? 'Acceso limitado a la tienda oficial; no es una licencia de automatización.'
      : (client.active === true && (!expiry || (Number.isFinite(expiry) && expiry > Date.now())) ? 'Activa' : 'No activa o vencida')
    context.vencimiento = Number.isFinite(expiry) ? new Date(expiry).toISOString() : null
  }

  const tasks = []
  if (wantsOrders) {
    tasks.push(
      supabase.from('game_recharge_orders')
        .select('id,status,game_name,offer_title,price_basis,payment_amount,created_at,updated_at,completed_at')
        .eq('client_id', client.id).order('created_at', { ascending: false }).limit(4),
      supabase.from('etecsa_orders')
        .select('id,status,offer_name,offer_type,price_basis,payment_amount,created_at,updated_at,completed_at')
        .eq('client_id', client.id).order('created_at', { ascending: false }).limit(4),
    )
  }
  if (wantsCoupons) {
    tasks.push(supabase.from('reward_coupons')
      .select('discount_percent,status,minimum_subtotal_cup,expires_at,issued_at')
      .eq('client_id', client.id).order('issued_at', { ascending: false }).limit(8))
  }
  if (wantsWallet) {
    tasks.push(supabase.from('store_wallets')
      .select('balance_cup,balance_saldo').eq('client_id', client.id).maybeSingle())
  }

  const results = await Promise.allSettled(tasks)
  let cursor = 0
  if (wantsOrders) {
    const gameResult = results[cursor++]
    const etecsaResult = results[cursor++]
    const orders = { game_market: [], etecsa: [] }
    if (gameResult.status === 'fulfilled' && !gameResult.value.error) {
      orders.game_market = (gameResult.value.data || []).map(row => ({
        ticket: shortTicket('GM', row.id),
        producto: [row.game_name, row.offer_title].filter(Boolean).join(' · ').slice(0, 120),
        estado: safeOrderStatus(row.status),
        importe: Number.isFinite(Number(row.payment_amount)) ? Number(row.payment_amount) : null,
        moneda: String(row.price_basis || '').toUpperCase() === 'SALDO' ? 'Saldo Móvil' : 'CUP',
        fecha: row.created_at || null,
        completado: row.completed_at || null,
      }))
    }
    if (etecsaResult.status === 'fulfilled' && !etecsaResult.value.error) {
      orders.etecsa = (etecsaResult.value.data || []).map(row => ({
        ticket: shortTicket('ET', row.id),
        producto: String(row.offer_name || (row.offer_type === 'nauta' ? 'Nauta' : 'Recarga')).slice(0, 120),
        estado: safeOrderStatus(row.status),
        importe: Number.isFinite(Number(row.payment_amount)) ? Number(row.payment_amount) : null,
        moneda: String(row.price_basis || '').toUpperCase() === 'SALDO' ? 'Saldo Móvil' : 'CUP',
        fecha: row.created_at || null,
        completado: row.completed_at || null,
      }))
    }
    context.pedidos = orders
  }
  if (wantsCoupons) {
    const couponResult = results[cursor++]
    if (couponResult.status === 'fulfilled' && !couponResult.value.error) {
      context.cupones = (couponResult.value.data || []).map(row => ({
        descuento_porcentaje: Number(row.discount_percent) || 0,
        estado: safeCouponStatus(row.status),
        minimo_cup: Number(row.minimum_subtotal_cup) || 0,
        vencimiento: row.expires_at || null,
      }))
    }
  }
  if (wantsWallet) {
    const walletResult = results[cursor++]
    if (walletResult.status === 'fulfilled' && !walletResult.value.error && walletResult.value.data) {
      context.wallet = {
        cup: Number(walletResult.value.data.balance_cup) || 0,
        saldo_movil: Number(walletResult.value.data.balance_saldo) || 0,
        nota: 'CUP y Saldo Móvil son balances separados y no se convierten automáticamente.'
      }
    }
  }
  if (asksOverview) context.nota_resumen = 'Este resumen incluye solo los datos que pudieron consultarse en las secciones disponibles; una lista vacía o ausente no demuestra que no existan movimientos.'
  return Object.keys(context).length ? context : null
}


router.get('/insights', requireClient, async (req, res) => {
  const clientId = String(req.assistantClient.id)
  if (!allowMinuteRate(clientId)) {
    res.set('Retry-After', '60')
    return res.status(429).json({ ok: false, code: 'AI_RATE_LIMIT', error: 'Espera un momento antes de volver a consultar las sugerencias.' })
  }
  const checkedAt = Date.now()
  let orders = []
  let coupons = []
  try {
    // Bounded reads: recent rows only, rather than a full account-history scan on every poll.
    const [games, etecsa, topups] = await Promise.all([
      supabase.from('game_recharge_orders')
        .select('id,game_name,offer_title,status,updated_at,created_at,wallet_refunded_at')
        .eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
      supabase.from('etecsa_orders')
        .select('id,offer_name,status,updated_at,created_at')
        .eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
      supabase.from('store_wallet_topups')
        .select('id,status,updated_at,created_at,payment_review_at')
        .eq('client_id', clientId).order('updated_at', { ascending: false }).limit(15),
    ])
    for (const result of [games, etecsa, topups]) if (result.error) throw result.error
    orders = [
      ...(games.data || []).map(row => ({
        id: row.id, source: 'GAMEMARKET', title: [row.game_name, row.offer_title].filter(Boolean).join(' · ') || 'Compra de Game Market',
        status: row.wallet_refunded_at ? 'REFUNDED' : row.status, updated_at: row.updated_at, created_at: row.created_at,
      })),
      ...(etecsa.data || []).map(row => ({
        id: row.id, source: 'ETECSA', title: row.offer_name || 'Operación ETECSA', status: row.status,
        updated_at: row.updated_at, created_at: row.created_at,
      })),
      ...(topups.data || []).map(row => ({
        id: row.id, source: 'WALLET', title: 'Recarga de Wallet', status: row.status,
        updated_at: row.updated_at, created_at: row.created_at, payment_review_required: Boolean(row.payment_review_at),
      })),
    ]
  } catch (error) {
    console.warn(JSON.stringify({ event: 'AI_ASSISTANT_INSIGHTS_ORDERS_UNAVAILABLE', code: error?.code || 'read_failed' }))
  }
  let missions = []
  let welcome = null
  let profile = null
  try {
    if (rewardsEnabled() && await rewardsSchemaReady()) {
      const cutoff = new Date(checkedAt - 36 * 60 * 60 * 1000).toISOString()
      const [couponResult, profileResult, referralEntriesResult, referralsResult] = await Promise.all([
        supabase.from('reward_coupons')
          .select('id,status,discount_percent,issued_at,expires_at')
          .eq('client_id', clientId).eq('status', 'AVAILABLE')
          .gte('issued_at', cutoff).order('issued_at', { ascending: false }).limit(10),
        supabase.from('reward_profiles')
          .select('welcome_started_at,welcome_used_at,first_cup_purchase_at')
          .eq('client_id', clientId).maybeSingle(),
        supabase.from('reward_referral_code_entries')
          .select('id', { count: 'exact', head: true }).eq('client_id', clientId),
        supabase.from('reward_referrals')
          .select('id', { count: 'exact', head: true }).eq('referrer_client_id', clientId).eq('status', 'QUALIFIED'),
      ])
      if (!couponResult.error) coupons = couponResult.data || []
      else console.warn(JSON.stringify({ event: 'AI_ASSISTANT_INSIGHTS_COUPONS_UNAVAILABLE', code: couponResult.error.code || 'read_failed' }))

      const enteredCodes = Number(referralEntriesResult.count || 0)
      const qualifiedReferrals = Number(referralsResult.count || 0)
      if (!referralEntriesResult.error && !referralsResult.error) {
        profile = {
          referral_codes_entered_count: enteredCodes,
          referral_codes_until_next_coupon: 15 - (enteredCodes % 15),
        }
        missions = [
          { id: 'recruit', title: 'Recluta novato', progress: Math.min(3, qualifiedReferrals), target: 3, completed: qualifiedReferrals >= 3, reward: 'Cupón del 2%' },
          { id: 'referrals_10', title: 'Embajador · 10 referidos', progress: Math.min(10, qualifiedReferrals), target: 10, completed: qualifiedReferrals >= 10, reward: 'Cupón del 5%' },
          { id: 'referrals_20', title: 'Embajador · 20 referidos', progress: Math.min(20, qualifiedReferrals), target: 20, completed: qualifiedReferrals >= 20, reward: 'Cupón del 10%' },
          { id: 'referrals_30', title: 'Embajador · 30 referidos', progress: Math.min(30, qualifiedReferrals), target: 30, completed: qualifiedReferrals >= 30, reward: 'Cupón del 15%' },
        ]
      }
      const rewardProfile = profileResult.data
      const welcomeStartedAt = Date.parse(rewardProfile?.welcome_started_at || '')
      if (rewardProfile && Number.isFinite(welcomeStartedAt)) {
        const welcomeEndsAt = welcomeStartedAt + 24 * 60 * 60 * 1000
        const remainingMs = Math.max(0, welcomeEndsAt - checkedAt)
        welcome = {
          available: !rewardProfile.welcome_used_at && !rewardProfile.first_cup_purchase_at && remainingMs > 0,
          remaining_ms: remainingMs,
          ends_at: new Date(welcomeEndsAt).toISOString(),
        }
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: 'AI_ASSISTANT_INSIGHTS_REWARDS_UNAVAILABLE', code: error?.code || 'read_failed' }))
  }
  const events = buildCustomerInsights({ orders, coupons, missions, welcome, profile, now: checkedAt })
  return res.set('Cache-Control', 'no-store').json({ ok: true, checked_at: new Date(checkedAt).toISOString(), events })
})

router.get('/admin/insights', requireClient, async (req, res) => {
  if (String(req.assistantClient.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Esta función está disponible únicamente para administradores.' })
  }
  const clientId = String(req.assistantClient.id)
  if (!allowMinuteRate(clientId)) {
    res.set('Retry-After', '60')
    return res.status(429).json({ ok: false, code: 'AI_RATE_LIMIT', error: 'Espera un momento antes de actualizar el diagnóstico.' })
  }
  try {
    const [summary, automation] = await Promise.all([
      opsDashboard.getOpsSummary(),
      getAutomationAvailability().catch(() => null),
    ])
    summary.automation_enabled = automation?.config_error === true ? null : (typeof automation?.enabled === 'boolean' ? automation.enabled : null)
    const insights = buildAdminInsights(summary)
    const total = insights.filter(item => item.severity !== 'success').length
    return res.set('Cache-Control', 'no-store').json({
      ok: true,
      generated_at: summary.checked_at || new Date().toISOString(),
      summary: {
        service: summary.service?.status || 'UNKNOWN',
        database: summary.database?.status || 'UNKNOWN',
        automation_enabled: summary.automation_enabled,
        open_incidents: Number(summary.incidents?.open || 0),
        critical_incidents: Number(summary.incidents?.critical || 0),
        payment_reviews: Number(summary.wallet?.payment_review || 0),
        overdue_wallet_tickets: Number(summary.wallet?.overdue_waiting || 0),
        pending_refunds: Number(summary.wallet?.refunds_pending || 0) + Number(summary.orders?.transfer_refunds_pending || 0),
        stuck_game_orders: Number(summary.orders?.game_stuck || 0),
        stuck_etecsa_orders: Number(summary.orders?.etecsa_stuck || 0),
        webhook_failures: Number(summary.webhook_failures || 0),
      },
      insight_count: total,
      insights,
    })
  } catch (error) {
    console.error(JSON.stringify({ event: 'AI_ASSISTANT_ADMIN_INSIGHTS_FAILED', code: error?.code || 'ops_read_failed' }))
    return res.status(503).json({ ok: false, error: 'No se pudo generar el diagnóstico operativo. Inténtalo de nuevo más tarde.' })
  }
})

router.get('/config', requireClient, async (req, res) => {
  let enabled = assistantConfigured()
  let message = enabled ? 'Asistente disponible.' : 'El asistente todavía no está configurado.'
  if (enabled) {
    // Verify the quota migration without consuming a request: the SQL function
    // returns immediately when p_client_id is NULL.
    const readiness = await supabase.rpc('consume_ai_assistant_request', { p_client_id: null, p_daily_limit: 1, p_global_daily_limit: 1 })
    if (readiness.error) {
      enabled = false
      message = 'El asistente está terminando de configurarse.'
      console.error(JSON.stringify({ event: 'AI_ASSISTANT_READINESS_FAILED', code: readiness.error.code || 'unknown' }))
    }
  }
  return res.set('Cache-Control', 'no-store').json({ ok: true, enabled, message, provider: 'GroqCloud', persona: 'SO Assistant', avatar_enabled: true })
})

router.post('/chat', requireClient, async (req, res) => {
  if (!assistantConfigured()) {
    return res.status(503).json({ ok: false, code: 'AI_ASSISTANT_NOT_CONFIGURED', error: 'El asistente todavía no está disponible. Contacta con soporte.' })
  }
  const normalized = normalizeMessages(req.body?.messages)
  if (!normalized.ok) return res.status(400).json({ ok: false, error: normalized.error })
  const clientId = String(req.assistantClient.id)
  if (!allowMinuteRate(clientId)) {
    res.set('Retry-After', '60')
    return res.status(429).json({ ok: false, code: 'AI_RATE_LIMIT', error: 'Has enviado varias preguntas seguidas. Espera un minuto e inténtalo de nuevo.' })
  }

  const { dailyLimit, globalDailyLimit, maxTokens } = configValues()
  const quota = await supabase.rpc('consume_ai_assistant_request', {
    p_client_id: clientId,
    p_daily_limit: dailyLimit,
    p_global_daily_limit: globalDailyLimit,
  })
  if (quota.error) {
    console.error(JSON.stringify({ event: 'AI_ASSISTANT_QUOTA_FAILED', code: quota.error.code || 'unknown' }))
    return res.status(503).json({ ok: false, code: 'AI_ASSISTANT_NOT_READY', error: 'El asistente está terminando de configurarse. Inténtalo más tarde.' })
  }
  const quotaRow = Array.isArray(quota.data) ? quota.data[0] : quota.data
  if (!quotaRow?.allowed) {
    return res.status(429).json({ ok: false, code: 'AI_DAILY_LIMIT', error: 'El asistente alcanzó su límite de uso diario. Puedes volver a intentarlo mañana.' })
  }

  try {
    const userMessage = normalized.messages[normalized.messages.length - 1].content
    const accountContext = needsAccountContext(userMessage) ? await buildAccountContext(req.assistantClient, userMessage) : null
    const knowledgeText = loadRelevantKnowledge(userMessage)
    const messages = [
      { role: 'system', content: buildSystemPrompt(accountContext, knowledgeText) },
      ...normalized.messages,
    ]
    const provider = assistantProviderConfig(process.env)
    const spontaneousMode = req.body?.mode === 'spontaneous'
    // Ambient messages are intentionally short and single-model: they are optional,
    // metered, and must fall back quickly instead of delaying the dashboard.
    const modelOrder = spontaneousMode
      ? [provider.models[providerModelCursor % Math.max(1, provider.models.length)]]
      : (provider.models.length > 1
        ? provider.models.map((_, index) => provider.models[(providerModelCursor + index) % provider.models.length])
        : provider.models)
    providerModelCursor = (providerModelCursor + 1) % Math.max(1, provider.models.length)

    let data = null
    let response = null
    let selectedModel = ''
    let lastStatus = 0
    let lastProviderCode = null
    let lastWasTimeout = false

    // Distribute requests across the configured free models. If a model is
    // rate-limited or temporarily unavailable, try the remaining models.
    for (const model of modelOrder) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), spontaneousMode ? 7_000 : 18_000)
      timeout.unref?.()
      try {
        response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            max_completion_tokens: spontaneousMode ? Math.min(maxTokens, 220) : maxTokens,
            temperature: spontaneousMode ? 0.95 : 0.82,
            response_format: { type: 'json_object' },
            stream: false,
          }),
          signal: controller.signal,
        })
        if (response.ok) {
          data = await response.json()
          selectedModel = model
          break
        }
        lastStatus = response.status
        try {
          const failure = await response.json()
          lastProviderCode = failure?.error?.code || failure?.error?.type || null
        } catch (_) { lastProviderCode = null }
        // Invalid credentials/configuration are not fixed by trying another model.
        if ([401, 403].includes(response.status)) break
        // Retry on provider/model capacity failures or temporary server errors.
        if (![400, 404, 408, 409, 429, 500, 502, 503, 504].includes(response.status)) break
      } catch (error) {
        lastWasTimeout = error?.name === 'AbortError'
        lastStatus = 0
        lastProviderCode = error?.code || null
      } finally {
        clearTimeout(timeout)
      }
    }

    if (!data) {
      console.warn(JSON.stringify({
        event: 'AI_ASSISTANT_PROVIDER_EXHAUSTED',
        provider: 'groq', status: lastStatus || null,
        code: String(lastProviderCode || '').slice(0, 80) || null,
        models_attempted: modelOrder.length,
      }))
      if ([401, 403].includes(lastStatus)) {
        return res.status(503).json({ ok: false, code: 'AI_PROVIDER_AUTH', error: 'La conexión del asistente necesita revisión. Contacta con soporte.' })
      }
      if (lastStatus === 429 || [404, 408, 409, 500, 502, 503, 504].includes(lastStatus)) {
        return res.status(503).json({ ok: false, code: 'AI_PROVIDER_BUSY', error: 'Los modelos están ocupados por ahora. Inténtalo de nuevo en un momento.' })
      }
      return res.status(502).json({ ok: false, code: lastWasTimeout ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE', error: lastWasTimeout ? 'El asistente está tardando demasiado. Inténtalo otra vez.' : 'No se pudo conectar con el asistente. Comprueba tu conexión e inténtalo de nuevo.' })
    }

    const assistantOutput = extractAssistantPayload(data)
    const reply = assistantOutput.reply
    if (!reply) {
      console.warn(JSON.stringify({ event: 'AI_ASSISTANT_EMPTY_RESPONSE', provider: 'groq', model: selectedModel }))
      return res.status(502).json({ ok: false, code: 'AI_EMPTY_RESPONSE', error: 'El asistente no pudo generar una respuesta. Inténtalo otra vez.' })
    }
    const usage = data?.usage || {}
    console.log(JSON.stringify({
      event: 'AI_ASSISTANT_REQUEST_COMPLETED', client_id: clientId,
      provider: 'groq', model: selectedModel,
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
      request_id: String(data?.id || '').slice(0, 100) || null,
    }))
    return res.set('Cache-Control', 'no-store').json({
      ok: true,
      reply,
      emotion: assistantOutput.emotion,
      gesture: assistantOutput.gesture,
      mood_text: assistantOutput.mood_text,
      provider: 'GroqCloud',
      model: selectedModel,
      spontaneous: spontaneousMode,
      remaining_today: Math.max(0, dailyLimit - Number(quotaRow.used || 0)),
    })
  } catch (error) {
    const timeout = error?.name === 'AbortError'
    console.warn(JSON.stringify({ event: 'AI_ASSISTANT_REQUEST_FAILED', reason: timeout ? 'timeout' : (error?.code || 'network_error') }))
    return res.status(502).json({ ok: false, code: timeout ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE', error: timeout ? 'El asistente está tardando demasiado en responder. Inténtalo nuevamente.' : 'No se pudo conectar con el asistente. Comprueba tu conexión e inténtalo otra vez.' })
  }
})

module.exports = router
