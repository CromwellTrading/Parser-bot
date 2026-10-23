'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { WELCOME_DISCOUNT_TIERS, welcomePercent, roundedDiscount } = require('./rewardPricing')
const { rewardsEnabled, emptyDiscountQuote, isRewardsSchemaUnavailable } = require('./rewardFeaturePolicy')

const WELCOME_WINDOW_MS = 24 * 60 * 60 * 1000
const RESERVATION_MS = 35 * 60 * 1000
const TZ = 'America/Havana'

// Rewards are opt-in in production. The schema check is intentionally non-critical:
// a missing rewards migration disables discounts but never takes down checkout.
let rewardSchemaState = { ready: false, checkedAt: 0 }
async function rewardsSchemaReady({ force = false } = {}) {
  if (!rewardsEnabled()) return false
  const now = Date.now()
  const ttl = rewardSchemaState.ready ? 60_000 : 5_000
  if (!force && now - rewardSchemaState.checkedAt < ttl) return rewardSchemaState.ready
  try {
    const checks = await Promise.all([
      supabase.from('reward_profiles').select('client_id,purchase_history_checked_at', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_schema_status').select('schema_version').eq('id', 'rewards-v1').maybeSingle(),
      supabase.from('reward_referrals').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_coupons').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_purchase_events').select('id,source,has_game_market,has_etecsa', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_campaigns').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('game_recharge_orders').select('reward_base_amount,reward_discount_percent,reward_discount_amount,reward_coupon_id,welcome_discount', { head: true, count: 'exact' }).limit(1),
      supabase.from('etecsa_orders').select('reward_base_amount,reward_discount_percent,reward_discount_amount,reward_coupon_id,welcome_discount', { head: true, count: 'exact' }).limit(1),
    ])
    const sentinel = checks[1]
    rewardSchemaState = { ready: checks.every(result => !result?.error) && Number(sentinel?.data?.schema_version) === 1, checkedAt: now }
  } catch (_) {
    rewardSchemaState = { ready: false, checkedAt: now }
  }
  if (!rewardSchemaState.ready) console.warn(JSON.stringify({ event: 'REWARDS_SCHEMA_NOT_READY', action: 'keep_existing_checkout_available' }))
  return rewardSchemaState.ready
}

function cleanText(value, max = 100) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}
function makeReferralCode() { return `SO${crypto.randomBytes(5).toString('hex').toUpperCase()}` }
function makeCouponCode() { return `SO-${crypto.randomBytes(4).toString('hex').toUpperCase()}` }
function errorWithStatus(message, status = 400, code = 'REWARDS_ERROR') {
  const error = new Error(message); error.status = status; error.code = code; return error
}
function havanaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const read = key => parts.find(p => p.type === key)?.value || '00'
  return { year: Number(read('year')), month: Number(read('month')), day: Number(read('day')), key: `${read('year')}-${read('month')}-${read('day')}` }
}
function havanaOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - date.getTime()
}
function havanaMidnight(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const utcGuess = Date.UTC(y, m - 1, d)
  let result = utcGuess
  for (let i = 0; i < 3; i++) result = utcGuess - havanaOffsetMs(new Date(result))
  return new Date(result)
}
function periodInfo(now = new Date()) {
  const parts = havanaParts(now)
  const currentDayStart = havanaMidnight(parts.key)
  const dayIndex = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - dayIndex))
  const weekKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`
  const nextWeekDate = new Date(monday.getTime() + 7 * 86400000)
  const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`
  const nextMonthDate = parts.month === 12 ? new Date(Date.UTC(parts.year + 1, 0, 1)) : new Date(Date.UTC(parts.year, parts.month, 1))
  return {
    dayKey: parts.key,
    dayStart: currentDayStart,
    weekKey,
    weekStart: havanaMidnight(weekKey),
    weekEnd: havanaMidnight(`${nextWeekDate.getUTCFullYear()}-${String(nextWeekDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextWeekDate.getUTCDate()).padStart(2, '0')}`),
    monthKey,
    monthStart: havanaMidnight(`${parts.year}-${String(parts.month).padStart(2, '0')}-01`),
    monthEnd: havanaMidnight(`${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`),
  }
}
function dateIsInFuture(value, now = Date.now()) { const t = Date.parse(value || ''); return Number.isFinite(t) && t > now }
function nowIsoSafe(date = new Date()) { return new Date(date).toISOString() }

async function getProfile(clientId) {
  const { data, error } = await supabase.from('reward_profiles').select('*').eq('client_id', clientId).maybeSingle()
  if (error) throw error
  return data || null
}

