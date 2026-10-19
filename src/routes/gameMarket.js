'use strict'

const express = require('express')
const crypto = require('crypto')
const supabase = require('../supabase')
const { clientSafePackageData } = require('../utils/clientSafePackageData')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { bot, ADMINS } = require('../telegram')
const { roundToStep, computePrices, normalizeMarketPricing } = require('../utils/gamePricing')

const router = express.Router()
const AVATAR_BUCKET = 'so-profile-avatars'
const GAME_BUCKET = 'so-game-thumbnails'
const KYC_BUCKET = 'so-reseller-kyc'
const MAX_IMAGE_BYTES = 1_500_000
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const THEMES = new Set(['violet', 'light', 'red', 'green', 'cyan'])
const RESELLER_STATUSES = new Set(['pending_review', 'changes_requested', 'approved_awaiting_deposit', 'active', 'rejected', 'suspended', 'expired'])

function tokenFrom(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}
function fail(status, message) { const e = new Error(message); e.status = status; return e }
function cleanText(value, max = 500) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}
function bool(value, fallback = false) { return typeof value === 'boolean' ? value : (value === 'true' || value === 1 || value === '1' ? true : value === 'false' || value === 0 || value === '0' ? false : fallback) }
function number(value, field, { min = 0, max = 1e9, optional = false } = {}) {
  if ((value === '' || value === null || value === undefined) && optional) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw fail(400, `${field} fuera de rango`)
  return n
}
function slugify(v) { return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) }
function isExpired(v) { if (!v) return false; const d = new Date(v); return !Number.isNaN(d.getTime()) && d < new Date() }

async function optionalClient(token, req = null) {
  if (!token) return null
  await requireNonRevokedToken(token)
  const { data, error } = await supabase.from('clients')
    .select('id, name, token, active, token_used, device_id, expires_at, role, wallet, phone_number')
    .eq('token', token).maybeSingle()
  if (error) throw error
  if (!data) throw fail(401, 'Token inválido')
  if (data.active === false || isExpired(data.expires_at)) throw fail(403, 'Licencia inactiva o expirada')
  // Keep Game Market and KYC bound to the same device that existing license verification authorized.
  // This endpoint must not create a way to reuse a copied token on another phone.
  const boundDevice = String(data.device_id || '').trim()
  const requestedDevice = String(req?.headers?.['x-device-id'] || req?.body?.device_id || '').trim()
  if (boundDevice && requestedDevice !== boundDevice) throw fail(403, 'Dispositivo no autorizado para esta licencia')
  return data
}
async function requiredClient(req, res, next) {
  try {
    const token = tokenFrom(req)
    if (!token) return res.status(401).json({ error: 'Se requiere una sesión válida para esta operación' })
    req.client = await optionalClient(token, req)
    return next()
  } catch (e) { return sendError(res, e, 'No se pudo validar el cliente') }
}
function requiredAdmin(req, res, next) {
  if (String(req.client?.role || '').toLowerCase() !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede realizar esta operación' })
  return next()
}
function sendError(res, error, context) {
  if (error?.status) {
    console.warn(`[Game Market] ${context}: HTTP ${error.status} - ${error.message}`)
    return res.status(error.status).json({ error: error.message })
  }
  if (error?.code === '23505') return res.status(409).json({ error: 'El nombre de usuario o identificador ya existe' })
  console.error(`[Game Market] ${context}:`, {
    code: error?.code, message: error?.message, details: error?.details, hint: error?.hint
  })
  return res.status(500).json({ error: 'Error interno del servidor. El evento quedó registrado en los logs del backend.' })
}

function decodeImage(body, prefix = 'image') {
  const type = String(body?.[`${prefix}_content_type`] || body?.content_type || 'image/jpeg').toLowerCase().split(';')[0].trim()
  if (!IMAGE_TYPES.has(type)) throw fail(400, 'Formato de imagen no permitido; utiliza JPG, PNG o WebP')
  let encoded = String(body?.[`${prefix}_base64`] || body?.image_base64 || '').trim().replace(/^data:image\/(?:jpeg|png|webp);base64,/i, '')
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw fail(400, 'Imagen codificada no válida')
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw fail(413, 'Cada imagen debe pesar como máximo 1,5 MB una vez optimizada')
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!((type === 'image/jpeg' && jpeg) || (type === 'image/png' && png) || (type === 'image/webp' && webp))) throw fail(400, 'El contenido no coincide con el formato de imagen declarado')
  return { bytes, type, extension: type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg' }
}
async function uploadPrivate(bucket, path, image) {
  const { error } = await supabase.storage.from(bucket).upload(path, image.bytes, { contentType: image.type, cacheControl: '3600', upsert: false })
  if (error) throw error
}
async function signedUrl(bucket, path, seconds = 300) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) { console.error('Error generando URL temporal:', error.message); return null }
  return data?.signedUrl || null
}
function publicGameUrl(path) {
  if (!path) return null
  return supabase.storage.from(GAME_BUCKET).getPublicUrl(path).data?.publicUrl || null
}

async function pricingFor(tier) {
  const key = tier === 'reseller' ? 'game_market_pricing:reseller' : 'game_market_pricing:normal'
  const { data, error } = await supabase.from('synthesisone_settings').select('value').eq('key', key).maybeSingle()
  if (error) throw error
  // Prices must come from the database, never a silent, hard-coded exchange-rate fallback.
  return normalizeMarketPricing(data?.value)
}
async function platformStoreId() {
  const { data, error } = await supabase.from('game_market_stores').select('id').eq('slug', 'synthesisone').maybeSingle()
  if (error) throw error
  if (!data) throw fail(503, 'El catálogo no está inicializado; el administrador debe aplicar la migración SQL 009')
  return data.id
}
async function resellerActive(clientId) {
  const { data, error } = await supabase.from('reseller_profiles').select('status').eq('client_id', String(clientId)).maybeSingle()
  if (error) throw error
  return data?.status === 'active'
}
async function catalogPayload(tier, admin = false) {
  const storeId = await platformStoreId()
  const { data: games, error: gameError } = await supabase.from('game_market_games')
    .select('id, slug, name, description, category, thumbnail_path, badge, is_active, sort_order')
    .eq('store_id', storeId).order('sort_order').order('name')
  if (gameError) throw gameError
  const gameRows = admin ? (games || []) : (games || []).filter(g => g.is_active)
  const normalRule = await pricingFor('normal')
  const resellerRule = await pricingFor('reseller')
  const ids = gameRows.map(g => g.id)
  let offers = []
  if (ids.length) {
    const { data, error } = await supabase.from('game_market_offers')
      .select('id, game_id, title, description, category, package_data, price_cup, price_saldo, price_reseller_cup, price_reseller_saldo, base_cost_usd, auto_pricing, available, published, sort_order')
      .eq('store_id', storeId).in('game_id', ids).order('sort_order').order('title')
    if (error) throw error
    offers = (data || []).filter(o => admin || o.published)
  }
  const mappedOffers = offers.map(o => {
    let normalCup = Number(o.price_cup || 0)
    let normalSaldo = Number(o.price_saldo || 0)
    let resellerCup = o.price_reseller_cup == null ? null : Number(o.price_reseller_cup)
    let resellerSaldo = o.price_reseller_saldo == null ? null : Number(o.price_reseller_saldo)
    if (o.auto_pricing && o.base_cost_usd !== null && o.base_cost_usd !== undefined) {
      // Auto-priced offers are derived from the active per-tier settings at read time.
      // Never keep a stale previously calculated value after an admin changes a rate.
      const np = computePrices(Number(o.base_cost_usd), normalRule)
      const rp = computePrices(Number(o.base_cost_usd), resellerRule)
      normalCup = np.price_cup; normalSaldo = np.price_saldo
      resellerCup = rp.price_cup; resellerSaldo = rp.price_saldo
    }
    const out = {
      id: o.id, game_id: o.game_id, title: o.title, description: o.description || '', category: o.category || 'Paquete',
      package_data: admin ? (o.package_data || {}) : clientSafePackageData(o.package_data),
      price_cup: tier === 'reseller' ? (resellerCup === null ? normalCup : resellerCup) : normalCup,
      price_saldo: tier === 'reseller' ? (resellerSaldo === null ? normalSaldo : resellerSaldo) : normalSaldo,
      available: !!o.available, published: !!o.published, sort_order: o.sort_order || 0,
    }
    if (admin) {
      out.base_cost_usd = o.base_cost_usd === null ? null : Number(o.base_cost_usd)
      out.auto_pricing = !!o.auto_pricing
      out.price_reseller_cup = resellerCup
      out.price_reseller_saldo = resellerSaldo
      out.price_normal_cup = normalCup
      out.price_normal_saldo = normalSaldo
    }
    return out
  })
  return {
    pricing_tier: tier,
    games: gameRows.map(g => ({
      id: g.id, slug: g.slug, name: g.name, description: g.description || '', category: g.category || 'Juegos',
      thumbnail_path: g.thumbnail_path || null, thumbnail_url: publicGameUrl(g.thumbnail_path), badge: g.badge || '',
      is_active: !!g.is_active, sort_order: g.sort_order || 0,
      offers: mappedOffers.filter(o => o.game_id === g.id),
    })),
  }
}