async function historicalPurchaseDates(clientId) {
  const [anyGame, cupGame, etecsa, anyCart, cupCart] = await Promise.all([
    supabase.from('game_recharge_orders').select('paid_at').eq('client_id', clientId).not('paid_at', 'is', null)
      .neq('status', 'REFUNDED').order('paid_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('game_recharge_orders').select('paid_at').eq('client_id', clientId).eq('price_basis', 'CUP')
      .not('paid_at', 'is', null).neq('status', 'REFUNDED').order('paid_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('etecsa_orders').select('paid_at').eq('client_id', clientId).not('paid_at', 'is', null)
      .neq('status', 'REFUNDED').order('paid_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('store_cart_orders').select('paid_at').eq('client_id', clientId).not('paid_at', 'is', null)
      .neq('status', 'REFUNDED').order('paid_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('store_cart_orders').select('paid_at').eq('client_id', clientId).eq('price_basis', 'CUP')
      .not('paid_at', 'is', null).neq('status', 'REFUNDED').order('paid_at', { ascending: true }).limit(1).maybeSingle(),
  ])
  for (const result of [anyGame, cupGame, etecsa, anyCart, cupCart]) if (result.error) throw result.error
  const anyDates = [anyGame.data?.paid_at, etecsa.data?.paid_at, anyCart.data?.paid_at].filter(Boolean).map(Date.parse).filter(Number.isFinite)
  const cupDates = [cupGame.data?.paid_at, etecsa.data?.paid_at, cupCart.data?.paid_at].filter(Boolean).map(Date.parse).filter(Number.isFinite)
  return {
    firstPaidPurchaseAt: anyDates.length ? new Date(Math.min(...anyDates)).toISOString() : null,
    firstCupPurchaseAt: cupDates.length ? new Date(Math.min(...cupDates)).toISOString() : null,
  }
}

async function ensureProfile(client, installedAt = null) {
  const clientId = String(client?.id || '')
  if (!clientId) throw errorWithStatus('No se pudo identificar tu cuenta.', 401, 'REWARD_CLIENT_REQUIRED')
  const existing = await getProfile(clientId)
  if (existing) {
    const patch = { updated_at: new Date().toISOString() }
    if (!existing.device_id && client.device_id) patch.device_id = String(client.device_id)
    if (!existing.purchase_history_checked_at) {
      const history = await historicalPurchaseDates(clientId)
      if (!existing.first_paid_purchase_at && history.firstPaidPurchaseAt) patch.first_paid_purchase_at = history.firstPaidPurchaseAt
      if (!existing.first_cup_purchase_at && history.firstCupPurchaseAt) patch.first_cup_purchase_at = history.firstCupPurchaseAt
      patch.purchase_history_checked_at = new Date().toISOString()
    }
    const needsSave = Object.keys(patch).length > 1 || !existing.purchase_history_checked_at
    if (needsSave) {
      const { error: updateError } = await supabase.from('reward_profiles').update(patch).eq('client_id', clientId)
      if (updateError) throw updateError
      Object.assign(existing, patch)
    }
    return existing
  }
  const now = new Date()
  const proposed = Date.parse(installedAt || '')
  // PackageManager.firstInstallTime lets the visible countdown continue while offline.
  // The server accepts a valid past install timestamp (no arbitrary age cutoff), rejects future timestamps, and binds it to this client/device. This prevents an old production install from receiving a fresh 24h period at feature rollout.
  const installTime = Number.isFinite(proposed) && proposed <= now.getTime() + 5 * 60 * 1000 && proposed > 0
    ? new Date(Math.min(proposed, now.getTime())).toISOString()
    : now.toISOString()
  // Existing production customers must not become "new" referrals or receive a new
  // welcome promotion merely because rewards were added after they first purchased.
  const history = await historicalPurchaseDates(clientId)
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeReferralCode()
    const { data, error } = await supabase.from('reward_profiles').insert({
      client_id: clientId, referral_code: code, device_id: String(client.device_id || '').slice(0, 160) || null,
      welcome_started_at: installTime, first_paid_purchase_at: history.firstPaidPurchaseAt,
      first_cup_purchase_at: history.firstCupPurchaseAt, purchase_history_checked_at: now.toISOString(),
      created_at: now.toISOString(), updated_at: now.toISOString(),
    }).select('*').single()
    if (!error && data) return data
    if (error?.code === '23505') {
      const retried = await getProfile(clientId)
      if (retried) return retried
      continue
    }
    throw error
  }
  throw errorWithStatus('No se pudo inicializar tu progreso de recompensas.', 503, 'REWARD_PROFILE_CREATE_FAILED')
}

async function issueCoupon({ clientId, source, sourceKey, percent, minimumSubtotalCup = 0, minimumExclusive = false, expiresAt = null }) {
  const { data: existing, error: existingError } = await supabase.from('reward_coupons').select('*')
    .eq('client_id', clientId).eq('source', source).eq('source_key', sourceKey).maybeSingle()
  if (existingError) throw existingError
  if (existing) return existing
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = {
      client_id: clientId, coupon_code: makeCouponCode(), source, source_key: sourceKey,
      discount_percent: percent, minimum_subtotal_cup: minimumSubtotalCup,
      minimum_exclusive: minimumExclusive, applies_to: 'CUP', status: 'AVAILABLE', expires_at: expiresAt,
    }
    const { data, error } = await supabase.from('reward_coupons').insert(payload).select('*').single()
    if (!error) return data
    if (error.code === '23505') {
      const bySource = await supabase.from('reward_coupons').select('*').eq('client_id', clientId).eq('source', source).eq('source_key', sourceKey).maybeSingle()
      if (bySource.error) throw bySource.error
      if (bySource.data) return bySource.data
      continue
    }
    throw error
  }
  throw errorWithStatus('No se pudo emitir la recompensa.', 503, 'COUPON_ISSUE_FAILED')
}

async function applyReferral(client, rawCode) {
  const code = cleanText(rawCode, 32).toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (!code) throw errorWithStatus('Introduce un código de referido.', 400, 'REFERRAL_CODE_REQUIRED')
  const profile = await ensureProfile(client)
  if (profile.referred_by_client_id) throw errorWithStatus('Ya tienes un código de referido vinculado y no se puede cambiar.', 409, 'REFERRAL_ALREADY_BOUND')
  if (profile.first_paid_purchase_at) throw errorWithStatus('El código debe vincularse antes de tu primera compra pagada.', 409, 'REFERRAL_TOO_LATE')
  const { data: inviterProfile, error: inviterError } = await supabase.from('reward_profiles').select('client_id,referral_code,device_id')
    .eq('referral_code', code).maybeSingle()
  if (inviterError) throw inviterError
  if (!inviterProfile) throw errorWithStatus('Ese código de referido no existe.', 404, 'REFERRAL_CODE_NOT_FOUND')
  if (String(inviterProfile.client_id) === String(client.id)) throw errorWithStatus('No puedes usar tu propio código de referido.', 409, 'REFERRAL_SELF_NOT_ALLOWED')
  const referredDevice = String(client.device_id || profile.device_id || '').trim()
  const inviterDevice = String(inviterProfile.device_id || '').trim()
  if (referredDevice && inviterDevice && referredDevice === inviterDevice) {
    throw errorWithStatus('El código debe proceder de otro dispositivo.', 409, 'REFERRAL_SAME_DEVICE')
  }
  const now = new Date().toISOString()
  const { data: updated, error } = await supabase.from('reward_profiles').update({
    referred_by_client_id: inviterProfile.client_id, referred_by_code: inviterProfile.referral_code,
    referral_bound_at: now, device_id: referredDevice || null, updated_at: now,
  }).eq('client_id', client.id).is('referred_by_client_id', null).is('first_paid_purchase_at', null).select('*').maybeSingle()
  if (error) throw error
  if (!updated) throw errorWithStatus('No se pudo vincular el código. Es posible que ya se haya aplicado.', 409, 'REFERRAL_ALREADY_BOUND')
  return { linked: true, referral_code: inviterProfile.referral_code }
}

async function getActiveCouponByCode(clientId, code) {
  const { data, error } = await supabase.from('reward_coupons').select('*')
    .eq('client_id', clientId).eq('coupon_code', code).maybeSingle()
  if (error) throw error
  return data || null
}

async function calculateDiscount(client, { amount, currency = 'CUP', couponCode = '', source = 'GAME_MARKET' }) {
  const baseAmount = Number(amount)
  const basis = String(currency || 'CUP').toUpperCase()
  if (!Number.isSafeInteger(baseAmount) || baseAmount <= 0) throw errorWithStatus('El precio de compra no es válido.', 400, 'REWARD_INVALID_AMOUNT')
  const requestedCode = cleanText(couponCode, 64)
  if (basis !== 'CUP') {
    if (requestedCode) throw errorWithStatus('Los cupones y la promoción de bienvenida solo se aplican a precios en CUP.', 400, 'COUPON_CUP_ONLY')
    // Saldo Móvil must never depend on rewards tables or be affected by CUP discounts.
    return emptyDiscountQuote(baseAmount, basis)
  }
  if (!rewardsEnabled()) {
    if (requestedCode) throw errorWithStatus('Los cupones están temporalmente no disponibles.', 503, 'REWARDS_NOT_ENABLED')
    // Compatibility mode: existing production checkouts continue at their original price.
    return emptyDiscountQuote(baseAmount, basis)
  }

  if (!(await rewardsSchemaReady())) {
    if (requestedCode) throw errorWithStatus('Los cupones todavía no están disponibles. Inténtalo más tarde.', 503, 'REWARDS_SCHEMA_UNAVAILABLE')
    return emptyDiscountQuote(baseAmount, basis)
  }

  let profile
  try {
    profile = await ensureProfile(client)
  } catch (error) {
    // A missing/not-yet-applied rewards migration must not take down regular purchases.
    // Explicit coupon attempts fail closed; purchases without coupons continue undiscounted.
    if (isRewardsSchemaUnavailable(error)) {
      if (requestedCode) throw errorWithStatus('Los cupones todavía no están disponibles. Inténtalo más tarde.', 503, 'REWARDS_SCHEMA_UNAVAILABLE')
      console.error(JSON.stringify({ event: 'REWARDS_SCHEMA_UNAVAILABLE', action: 'bypass_discount', code: error?.code || null }))
      return emptyDiscountQuote(baseAmount, basis)
    }
    if (requestedCode) throw errorWithStatus('No se pudo validar el cupón. Inténtalo de nuevo.', 503, 'REWARDS_VALIDATION_UNAVAILABLE')
    console.error(JSON.stringify({ event: 'REWARDS_VALIDATION_UNAVAILABLE', action: 'bypass_discount', code: error?.code || null }))
    return emptyDiscountQuote(baseAmount, basis)
  }

  const now = Date.now()
  const welcomeReservedActive = profile.welcome_reserved_order_ref && dateIsInFuture(profile.welcome_reserved_until, now)
  const welcomeAvailable = !profile.first_cup_purchase_at && !profile.welcome_used_at && !welcomeReservedActive &&
    now <= Date.parse(profile.welcome_started_at) + WELCOME_WINDOW_MS
  // The first eligible CUP checkout gets the automatic welcome promo, leaving earned coupons for later.
  if (welcomeAvailable) {
    const percent = welcomePercent(baseAmount)
    const discountAmount = roundedDiscount(baseAmount, percent)
    return { baseAmount, finalAmount: Math.max(1, baseAmount - discountAmount), discountPercent: percent, discountAmount, couponId: null, couponCode: null, welcomeDiscount: true, kind: 'WELCOME', featureEnabled: true, welcomeStartedAt: profile.welcome_started_at }
  }

  const code = requestedCode.toUpperCase()
  if (!code) return { baseAmount, finalAmount: baseAmount, discountPercent: 0, discountAmount: 0, couponId: null, couponCode: null, welcomeDiscount: false, kind: 'NONE', featureEnabled: true }
  const coupon = await getActiveCouponByCode(client.id, code)
  if (!coupon) throw errorWithStatus('Ese cupón no pertenece a tu cuenta o no existe.', 404, 'COUPON_NOT_FOUND')
  if (coupon.status !== 'AVAILABLE' || coupon.used_at || (coupon.expires_at && Date.parse(coupon.expires_at) <= now) || (coupon.reserved_until && Date.parse(coupon.reserved_until) > now)) {
    throw errorWithStatus('Ese cupón ya se utilizó, venció o está reservado en otra compra.', 409, 'COUPON_UNAVAILABLE')
  }
  const minimum = Number(coupon.minimum_subtotal_cup || 0)
  if (coupon.minimum_exclusive ? baseAmount <= minimum : baseAmount < minimum) {
    const rule = coupon.minimum_exclusive ? `superar los ${minimum.toLocaleString('es-ES')} CUP` : `alcanzar ${minimum.toLocaleString('es-ES')} CUP`
    throw errorWithStatus(`El subtotal del carrito debe ${rule} para usar este cupón.`, 400, 'COUPON_MINIMUM_NOT_MET')
  }
  const percent = Number(coupon.discount_percent)
  const discountAmount = roundedDiscount(baseAmount, percent)
  return { baseAmount, finalAmount: Math.max(1, baseAmount - discountAmount), discountPercent: percent, discountAmount, couponId: coupon.id, couponCode: coupon.coupon_code, welcomeDiscount: false, kind: 'COUPON', featureEnabled: true, couponSource: coupon.source }
}

async function reserveDiscount(clientId, quote, orderRef) {
  if (!quote || quote.kind === 'NONE') return true
  const now = new Date()
  const nowIso = now.toISOString()
  const until = new Date(now.getTime() + RESERVATION_MS).toISOString()
  if (quote.kind === 'WELCOME') {
    const { data, error } = await supabase.from('reward_profiles').update({
      welcome_reserved_order_ref: orderRef, welcome_reserved_until: until, updated_at: nowIso,
    }).eq('client_id', clientId).is('welcome_used_at', null).is('first_cup_purchase_at', null)
      .or(`welcome_reserved_order_ref.is.null,welcome_reserved_until.lt.${nowIso}`).select('client_id').maybeSingle()
    if (error) throw error
    return Boolean(data)
  }
  const { data: current, error: currentError } = await supabase.from('reward_coupons').select('id,status,reserved_order_ref,reserved_until,used_at,expires_at')
    .eq('id', quote.couponId).eq('client_id', clientId).maybeSingle()
  if (currentError) throw currentError
  if (!current || current.status === 'USED' || current.used_at || (current.expires_at && Date.parse(current.expires_at) <= now.getTime())) return false
  if (current.status === 'RESERVED' && dateIsInFuture(current.reserved_until, now.getTime())) return false
  if (current.status === 'RESERVED') {
    await supabase.from('reward_coupons').update({ status: 'AVAILABLE', reserved_order_ref: null, reserved_until: null })
      .eq('id', quote.couponId).eq('status', 'RESERVED').lte('reserved_until', nowIsoSafe(now))
  }
  const { data, error } = await supabase.from('reward_coupons').update({ status: 'RESERVED', reserved_order_ref: orderRef, reserved_until: until })
    .eq('id', quote.couponId).eq('status', 'AVAILABLE').is('reserved_order_ref', null).is('used_at', null).select('id').maybeSingle()
  if (error) throw error
  return Boolean(data)
}

async function releaseDiscount(clientId, quoteOrOrder, orderRef = null) {
  const quote = quoteOrOrder || {}
  const ref = orderRef || quote.orderRef
  if (!ref) return
  const now = new Date().toISOString()
  if (quote.welcomeDiscount || quote.kind === 'WELCOME' || quote.welcome_discount) {
    await supabase.from('reward_profiles').update({ welcome_reserved_order_ref: null, welcome_reserved_until: null, updated_at: now })
      .eq('client_id', clientId).eq('welcome_reserved_order_ref', ref)
  }
  const couponId = quote.couponId || quote.reward_coupon_id
  if (couponId) {
    await supabase.from('reward_coupons').update({ status: 'AVAILABLE', reserved_order_ref: null, reserved_until: null })
      .eq('client_id', clientId).eq('id', couponId).eq('reserved_order_ref', ref).eq('status', 'RESERVED')
  } else {
    await supabase.from('reward_coupons').update({ status: 'AVAILABLE', reserved_order_ref: null, reserved_until: null })
      .eq('client_id', clientId).eq('reserved_order_ref', ref).eq('status', 'RESERVED')
  }
}

async function qualifyReferralForFirstPurchase(clientId, clientDeviceId, paidAt) {
  const profile = await getProfile(clientId)
  if (!profile?.referred_by_client_id) return
  const referredDevice = String(clientDeviceId || profile.device_id || '').trim()
  if (!profile.device_id || !referredDevice || profile.device_id === referredDevice) return
  const { data: referrer, error: referrerError } = await supabase.from('reward_profiles').select('client_id,referral_code,device_id')
    .eq('client_id', profile.referred_by_client_id).maybeSingle()
  if (referrerError) throw referrerError
  if (!referrer?.device_id || referrer.device_id === referredDevice) return
  const { error } = await supabase.from('reward_referrals').insert({
    referrer_client_id: referrer.client_id, referred_client_id: clientId, referral_code: profile.referred_by_code || referrer.referral_code,
    referrer_device_id: referrer.device_id, referred_device_id: referredDevice,
    status: 'QUALIFIED', qualified_at: paidAt,
  })
  if (error && error.code !== '23505') throw error
  await issueReferralMilestones(referrer.client_id)
}

async function issueReferralMilestones(clientId) {
  const { count, error } = await supabase.from('reward_referrals').select('id', { count: 'exact', head: true })
    .eq('referrer_client_id', clientId).eq('status', 'QUALIFIED')
  if (error) throw error
  const n = Number(count || 0)
  const rules = [
    { count: 10, sourceKey: 'referrals:10', percent: 5, minimum: 0, exclusive: false },
    { count: 20, sourceKey: 'referrals:20', percent: 10, minimum: 8000, exclusive: true },
    { count: 30, sourceKey: 'referrals:30', percent: 15, minimum: 25000, exclusive: true },
  ]
  for (const rule of rules) if (n >= rule.count) await issueCoupon({ clientId, source: 'REFERRALS', sourceKey: rule.sourceKey, percent: rule.percent, minimumSubtotalCup: rule.minimum, minimumExclusive: rule.exclusive })
  if (n >= 3) await issueCoupon({ clientId, source: 'MISSION_RECRUIT', sourceKey: 'mission:recruit:once', percent: 2 })
}

async function listPurchaseEvents(clientId, { from = null, to = null, source = null } = {}) {
  let query = supabase.from('reward_purchase_events').select('*').eq('client_id', clientId).eq('event_status', 'VALID').order('paid_at', { ascending: true })
  if (from) query = query.gte('paid_at', from.toISOString ? from.toISOString() : from)
  if (to) query = query.lt('paid_at', to.toISOString ? to.toISOString() : to)
  if (source) query = query.eq('source', source)
  const { data, error } = await query.limit(1000)
  if (error) throw error
  return data || []
}

async function evaluateMissionRewards(clientId) {
  const now = new Date()
  const period = periodInfo(now)
  const all = await listPurchaseEvents(clientId)
  const currentMonth = all.filter(e => e.currency === 'CUP' && Date.parse(e.paid_at) >= period.monthStart.getTime() && Date.parse(e.paid_at) < period.monthEnd.getTime() && Number(e.base_amount || e.amount) > 15000)
  if (currentMonth.length >= 3) await issueCoupon({ clientId, source: 'MISSION_MONTHLY', sourceKey: `mission:monthly:${period.monthKey}`, percent: 7 })

  const currentWeek = all.filter(e => e.currency === 'CUP' && Number(e.base_amount || e.amount) > 1000 && Date.parse(e.paid_at) >= period.weekStart.getTime() && Date.parse(e.paid_at) < period.weekEnd.getTime())
  const daySet = new Set(currentWeek.map(e => havanaParts(new Date(e.paid_at)).key))
  const currentWeekDayKeys = [...daySet].sort()
  if (daySet.size >= 5) await issueCoupon({ clientId, source: 'MISSION_WEEKLY', sourceKey: `mission:weekly:${period.weekKey}`, percent: 3 })

  const previousWeekStart = new Date(period.weekStart.getTime() - 7 * 86400000)
  const previousWeekEvents = all.filter(e => e.currency === 'CUP' && Number(e.base_amount || e.amount) > 1000 && Date.parse(e.paid_at) >= previousWeekStart.getTime() && Date.parse(e.paid_at) < period.weekStart.getTime())
  const previousWeekDays = new Set(previousWeekEvents.map(e => havanaParts(new Date(e.paid_at)).key))
  if (daySet.size >= 5 && previousWeekDays.size >= 5) {
    await issueCoupon({ clientId, source: 'MISSION_STREAK', sourceKey: `mission:streak:${period.weekKey}`, percent: 3 })
  }

  if (all.some(e => Number(e.item_count) >= 3)) await issueCoupon({ clientId, source: 'MISSION_COLLECTOR', sourceKey: 'mission:collector:once', percent: 3 })
  const recentThirty = all.filter(e => Date.parse(e.paid_at) >= now.getTime() - 30 * 86400000)
  if (recentThirty.some(e => e.has_game_market === true || e.source === 'GAME_MARKET') && recentThirty.some(e => e.has_etecsa === true || e.source === 'ETECSA')) {
    await issueCoupon({ clientId, source: 'MISSION_EXPLORER', sourceKey: 'mission:explorer:once', percent: 3 })
  }
  const activeCampaigns = await supabase.from('reward_campaigns').select('*').eq('active', true).lte('starts_at', now.toISOString()).gt('ends_at', now.toISOString()).limit(100)
  if (activeCampaigns.error) throw activeCampaigns.error
  const campaignProgress = []
  for (const campaign of activeCampaigns.data || []) {
    const campaignEvents = all.filter(e => Date.parse(e.paid_at) >= Date.parse(campaign.starts_at) && Date.parse(e.paid_at) <= now.getTime() && e.currency === 'CUP' && Number(e.base_amount || e.amount) > Number(campaign.minimum_purchase_cup || 0))
    const count = campaignEvents.length
    // Expose the already-configured campaign rules so the client can explain them verbatim.
    // These fields are presentation metadata only; eligibility and coupon issuance stay here.
    campaignProgress.push({
      id: campaign.id, campaign_id: campaign.id, campaign_key: campaign.campaign_key, title: campaign.title, description: campaign.description,
      starts_at: campaign.starts_at, ends_at: campaign.ends_at, minimum_purchase_cup: Number(campaign.minimum_purchase_cup || 0),
      required_purchases: Number(campaign.required_purchases), progress: count, target: Number(campaign.required_purchases),
      completed: count >= Number(campaign.required_purchases), reward_percent: Number(campaign.reward_percent),
      reward_minimum_subtotal_cup: Number(campaign.reward_minimum_subtotal_cup || 0),
    })
    if (count >= Number(campaign.required_purchases)) {
      await issueCoupon({ clientId, source: 'MISSION_FLASH', sourceKey: `campaign:${campaign.id}`, percent: Number(campaign.reward_percent), minimumSubtotalCup: Number(campaign.reward_minimum_subtotal_cup || 0) })
    }
  }
  return { period, all, currentMonthCount: currentMonth.length, currentWeekDays: daySet.size, currentWeekDayKeys, previousWeekDays: previousWeekDays.size, campaignProgress }
}

async function recordPaidPurchase(client, { source, orderId, amount, baseAmount = null, currency = 'CUP', paidAt = null, itemCount = 1, hasGameMarket = null, hasEtecsa = null }) {
  const sourceName = String(source || '').toUpperCase()
  if (!['GAME_MARKET', 'ETECSA', 'CART'].includes(sourceName) || !orderId) return { recorded: false }
  const paidTime = paidAt || new Date().toISOString()
  const finalAmount = Number(amount)
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) return { recorded: false }
  const { data: inserted, error } = await supabase.from('reward_purchase_events').insert({
    client_id: client.id, source: sourceName, source_order_id: String(orderId), currency: String(currency || 'CUP').toUpperCase() === 'SALDO' ? 'SALDO' : 'CUP',
    amount: finalAmount, base_amount: Number.isFinite(Number(baseAmount)) ? Number(baseAmount) : finalAmount,
    item_count: Math.max(1, Math.min(100, Number(itemCount) || 1)), paid_at: paidTime, event_status: 'VALID',
    has_game_market: hasGameMarket === null ? sourceName === 'GAME_MARKET' : hasGameMarket === true,
    has_etecsa: hasEtecsa === null ? sourceName === 'ETECSA' : hasEtecsa === true,
  }).select('*').single()
  if (error && error.code !== '23505') throw error

  const profile = await getProfile(client.id)
  if (profile) {
    const patch = { updated_at: new Date().toISOString() }
    if (!profile.first_paid_purchase_at) patch.first_paid_purchase_at = paidTime
    if (String(currency).toUpperCase() === 'CUP' && !profile.first_cup_purchase_at) patch.first_cup_purchase_at = paidTime
    await supabase.from('reward_profiles').update(patch).eq('client_id', client.id)
  }
  // These operations are idempotent and run on retries too. If the event was saved but
  // a later mission/referral write failed, the next settlement retry repairs the rewards.
  await qualifyReferralForFirstPurchase(client.id, String(client.device_id || ''), paidTime)
  await evaluateMissionRewards(client.id)
  // "El regreso del héroe": after 30 days without a paid purchase, a >3,000 CUP purchase earns a coupon.
  if (String(currency).toUpperCase() === 'CUP' && Number(baseAmount || finalAmount) > 3000) {
    const previous = await supabase.from('reward_purchase_events').select('paid_at').eq('client_id', client.id).eq('event_status', 'VALID').neq('source_order_id', String(orderId)).lt('paid_at', paidTime).order('paid_at', { ascending: false }).limit(1)
    if (previous.error) throw previous.error
    if (previous.data?.length && Date.parse(paidTime) - Date.parse(previous.data[0].paid_at) >= 30 * 86400000) {
      await issueCoupon({ clientId: client.id, source: 'MISSION_RETURN', sourceKey: `mission:return:${orderId}`, percent: 3 })
    }
  }
  return { recorded: Boolean(inserted), purchaseEventId: inserted?.id || null }
}

async function finalizePaidOrder(client, { source, order }) {
  if (!order) return { recorded: false }
  const hasRewardCommitment = Boolean(order.reward_coupon_id || order.welcome_discount)
  // If rewards are off, do no reward DB access unless a previously-created discounted
  // order is being settled. Existing payment/fulfilment must never depend on missions.
  if (!rewardsEnabled() && !hasRewardCommitment) return { recorded: false }
  const orderRef = `${String(source).toUpperCase()}:${order.id}`
  try {
    let rewardOwner = client
    if (order.client_id && String(client?.id || '') !== String(order.client_id)) {
      const { data: owner, error: ownerError } = await supabase.from('clients').select('id,device_id,active,role,expires_at,store_only').eq('id', order.client_id).maybeSingle()
      if (ownerError) throw ownerError
      if (!owner) throw errorWithStatus('No se pudo resolver el cliente de la compra.', 503, 'REWARD_OWNER_NOT_FOUND')
      rewardOwner = owner
    }
    if (order.reward_coupon_id) {
      // Consume only the reservation belonging to this exact order. Never steal a coupon
      // reserved by a concurrent checkout.
      const { error } = await supabase.from('reward_coupons').update({ status: 'USED', used_at: order.paid_at || new Date().toISOString(), used_order_ref: orderRef, reserved_order_ref: null, reserved_until: null })
        .eq('id', order.reward_coupon_id).eq('client_id', rewardOwner.id).eq('reserved_order_ref', orderRef).eq('status', 'RESERVED')
      if (error) throw error
    }
    if (order.welcome_discount) {
      const { error } = await supabase.from('reward_profiles').update({ welcome_used_at: order.paid_at || new Date().toISOString(), welcome_reserved_order_ref: null, welcome_reserved_until: null, updated_at: new Date().toISOString() })
        .eq('client_id', rewardOwner.id).eq('welcome_reserved_order_ref', orderRef)
      if (error) throw error
    }
    if (!rewardsEnabled()) return { recorded: false, rewardCommitmentFinalized: true }
    return await recordPaidPurchase(rewardOwner, {
      source, orderId: order.id, amount: Number(order.payment_amount), baseAmount: Number(order.reward_base_amount || order.payment_amount),
      currency: order.price_basis || 'CUP', paidAt: order.paid_at || new Date().toISOString(), itemCount: Number(order.reward_item_count || 1),
      hasGameMarket: order.has_game_market === true || String(source).toUpperCase() === 'GAME_MARKET',
      hasEtecsa: order.has_etecsa === true || String(source).toUpperCase() === 'ETECSA',
    })
  } catch (error) {
    // This runs after the primary payment was accepted. A rewards DB problem must not
    // abort provider submission or SMS reconciliation; retries can repair the ledger.
    console.error(JSON.stringify({ event: 'REWARD_FINALIZATION_FAILED', source: String(source || '').toUpperCase(), order_id: String(order.id || ''), code: error?.code || 'REWARD_ERROR' }))
    return { recorded: false, retryable: true }
  }
}

async function getDashboard(client, installedAt = null) {
  const profile = await ensureProfile(client, installedAt)
  await issueReferralMilestonesForDashboard(client.id)
  const mission = await evaluateMissionRewards(client.id)
  const { count: referralsCount, error: referralCountError } = await supabase.from('reward_referrals').select('id', { count: 'exact', head: true })
    .eq('referrer_client_id', client.id).eq('status', 'QUALIFIED')
  if (referralCountError) throw referralCountError
  // A registered referral is someone who linked this code; a valid referral is only
  // counted by reward_referrals after their first verified paid purchase. This is read-only.
  const { count: referralsRegisteredCount, error: registeredReferralError } = await supabase.from('reward_profiles')
    .select('client_id', { count: 'exact', head: true }).eq('referred_by_client_id', client.id)
  if (registeredReferralError) throw registeredReferralError
  const couponResult = await supabase.from('reward_coupons').select('id,coupon_code,source,source_key,discount_percent,minimum_subtotal_cup,minimum_exclusive,status,issued_at,expires_at,used_at')
    .eq('client_id', client.id).order('issued_at', { ascending: false }).limit(1000)
  if (couponResult.error) throw couponResult.error
  const welcomeEndsAt = new Date(Date.parse(profile.welcome_started_at) + WELCOME_WINDOW_MS).toISOString()
  const remaining = Math.max(0, Date.parse(welcomeEndsAt) - Date.now())
  const monthStart = mission.period.monthStart.toISOString()
  const monthEnd = mission.period.monthEnd.toISOString()
  const weeklyStart = mission.period.weekStart.toISOString()
  const weeklyEnd = mission.period.weekEnd.toISOString()
  const monthlyGoalProgress = mission.currentMonthCount
  const weeklyGoalProgress = mission.currentWeekDays
  const linkedReferral = profile.referred_by_client_id ? { linked: true, code: profile.referred_by_code, linked_at: profile.referral_bound_at } : { linked: false, code: null, linked_at: null }
  const nowMs = Date.now()
  const welcomeReserved = Boolean(profile.welcome_reserved_order_ref && Date.parse(profile.welcome_reserved_until || '') > nowMs)
  const welcomeUsed = Boolean(profile.welcome_used_at)
  const firstCupAlreadyPurchased = Boolean(profile.first_cup_purchase_at)
  const welcomeStatus = welcomeUsed ? 'USED'
    : welcomeReserved ? 'PENDING_CONFIRMATION'
      : (remaining <= 0 || firstCupAlreadyPurchased) ? 'EXPIRED'
        : 'AVAILABLE'
  const lastPaidEvent = mission.all.reduce((latest, event) => {
    const at = Date.parse(event.paid_at || '')
    return Number.isFinite(at) && at > (latest?.at || 0) ? { at, paid_at: event.paid_at } : latest
  }, null)
  const returnEligibleAt = lastPaidEvent ? new Date(lastPaidEvent.at + 30 * 86400000).toISOString() : null
  const recentThirty = mission.all.filter(event => Date.parse(event.paid_at || '') >= nowMs - 30 * 86400000)
  const lastServiceEventAt = sourcePredicate => recentThirty
    .filter(sourcePredicate)
    .reduce((latest, event) => Math.max(latest, Date.parse(event.paid_at || '') || 0), 0)
  const lastGameMarketAt = lastServiceEventAt(event => event.has_game_market === true || event.source === 'GAME_MARKET')
  const lastEtecsaAt = lastServiceEventAt(event => event.has_etecsa === true || event.source === 'ETECSA')
  const gameMarketCompleted = lastGameMarketAt > 0
  const etecsaCompleted = lastEtecsaAt > 0
  const explorerExpiresAt = gameMarketCompleted !== etecsaCompleted
    ? new Date((gameMarketCompleted ? lastGameMarketAt : lastEtecsaAt) + 30 * 86400000).toISOString()
    : null
  const missions = [
    { id: 'welcome', title: 'Oferta de bienvenida', description: 'Descuento automático en tu primera compra en CUP, durante las primeras 24 horas.', progress: profile.first_cup_purchase_at ? 1 : (remaining > 0 ? 0 : 0), target: 1, completed: Boolean(profile.welcome_used_at || profile.first_cup_purchase_at), expires_at: welcomeEndsAt, remaining_ms: remaining, reward: '3%, 7% o 10% según el total en CUP' },
    { id: 'referrals_10', title: 'Embajador · 10 referidos', description: 'Invita a diez clientes que completen su primera compra pagada.', progress: Math.min(10, Number(referralsCount || 0)), target: 10, completed: Number(referralsCount || 0) >= 10, reward: 'Cupón del 5%' },
    { id: 'referrals_20', title: 'Embajador · 20 referidos', description: 'Consigue veinte referidos válidos.', progress: Math.min(20, Number(referralsCount || 0)), target: 20, completed: Number(referralsCount || 0) >= 20, reward: 'Cupón del 10% para carritos superiores a 8.000 CUP' },
    { id: 'referrals_30', title: 'Embajador · 30 referidos', description: 'Consigue treinta referidos válidos.', progress: Math.min(30, Number(referralsCount || 0)), target: 30, completed: Number(referralsCount || 0) >= 30, reward: 'Cupón del 15% para carritos superiores a 25.000 CUP' },
    { id: 'monthly', title: 'Cliente frecuente', description: 'Completa tres compras pagadas de más de 15.000 CUP durante este mes.', progress: Math.min(3, monthlyGoalProgress), target: 3, completed: monthlyGoalProgress >= 3, period_key: mission.period.monthKey, period_start: monthStart, period_end: monthEnd, reward: 'Cupón del 7%' },
    { id: 'weekly', title: 'Racha semanal', description: 'Compra por más de 1.000 CUP en cinco días distintos de esta semana.', progress: Math.min(5, weeklyGoalProgress), target: 5, completed: weeklyGoalProgress >= 5, period_key: mission.period.weekKey, period_start: weeklyStart, period_end: weeklyEnd, reward: 'Cupón del 3%' },
    { id: 'recruit', title: 'Recluta novato', description: 'Consigue tres referidos válidos.', progress: Math.min(3, Number(referralsCount || 0)), target: 3, completed: Number(referralsCount || 0) >= 3, reward: 'Cupón del 2%' },
    { id: 'explorer', title: 'Explorador de SynthesisOne', description: 'Compra en Game Market y ETECSA dentro de un periodo de 30 días.', progress: Number(gameMarketCompleted) + Number(etecsaCompleted), target: 2, completed: gameMarketCompleted && etecsaCompleted, game_market_completed: gameMarketCompleted, etecsa_completed: etecsaCompleted, expires_at: explorerExpiresAt, reward: 'Cupón del 3%' },
    { id: 'collector', title: 'Coleccionista de ofertas', description: 'Completa una compra con al menos tres ofertas en un mismo carrito.', progress: mission.all.some(e => Number(e.item_count) >= 3) ? 1 : 0, target: 1, completed: mission.all.some(e => Number(e.item_count) >= 3), reward: 'Cupón del 3%' },
    { id: 'return', title: 'El regreso del héroe', description: 'Vuelve después de 30 días sin compras y realiza una compra superior a 3.000 CUP.', progress: couponResult.data.filter(c => c.source === 'MISSION_RETURN').length > 0 ? 1 : 0, target: 1, completed: couponResult.data.some(c => c.source === 'MISSION_RETURN'), reward: 'Cupón del 3%' },
    { id: 'streak', title: 'Racha imparable', description: 'Completa la misión semanal durante dos semanas consecutivas.', progress: (mission.previousWeekDays >= 5 ? 1 : 0) + (weeklyGoalProgress >= 5 ? 1 : 0), target: 2, completed: mission.previousWeekDays >= 5 && weeklyGoalProgress >= 5, period_key: mission.period.weekKey, period_start: weeklyStart, period_end: weeklyEnd, reward: 'Cupón del 3% por mantener la racha' },
    ...mission.campaignProgress.map(c => ({ id: `flash:${c.campaign_key}`, type: 'flash', ...c, reward: `Cupón del ${c.reward_percent}%` })),
  ]
  return {
    ok: true,
    profile: {
      referral_code: profile.referral_code, referred_by: linkedReferral,
      referrals_count: Number(referralsCount || 0), referrals_registered_count: Number(referralsRegisteredCount || 0),
    },
    welcome: {
      started_at: profile.welcome_started_at, ends_at: welcomeEndsAt, remaining_ms: remaining,
      available: welcomeStatus === 'AVAILABLE', status: welcomeStatus,
      reserved_until: welcomeReserved ? profile.welcome_reserved_until : null, discount_tiers: WELCOME_DISCOUNT_TIERS,
    },
    return_mission: { last_paid_purchase_at: lastPaidEvent?.paid_at || null, eligible_at: returnEligibleAt, eligible: Boolean(lastPaidEvent && nowMs >= lastPaidEvent.at + 30 * 86400000) },
    missions,
    coupons: couponResult.data || [],
    progress: {
      monthly_purchases_over_15000: monthlyGoalProgress, weekly_distinct_days_over_1000: weeklyGoalProgress,
      weekly_day_keys: mission.currentWeekDayKeys,
    },
  }
}

async function issueReferralMilestonesForDashboard(clientId) {
  // Re-evaluation is idempotent; UNIQUE(client_id, source, source_key) prevents duplicate rewards.
  const { count, error } = await supabase.from('reward_referrals').select('id', { count: 'exact', head: true })
    .eq('referrer_client_id', clientId).eq('status', 'QUALIFIED')
  if (error) throw error
  const n = Number(count || 0)
  if (n >= 3) await issueCoupon({ clientId, source: 'MISSION_RECRUIT', sourceKey: 'mission:recruit:once', percent: 2 })
  if (n >= 10) await issueCoupon({ clientId, source: 'REFERRALS', sourceKey: 'referrals:10', percent: 5 })
  if (n >= 20) await issueCoupon({ clientId, source: 'REFERRALS', sourceKey: 'referrals:20', percent: 10, minimumSubtotalCup: 8000, minimumExclusive: true })
  if (n >= 30) await issueCoupon({ clientId, source: 'REFERRALS', sourceKey: 'referrals:30', percent: 15, minimumSubtotalCup: 25000, minimumExclusive: true })
}

async function createCampaign(adminClientId, body) {
  const campaignKey = cleanText(body?.campaign_key, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const title = cleanText(body?.title, 100)
  const description = cleanText(body?.description, 500)
  const startsAt = Date.parse(body?.starts_at || '')
  const endsAt = Date.parse(body?.ends_at || '')
  const minimumPurchase = Number(body?.minimum_purchase_cup || 0)
  const requiredPurchases = Number(body?.required_purchases || 1)
  const rewardPercent = Number(body?.reward_percent || 0)
  const rewardMinimum = Number(body?.reward_minimum_subtotal_cup || 0)
  if (!campaignKey || !title || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt ||
      !Number.isFinite(minimumPurchase) || minimumPurchase < 0 || !Number.isInteger(requiredPurchases) || requiredPurchases < 1 || requiredPurchases > 100 ||
      !Number.isFinite(rewardPercent) || rewardPercent <= 0 || rewardPercent > 100 || !Number.isFinite(rewardMinimum) || rewardMinimum < 0) {
    throw errorWithStatus('Revisa el nombre, fechas, objetivo y descuento de la campaña.', 400, 'INVALID_CAMPAIGN')
  }
  const { data, error } = await supabase.from('reward_campaigns').upsert({
    campaign_key: campaignKey, title, description, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(),
    minimum_purchase_cup: minimumPurchase, required_purchases: requiredPurchases, reward_percent: rewardPercent,
    reward_minimum_subtotal_cup: rewardMinimum, active: body?.active === true, created_by: adminClientId, updated_at: new Date().toISOString(),
  }, { onConflict: 'campaign_key' }).select('*').single()
  if (error) throw error
  return data
}

async function listCampaigns({ activeOnly = false } = {}) {
  let query = supabase.from('reward_campaigns').select('*').order('starts_at', { ascending: false }).limit(100)
  if (activeOnly) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

module.exports = {
  WELCOME_WINDOW_MS, WELCOME_DISCOUNT_TIERS, welcomePercent, roundedDiscount, periodInfo, rewardsEnabled, rewardsSchemaReady,
  ensureProfile, applyReferral, calculateDiscount, reserveDiscount, releaseDiscount,
  recordPaidPurchase, finalizePaidOrder, getDashboard, issueCoupon, createCampaign, listCampaigns,
}