// Public catalog only exposes the normal tier. If the token is valid, its active reseller status determines tier.
router.get('/catalog', async (req, res) => {
  try {
    const client = await optionalClient(tokenFrom(req), req)
    const tier = client && await resellerActive(client.id) ? 'reseller' : 'normal'
    const payload = await catalogPayload(tier, false)
    return res.json(payload)
  } catch (e) { return sendError(res, e, 'GET market catalog') }
})
router.get('/profile', requiredClient, async (req, res) => {
  try {
    const id = String(req.client.id)
    const { data, error } = await supabase.from('synthesisone_profiles').select('*').eq('client_id', id).maybeSingle()
    if (error) throw error
    const profile = data || { client_id: id, display_name: req.client.name || '', theme: 'violet', age: null, province: null, municipality: null, username: null, avatar_path: null, display_name_public: false, avatar_public: false, age_public: false, location_public: false, local_data_imported: false }
    return res.json({ ok: true, profile: { ...profile, avatar_url: await signedUrl(AVATAR_BUCKET, profile.avatar_path, 3600), avatar_path: undefined } })
  } catch (e) { return sendError(res, e, 'GET market profile') }
})
router.put('/profile', requiredClient, async (req, res) => {
  try {
    const b = req.body || {}
    const patch = { client_id: String(req.client.id), updated_at: new Date().toISOString() }
    if ('display_name' in b) patch.display_name = cleanText(b.display_name, 80)
    if ('username' in b) {
      const u = String(b.username || '').trim().replace(/^@/, '').toLowerCase()
      if (u && !/^[a-z0-9_]{3,20}$/.test(u)) throw fail(400, 'Username: 3–20 caracteres, letras, números o guion bajo')
      patch.username = u || null
    }
    if ('theme' in b) { const t = String(b.theme || 'violet'); if (!THEMES.has(t)) throw fail(400, 'Tema no válido'); patch.theme = t }
    for (const [field, max] of [['province', 80], ['municipality', 100]]) if (field in b) patch[field] = cleanText(b[field], max)
    if ('age' in b) { const a = b.age === null || b.age === '' ? null : number(b.age, 'age', { min: 1, max: 120 }); patch.age = a }
    for (const f of ['display_name_public', 'avatar_public', 'age_public', 'location_public']) if (f in b) { if (typeof b[f] !== 'boolean') throw fail(400, `${f} debe ser booleano`); patch[f] = b[f] }
    if ('province' in patch && !patch.province) patch.municipality = null
    const { data, error } = await supabase.from('synthesisone_profiles').upsert(patch, { onConflict: 'client_id' }).select('*').single()
    if (error) throw error
    return res.json({ ok: true, profile: data })
  } catch (e) { return sendError(res, e, 'PUT market profile') }
})
router.post('/profile/import-local', requiredClient, async (req, res) => {
  try {
    const id = String(req.client.id)
    const { data: current, error: getError } = await supabase.from('synthesisone_profiles').select('*').eq('client_id', id).maybeSingle()
    if (getError) throw getError
    if (current?.local_data_imported) return res.json({ ok: true, imported: false, profile: current })
    const b = req.body || {}
    const patch = { client_id: id, local_data_imported: true, updated_at: new Date().toISOString() }
    if (!current?.display_name && cleanText(b.display_name, 80)) patch.display_name = cleanText(b.display_name, 80)
    if (!current?.username && cleanText(b.username, 24)) {
      const username = String(b.username).trim().replace(/^@/, '').toLowerCase()
      if (/^[a-z0-9_]{3,20}$/.test(username)) {
        const { data: duplicate, error: duplicateError } = await supabase.from('synthesisone_profiles').select('client_id').eq('username', username).neq('client_id', id).maybeSingle()
        if (duplicateError) throw duplicateError
        if (!duplicate) patch.username = username
      }
    }
    if (!current?.theme && THEMES.has(String(b.theme))) patch.theme = String(b.theme)
    if (!current?.province && cleanText(b.province, 80)) patch.province = cleanText(b.province, 80)
    if (!current?.municipality && cleanText(b.municipality, 100)) patch.municipality = cleanText(b.municipality, 100)
    if ((current?.age === null || current?.age === undefined) && b.age !== null && b.age !== '' && b.age !== undefined) {
      const age = Number(b.age); if (Number.isInteger(age) && age >= 1 && age <= 120) patch.age = age
    }
    for (const f of ['display_name_public', 'avatar_public', 'age_public', 'location_public']) {
      if (!current?.[f] && b[f] === true) patch[f] = true
    }
    const { data, error } = await supabase.from('synthesisone_profiles').upsert(patch, { onConflict: 'client_id' }).select('*').single()
    if (error) throw error
    return res.json({ ok: true, imported: true, profile: data })
  } catch (e) { return sendError(res, e, 'POST profile import local') }
})

router.post('/profile/avatar', requiredClient, async (req, res) => {
  try {
    const image = decodeImage(req.body || {})
    const id = String(req.client.id)
    const path = `${id}/${crypto.randomUUID()}.${image.extension}`
    await uploadPrivate(AVATAR_BUCKET, path, image)
    const { data: old } = await supabase.from('synthesisone_profiles').select('avatar_path').eq('client_id', id).maybeSingle()
    const { data, error } = await supabase.from('synthesisone_profiles').upsert({ client_id: id, avatar_path: path, updated_at: new Date().toISOString() }, { onConflict: 'client_id' }).select('*').single()
    if (error) { await supabase.storage.from(AVATAR_BUCKET).remove([path]); throw error }
    if (old?.avatar_path) await supabase.storage.from(AVATAR_BUCKET).remove([old.avatar_path])
    return res.json({ ok: true, profile: { ...data, avatar_url: await signedUrl(AVATAR_BUCKET, path, 3600), avatar_path: undefined } })
  } catch (e) { return sendError(res, e, 'POST profile avatar') }
})

router.get('/admin/catalog', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const payload = await catalogPayload('normal', true)
    payload.pricing = { normal: await pricingFor('normal'), reseller: await pricingFor('reseller') }
    return res.json(payload)
  } catch (e) { return sendError(res, e, 'GET admin catalog') }
})
router.put('/admin/pricing', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const tier = req.body?.tier === 'reseller' ? 'reseller' : 'normal'
    const b = req.body || {}
    const pricing = {
      usd_to_cup: number(b.usd_to_cup, 'usd_to_cup', { min: 0.000001 }),
      usd_to_saldo: number(b.usd_to_saldo, 'usd_to_saldo', { min: 0.000001 }),
      profit_margin_pct: number(b.profit_margin_pct ?? 0, 'profit_margin_pct', { min: 0, max: 10000 }),
      cup_rounding_step: number(b.cup_rounding_step ?? 5, 'cup_rounding_step', { min: 1, max: 1e6 }),
      saldo_rounding_step: number(b.saldo_rounding_step ?? 1, 'saldo_rounding_step', { min: 1, max: 1e6 }),
      rounding_mode: ['ceil', 'nearest', 'floor'].includes(b.rounding_mode) ? b.rounding_mode : 'ceil',
    }
    if (!Number.isInteger(pricing.cup_rounding_step) || !Number.isInteger(pricing.saldo_rounding_step)) throw fail(400, 'Los pasos de redondeo deben ser enteros')

    // Persist the source-of-truth settings first. Auto-priced offers are calculated
    // dynamically by catalogPayload() from these settings; a separate bulk UPDATE is
    // redundant and could make a successful save appear to fail if one offer update fails.
    const { error } = await supabase.from('synthesisone_settings').upsert({
      key: `game_market_pricing:${tier}`, value: pricing, updated_at: new Date().toISOString()
    }, { onConflict: 'key' })
    if (error) {
      console.error(`[Game Market] No se pudo guardar pricing tier=${tier}:`, {
        code: error.code, message: error.message, details: error.details, hint: error.hint
      })
      throw error
    }
    console.info(`[Game Market] Reglas de precios guardadas: tier=${tier}`)
    return res.json({ ok: true, tier, pricing, recalculation: 'dynamic_on_catalog_read' })
  } catch (e) { return sendError(res, e, 'PUT admin pricing') }
})
router.post('/admin/images', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const image = decodeImage(req.body || {})
    const path = `games/${crypto.randomUUID()}.${image.extension}`
    await uploadPrivate(GAME_BUCKET, path, image)
    return res.status(201).json({ path, url: publicGameUrl(path) })
  } catch (e) { return sendError(res, e, 'POST admin image') }
})
router.post('/admin/games', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId()
    const name = cleanText(req.body?.name, 100)
    const slug = slugify(req.body?.slug || name)
    if (!name || !slug) throw fail(400, 'Nombre requerido')
    const { data, error } = await supabase.from('game_market_games').insert({
      store_id: storeId, slug, name, description: cleanText(req.body.description, 2000), category: cleanText(req.body.category, 80) || 'Juegos',
      thumbnail_path: cleanText(req.body.thumbnail_path, 500), badge: cleanText(req.body.badge, 30), is_active: bool(req.body.is_active, true), sort_order: Number(req.body.sort_order) || 0,
    }).select('*').single()
    if (error) throw error
    return res.status(201).json({ game: data })
  } catch (e) { return sendError(res, e, 'POST admin game') }
})
router.patch('/admin/games/:id', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId(); const b = req.body || {}; const p = { updated_at: new Date().toISOString() }
    if ('name' in b) p.name = cleanText(b.name, 100)
    if ('slug' in b) p.slug = slugify(b.slug)
    if ('description' in b) p.description = cleanText(b.description, 2000)
    if ('category' in b) p.category = cleanText(b.category, 80) || 'Juegos'
    if ('thumbnail_path' in b) p.thumbnail_path = cleanText(b.thumbnail_path, 500)
    if ('badge' in b) p.badge = cleanText(b.badge, 30)
    if ('is_active' in b) p.is_active = bool(b.is_active)
    if ('sort_order' in b) p.sort_order = Number(b.sort_order) || 0
    const { data, error } = await supabase.from('game_market_games').update(p).eq('id', req.params.id).eq('store_id', storeId).select('*').maybeSingle()
    if (error) throw error; if (!data) throw fail(404, 'Juego no encontrado')
    return res.json({ game: data })
  } catch (e) { return sendError(res, e, 'PATCH admin game') }
})
router.delete('/admin/games/:id', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId()
    const { data: game, error: getError } = await supabase.from('game_market_games').select('id, thumbnail_path').eq('id', req.params.id).eq('store_id', storeId).maybeSingle()
    if (getError) throw getError; if (!game) throw fail(404, 'Juego no encontrado')
    const { error } = await supabase.from('game_market_games').delete().eq('id', game.id).eq('store_id', storeId)
    if (error) throw error
    if (game.thumbnail_path) await supabase.storage.from(GAME_BUCKET).remove([game.thumbnail_path])
    return res.json({ ok: true })
  } catch (e) { return sendError(res, e, 'DELETE admin game') }
})
router.post('/admin/games/:id/offers', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId(); const b = req.body || {}; const title = cleanText(b.title, 120)
    if (!title) throw fail(400, 'Nombre de oferta requerido')
    const cost = number(b.base_cost_usd, 'base_cost_usd', { optional: true })
    const normalRule = await pricingFor('normal'); const resellerRule = await pricingFor('reseller')
    const auto = bool(b.auto_pricing)
    const np = auto && cost != null ? computePrices(cost, normalRule) : { price_cup: number(b.price_cup ?? 0, 'price_cup'), price_saldo: number(b.price_saldo ?? 0, 'price_saldo') }
    const rp = auto && cost != null ? computePrices(cost, resellerRule) : { price_cup: number(b.price_reseller_cup ?? np.price_cup, 'price_reseller_cup'), price_saldo: number(b.price_reseller_saldo ?? np.price_saldo, 'price_reseller_saldo') }
    if (auto && cost == null) throw fail(400, 'El coste USD es obligatorio para cálculo automático')
    const { data, error } = await supabase.from('game_market_offers').insert({
      store_id: storeId, game_id: req.params.id, title, description: cleanText(b.description, 1000), category: cleanText(b.category, 80) || 'Paquete',
      package_data: b.package_data && typeof b.package_data === 'object' && !Array.isArray(b.package_data) ? b.package_data : {},
      price_cup: np.price_cup, price_saldo: np.price_saldo, price_reseller_cup: rp.price_cup, price_reseller_saldo: rp.price_saldo,
      base_cost_usd: cost, auto_pricing: auto, available: bool(b.available, true), published: bool(b.published, true), sort_order: Number(b.sort_order) || 0,
    }).select('*').single()
    if (error) throw error
    return res.status(201).json({ offer: data })
  } catch (e) { return sendError(res, e, 'POST admin offer') }
})
router.patch('/admin/offers/:id', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId(); const b = req.body || {}; const p = { updated_at: new Date().toISOString() }
    for (const [f, max] of [['title', 120], ['description', 1000], ['category', 80]]) if (f in b) p[f] = f === 'category' ? (cleanText(b[f], max) || 'Paquete') : cleanText(b[f], max)
    for (const f of ['available', 'published', 'auto_pricing']) if (f in b) p[f] = bool(b[f])
    if ('package_data' in b) p.package_data = b.package_data
    if ('base_cost_usd' in b) p.base_cost_usd = number(b.base_cost_usd, 'base_cost_usd', { optional: true })
    for (const f of ['price_cup', 'price_saldo', 'price_reseller_cup', 'price_reseller_saldo']) if (f in b) p[f] = number(b[f], f)
    const { data: existing, error: getError } = await supabase.from('game_market_offers').select('id, base_cost_usd, auto_pricing').eq('id', req.params.id).eq('store_id', storeId).maybeSingle()
    if (getError) throw getError; if (!existing) throw fail(404, 'Oferta no encontrada')
    const auto = p.auto_pricing ?? existing.auto_pricing
    const cost = Object.prototype.hasOwnProperty.call(p, 'base_cost_usd') ? p.base_cost_usd : existing.base_cost_usd
    if (auto) {
      if (cost == null) throw fail(400, 'El coste USD es obligatorio para cálculo automático')
      const normal = computePrices(cost, await pricingFor('normal')); const reseller = computePrices(cost, await pricingFor('reseller'))
      Object.assign(p, { price_cup: normal.price_cup, price_saldo: normal.price_saldo, price_reseller_cup: reseller.price_cup, price_reseller_saldo: reseller.price_saldo })
    }
    const { data, error } = await supabase.from('game_market_offers').update(p).eq('id', req.params.id).eq('store_id', storeId).select('*').single()
    if (error) throw error
    return res.json({ offer: data })
  } catch (e) { return sendError(res, e, 'PATCH admin offer') }
})
router.delete('/admin/offers/:id', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const storeId = await platformStoreId()
    const { data, error } = await supabase.from('game_market_offers').delete().eq('id', req.params.id).eq('store_id', storeId).select('id').maybeSingle()
    if (error) throw error; if (!data) throw fail(404, 'Oferta no encontrada')
    return res.json({ ok: true })
  } catch (e) { return sendError(res, e, 'DELETE admin offer') }
})

// Reseller application: KYC files remain in a private bucket. No wallet debit or purchase is performed here.
router.get('/reseller/status', requiredClient, async (req, res) => {
  try {
    const id = String(req.client.id)
    const { data: application, error } = await supabase.from('reseller_applications').select('id, status, review_note, submitted_at, reviewed_at, deposit_confirmed, deposit_payment_status, deposit_detected_at, deposit_topup_id, monthly_sales_count, updated_at').eq('client_id', id).order('submitted_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    let { data: profile, error: pError } = await supabase.from('reseller_profiles').select('status, activated_at, deposit_confirmed, monthly_sales_count, last_sales_period').eq('client_id', id).maybeSingle()
    if (pError) throw pError
    if (profile?.status === 'active') {
      const now = new Date()
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
      if (!profile.last_sales_period || String(profile.last_sales_period).slice(0, 10) < periodStart) {
        const { data: reset, error: resetError } = await supabase.from('reseller_profiles').update({ monthly_sales_count: 0, last_sales_period: periodStart, updated_at: now.toISOString() }).eq('client_id', id).select('status, activated_at, deposit_confirmed, monthly_sales_count, last_sales_period').single()
        if (resetError) throw resetError
        profile = reset
        if (application?.status === 'active') {
          const { error: appResetError } = await supabase.from('reseller_applications').update({ monthly_sales_count: 0, updated_at: now.toISOString() }).eq('id', application.id)
          if (appResetError) throw appResetError
          application.monthly_sales_count = 0
        }
      }
    }
    return res.json({ ok: true, application, reseller: profile || { status: 'not_reseller', deposit_confirmed: false, monthly_sales_count: 0 }, monthly_sales_target: 15, deposit_min_cup: 50000, monthly_sales_tracked_manually: true })
  } catch (e) { return sendError(res, e, 'GET reseller status') }
})
router.post('/reseller/applications', requiredClient, async (req, res) => {
  const uploaded = []
  try {
    const b = req.body || {}
    if (b.accepted_terms !== true) throw fail(400, 'Debes aceptar las condiciones de SO Reseller antes de enviar la solicitud')
    const cards = Array.isArray(b.card_numbers) ? b.card_numbers.map(v => String(v).trim()).filter(Boolean).slice(0, 5) : []
    const phones = Array.isArray(b.phone_numbers) ? b.phone_numbers.map(v => String(v).trim()).filter(Boolean).slice(0, 5) : []
    if (!cards.length || cards.some(v => !/^[0-9\- ]{8,24}$/.test(v))) throw fail(400, 'Introduce al menos una tarjeta válida')
    if (!phones.length || phones.some(v => !/^\+?[0-9]{8,15}$/.test(v))) throw fail(400, 'Introduce al menos un teléfono válido')
    const front = decodeImage(b, 'id_front')
    const back = decodeImage(b, 'id_back')
    const selfie = decodeImage(b, 'selfie_with_id')
    const clientId = String(req.client.id)
    const { data: previous, error: previousError } = await supabase.from('reseller_applications').select('id, status').eq('client_id', clientId).in('status', ['pending_review', 'approved_awaiting_deposit', 'active']).maybeSingle()
    if (previousError) throw previousError
    if (previous) throw fail(409, 'Ya existe una solicitud o condición reseller activa')
    const { data: activeProfile, error: activeProfileError } = await supabase.from('reseller_profiles').select('status').eq('client_id', clientId).maybeSingle()
    if (activeProfileError) throw activeProfileError
    if (activeProfile?.status === 'active' || activeProfile?.status === 'approved_awaiting_deposit') throw fail(409, 'Tu condición SO Reseller ya existe; consulta su estado en Ajustes')
    const paths = {}
    for (const [kind, image] of [['id-front', front], ['id-back', back], ['selfie-so-reseller', selfie]]) {
      const path = `${clientId}/${crypto.randomUUID()}-${kind}.${image.extension}`
      await uploadPrivate(KYC_BUCKET, path, image); uploaded.push(path); paths[kind] = path
    }
    const { data, error } = await supabase.from('reseller_applications').insert({
      client_id: clientId, client_name: cleanText(req.client.name, 100), client_phone: cleanText(b.contact_phone, 30),
      card_numbers: cards, phone_numbers: phones, id_front_path: paths['id-front'], id_back_path: paths['id-back'],
      selfie_path: paths['selfie-so-reseller'], accepted_terms: true, status: 'pending_review',
      submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(), monthly_sales_target: 15, deposit_min_cup: 50000,
    }).select('id, status, submitted_at').single()
    if (error) throw error
    // Alert administrators without sending any KYC documents or sensitive card data to Telegram.
    const alert = `🟣 Nueva solicitud SO Reseller\nSolicitante: ${cleanText(req.client.name, 80) || 'Cliente'}\nID interno: ${clientId}\nSolicitud: ${data.id}\nRevisión manual requerida. El plazo informativo es de 24–48 horas.`
    await Promise.allSettled(ADMINS.map(chatId => bot.sendMessage(chatId, alert)))
    return res.status(201).json({ ok: true, application: data, message: 'Solicitud enviada. El equipo de SynthesisOne la revisará normalmente en un plazo de 24–48 horas.' })
  } catch (e) {
    if (uploaded.length) await supabase.storage.from(KYC_BUCKET).remove(uploaded).catch(() => {})
    return sendError(res, e, 'POST reseller application')
  }
})
router.get('/admin/reseller/pending-count', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const { count, error } = await supabase.from('reseller_applications')
      .select('id', { count: 'exact', head: true }).eq('status', 'pending_review')
    if (error) throw error
    return res.json({ pending_count: count || 0 })
  } catch (e) { return sendError(res, e, 'GET admin reseller pending count') }
})

router.get('/admin/reseller/applications', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const status = cleanText(req.query.status, 40)
    let q = supabase.from('reseller_applications').select('id, client_id, client_name, client_phone, card_numbers, phone_numbers, id_front_path, id_back_path, selfie_path, status, review_note, accepted_terms, submitted_at, reviewed_at, deposit_confirmed, deposit_payment_status, deposit_detected_at, deposit_transaction_id, deposit_topup_id, monthly_sales_count, monthly_sales_target, deposit_min_cup').order('submitted_at', { ascending: false }).limit(100)
    if (status && RESELLER_STATUSES.has(status)) q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw error
    const applications = await Promise.all((data || []).map(async a => ({
      ...a,
      documents: {
        id_front_url: await signedUrl(KYC_BUCKET, a.id_front_path),
        id_back_url: await signedUrl(KYC_BUCKET, a.id_back_path),
        selfie_url: await signedUrl(KYC_BUCKET, a.selfie_path),
      },
      id_front_path: undefined, id_back_path: undefined, selfie_path: undefined,
    })))
    return res.json({ applications, pending_count: applications.filter(a => a.status === 'pending_review').length })
  } catch (e) { return sendError(res, e, 'GET admin reseller applications') }
})
router.post('/admin/reseller/applications/:id/review', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const action = String(req.body?.action || '').toLowerCase()
    if (!['approve', 'reject', 'request_changes'].includes(action)) throw fail(400, 'Acción de revisión no válida')
    const note = cleanText(req.body?.note, 1000)
    if (action !== 'approve' && !note) throw fail(400, 'Añade un motivo o instrucciones para el solicitante')
    const { data: app, error: getError } = await supabase.from('reseller_applications').select('*').eq('id', req.params.id).maybeSingle()
    if (getError) throw getError; if (!app) throw fail(404, 'Solicitud no encontrada')
    if (app.status !== 'pending_review') throw fail(409, 'La solicitud ya fue revisada')
    const status = action === 'approve' ? 'approved_awaiting_deposit' : action === 'reject' ? 'rejected' : 'changes_requested'
    const now = new Date().toISOString()
    const { data, error } = await supabase.from('reseller_applications').update({ status, review_note: note, reviewed_at: now, reviewed_by: String(req.client.id), updated_at: now }).eq('id', app.id).select('id, client_id, status, review_note, reviewed_at').single()
    if (error) throw error
    if (action === 'approve') {
      const { error: profileError } = await supabase.from('reseller_profiles').upsert({ client_id: app.client_id, status: 'approved_awaiting_deposit', deposit_confirmed: false, updated_at: now }, { onConflict: 'client_id' })
      if (profileError) throw profileError
    }
    return res.json({ ok: true, application: data, message: action === 'approve' ? 'KYC aprobado. Falta comprobar el depósito de trabajo de 50.000 CUP.' : action === 'reject' ? 'Solicitud rechazada.' : 'Se ha solicitado una corrección.' })
  } catch (e) { return sendError(res, e, 'POST reseller review') }
})
router.post('/admin/reseller/applications/:id/activate', requiredClient, requiredAdmin, async (req, res) => {
  try {
    if (req.body?.deposit_confirmed !== true) throw fail(400, 'Debes confirmar manualmente que el depósito de 50.000 CUP está verificado')
    const { data: app, error: getError } = await supabase.from('reseller_applications')
      .select('id, client_id, status, deposit_payment_status, deposit_topup_id, deposit_detected_at')
      .eq('id', req.params.id).maybeSingle()
    if (getError) throw getError; if (!app) throw fail(404, 'Solicitud no encontrada')
    if (app.status !== 'approved_awaiting_deposit') throw fail(409, 'Primero debe aprobarse el KYC')
    if (app.deposit_payment_status !== 'PAYMENT_DETECTED_PENDING_ADMIN') {
      throw fail(409, 'Todavía no hay un depósito Wallet elegible detectado. No se puede activar reseller sin esa revisión previa.')
    }
    const now = new Date().toISOString()
    const reviewPatch = {
      status: 'active', deposit_confirmed: true, deposit_payment_status: 'APPROVED',
      deposit_reviewed_by: String(req.client.id), deposit_reviewed_at: now,
      activated_at: now, updated_at: now,
    }
    const { data: reviewedApplication, error: appError } = await supabase.from('reseller_applications').update(reviewPatch)
      .eq('id', app.id).eq('status', 'approved_awaiting_deposit')
      .eq('deposit_payment_status', 'PAYMENT_DETECTED_PENDING_ADMIN')
      .select('id').maybeSingle()
    if (appError) throw appError
    if (!reviewedApplication) throw fail(409, 'La solicitud cambió mientras se revisaba. Actualiza la pantalla y vuelve a comprobar el depósito.')
    const { error: profileError } = await supabase.from('reseller_profiles').upsert({
      client_id: app.client_id, ...reviewPatch, monthly_sales_count: 0,
      deposit_topup_id: app.deposit_topup_id, deposit_detected_at: app.deposit_detected_at,
    }, { onConflict: 'client_id' })
    if (profileError) throw profileError
    return res.json({ ok: true, status: 'active', message: 'Depósito revisado manualmente y SO Reseller activado. Los precios especiales estarán disponibles al actualizar el catálogo.' })
  } catch (e) { return sendError(res, e, 'POST reseller activation') }
})


router.post('/admin/reseller/applications/:id/sales-count', requiredClient, requiredAdmin, async (req, res) => {
  try {
    const count = Number(req.body?.monthly_sales_count)
    const reason = cleanText(req.body?.reason, 500)
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw fail(400, 'El total mensual debe ser un entero entre 0 y 100000')
    if (!reason) throw fail(400, 'Escribe el motivo del ajuste manual')
    const { data, error } = await supabase.rpc('so_set_reseller_monthly_sales', {
      p_application_id: req.params.id,
      p_new_count: count,
      p_reason: reason,
      p_admin_client_id: String(req.client.id),
    })
    if (error) throw error
    return res.json(data || { ok: true, monthly_sales_count: count, monthly_sales_target: 15, tracked_manually: true })
  } catch (e) { return sendError(res, e, 'POST reseller monthly sales count') }
})

module.exports = router
