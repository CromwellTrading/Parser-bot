'use strict'

const express = require('express')
const crypto = require('crypto')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canAccessGameMarket } = require('../utils/storeSessionAccess')
const { DEFAULT_MARKET_PRICING, normalizeMarketPricing, calculateOfferPrices } = require('../utils/gamePricing')
const { clientSafePackageData } = require('../utils/clientSafePackageData')
const { readAllRows } = require('../utils/supabasePagination')

const router = express.Router()
const AVATAR_BUCKET = 'so-profile-avatars'
const GAME_IMAGE_BUCKET = 'so-game-thumbnails'
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_THEMES = new Set(['violet', 'light', 'red', 'green', 'cyan'])

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.body?.token || req.query?.token || req.headers['x-client-token'] || null
}

function isExpired(expiresAt) {
  if (!expiresAt) return false
  const expires = new Date(expiresAt)
  return !Number.isNaN(expires.getTime()) && expires < new Date()
}

async function requireClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ error: 'Token de licencia requerido' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase
      .from('clients')
      .select('id, name, token, active, token_used, device_id, expires_at, role, store_only')
      .eq('token', token)
      .maybeSingle()
    if (error) throw error
    if (!client) return res.status(401).json({ error: 'Token inválido' })
    // Device binding applies to free store sessions too. A leaked store token
    // must not be reusable from a different installation.
    const boundDevice = String(client.device_id || '').trim()
    const requestedDevice = String(req.headers['x-device-id'] || '').trim()
    if (boundDevice && (!requestedDevice || requestedDevice !== boundDevice)) {
      return res.status(403).json({ error: 'Dispositivo no autorizado para esta licencia' })
    }
    if (!canAccessGameMarket(client, req.method, req.path)) {
      return res.status(403).json({ code: 'LICENSE_REQUIRED', error: 'Esta función requiere una licencia activa. Las compras de la tienda oficial siguen siendo gratuitas.' })
    }
    req.client = client
    return next()
  } catch (error) {
    if (error.code === 'TOKEN_REVOKED') return res.status(403).json({ error: 'Token revocado' })
    console.error('Error validando cliente para Game Market:', error)
    return res.status(500).json({ error: 'No se pudo validar la sesión' })
  }
}

function requireAdmin(req, res, next) {
  if (String(req.client?.role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ error: 'Esta operación requiere rol de administrador' })
  }
  return next()
}

function cleanText(value, max = 500) {
  if (value === undefined || value === null) return null
  const cleaned = String(value).trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  return fallback
}

function parseNonNegativeNumber(value, field, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) {
    const error = new Error(`${field} debe ser un número válido mayor o igual a cero`)
    error.status = 400
    throw error
  }
  return number
}

function parseWholeSalePrice(value, field) {
  const number = parseNonNegativeNumber(value, field)
  if (!Number.isInteger(number)) {
    const error = new Error(`${field} debe ser un importe entero`)
    error.status = 400
    throw error
  }
  return number
}

async function getPricingSettings() {
  const { data, error } = await supabase.from('synthesisone_settings')
    .select('value').eq('key', 'game_market_pricing:synthesisone').maybeSingle()
  if (error) throw error
  return normalizeMarketPricing(data?.value || DEFAULT_MARKET_PRICING)
}

async function getPlatformStoreId() {
  const { data, error } = await supabase.from('game_market_stores')
    .select('id').eq('is_platform_store', true).maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('No existe la tienda oficial; ejecuta la migración 009_profiles_game_market.sql')
  return data.id
}

function storagePublicUrl(bucket, path) {
  if (!path) return null
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data?.publicUrl || null
}

async function avatarUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60)
  if (error) {
    console.error('No se pudo firmar la URL de avatar:', error.message)
    return null
  }
  return data?.signedUrl || null
}

async function getOrCreateProfile(client) {
  const { data, error } = await supabase.from('synthesisone_profiles')
    .select('*').eq('client_id', String(client.id)).maybeSingle()
  if (error) throw error
  if (data) return data
  const { data: created, error: insertError } = await supabase.from('synthesisone_profiles')
    .insert({ client_id: client.id, display_name: cleanText(client.name, 80) })
    .select('*').single()
  if (insertError) throw insertError
  return created
}

async function serializeProfile(profile) {
  return {
    client_id: String(profile.client_id),
    display_name: profile.display_name || '',
    username: profile.username ? `@${profile.username}` : '',
    avatar_url: await avatarUrl(profile.avatar_path),
    theme: profile.theme || 'violet',
    province: profile.province || '',
    municipality: profile.municipality || '',
    age: profile.age ?? null,
    display_name_public: !!profile.display_name_public,
    avatar_public: !!profile.avatar_public,
    age_public: !!profile.age_public,
    location_public: !!profile.location_public,
    local_data_imported: !!profile.local_data_imported,
    profile_complete: Boolean(
      String(profile.display_name || '').trim() &&
      /^[a-z0-9_]{3,20}$/.test(String(profile.username || '')) &&
      String(profile.province || '').trim() &&
      String(profile.municipality || '').trim() &&
      profile.avatar_path
    ),
    updated_at: profile.updated_at,
  }
}

function decodeImage(body = {}) {
  const type = String(body.content_type || body.contentType || 'image/jpeg').toLowerCase().split(';')[0].trim()
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    const error = new Error('Formato no permitido. Usa JPG, PNG o WebP.')
    error.status = 400
    throw error
  }
  let encoded = String(body.image_base64 || body.imageBase64 || '').trim()
  encoded = encoded.replace(/^data:image\/(?:jpeg|png|webp);base64,/i, '')
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    const error = new Error('La imagen codificada no es válida')
    error.status = 400
    throw error
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error('La imagen no puede superar 2 MB')
    error.status = 413
    throw error
  }
  // Check the actual format as well as the client-supplied MIME type.
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isWebp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!((type === 'image/jpeg' && isJpeg) || (type === 'image/png' && isPng) || (type === 'image/webp' && isWebp))) {
    const error = new Error('El contenido de la imagen no coincide con su formato')
    error.status = 400
    throw error
  }
  return { bytes, type }
}

async function uploadImage(bucket, path, image) {
  try {
    const { error } = await supabase.storage.from(bucket).upload(path, image.bytes, {
      contentType: image.type,
      cacheControl: '3600',
      upsert: false,
    })
    if (error) throw error
    return path
  } catch (storageError) {
    const detail = String(storageError?.message || storageError || 'Error desconocido')
    const lower = detail.toLowerCase()
    const bucketMissing = /bucket.{0,30}(not found|does not exist|missing)|no such bucket|bucket not found/.test(lower)
      || (Number(storageError?.statusCode || storageError?.status) === 404 && lower.includes('bucket'))
    // Keep provider/configuration details in private server logs only; never return
    // bucket names, storage errors or infrastructure details to the Android client.
    console.error('[Game Market] Falló la carga de una imagen. Verifica la configuración del almacenamiento y la clave de servicio.', {
      bucket,
      statusCode: storageError?.statusCode || storageError?.status || null,
      errorCode: storageError?.error || storageError?.code || null,
      bucketMissing,
      message: detail,
    })
    const safeError = new Error('No se pudo guardar la imagen en este momento. Inténtalo de nuevo más tarde.')
    safeError.status = 503
    safeError.code = bucketMissing ? 'IMAGE_BUCKET_NOT_CONFIGURED' : 'IMAGE_STORAGE_UNAVAILABLE'
    throw safeError
  }
}

async function loadCatalog({ admin = false, storeId = null } = {}) {
  const games = await readAllRows(() => {
    let query = supabase.from('game_market_games')
      .select('id, slug, name, description, category, thumbnail_path, thumbnail_url, badge, is_active, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
    if (storeId) query = query.eq('store_id', storeId)
    if (!admin) query = query.eq('is_active', true)
    return query
  }, { pageSize: 500, maxRows: 20000 })
  if (!games.length) return { games: [] }

  const ids = games.map(game => game.id)
  const offers = await readAllRows(() => {
    let query = supabase.from('game_market_offers')
      .select('id, game_id, title, description, category, package_data, price_cup, price_saldo, base_cost_usd, auto_pricing, available, published, sort_order, provider, created_at, updated_at')
      .in('game_id', ids).order('sort_order', { ascending: true }).order('title', { ascending: true })
    if (storeId) query = query.eq('store_id', storeId)
    if (!admin) query = query.eq('published', true)
    return query
  }, { pageSize: 500, maxRows: 100000 })

  const offersByGame = new Map()
  for (const offer of offers || []) {
    // Provider-marked out-of-stock packages remain visible with a disabled purchase
    // action; manual offers that an admin marked unavailable remain hidden from buyers.
    if (!admin && !offer.available && offer.provider !== 'rechargegames') continue
    const bucket = offersByGame.get(offer.game_id) || []
    const safeOffer = {
      id: offer.id,
      game_id: offer.game_id,
      title: offer.title,
      description: offer.description || '',
      category: offer.category || 'Paquete',
      package_data: admin ? (offer.package_data || {}) : clientSafePackageData(offer.package_data || {}),
      price_cup: Number(offer.price_cup || 0),
      price_saldo: Number(offer.price_saldo || 0),
      available: !!offer.available,
      published: !!offer.published,
      sort_order: offer.sort_order || 0,
    }
    if (admin) {
      safeOffer.base_cost_usd = offer.base_cost_usd === null ? null : Number(offer.base_cost_usd)
      safeOffer.auto_pricing = !!offer.auto_pricing
    }
    bucket.push(safeOffer)
    offersByGame.set(offer.game_id, bucket)
  }

  return {
    games: games.map(game => ({
      id: game.id,
      slug: game.slug,
      name: game.name,
      description: game.description || '',
      category: game.category || 'Juegos',
      thumbnail_path: game.thumbnail_path || null,
      // Manually uploaded artwork wins; automatically discovered URLs are the fallback.
      thumbnail_url: (game.thumbnail_path ? storagePublicUrl(GAME_IMAGE_BUCKET, game.thumbnail_path) : null) || game.thumbnail_url || null,
      badge: game.badge || '',
      is_active: !!game.is_active,
      sort_order: game.sort_order || 0,
      offers: offersByGame.get(game.id) || [],
    })),
  }
}

function handleError(res, error, context) {
  if (error?.status) return res.status(error.status).json({ error: error.message })
  if (error?.code === '23505') return res.status(409).json({ error: 'Ese username o identificador ya está en uso' })
  console.error(context, error)
  return res.status(500).json({ error: 'Error interno del servidor' })
}

router.get('/public-profile/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username no válido' })
    const { data: profile, error } = await supabase.from('synthesisone_profiles')
      .select('username, display_name, display_name_public, avatar_path, avatar_public, province, municipality, location_public, age, age_public')
      .eq('username', username).maybeSingle()
    if (error) throw error
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' })
    return res.json({
      username: `@${profile.username}`,
      display_name: profile.display_name_public ? profile.display_name : null,
      avatar_url: profile.avatar_public ? await avatarUrl(profile.avatar_path) : null,
      age: profile.age_public ? profile.age : null,
      province: profile.location_public ? profile.province : null,
      municipality: profile.location_public ? profile.municipality : null,
    })
  } catch (error) {
    return handleError(res, error, 'Error GET public profile:')
  }
})


router.use(requireClient)

// Profile records are isolated by the server-authenticated client id.
router.get('/profile', async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.client)
    return res.json({ ok: true, profile: await serializeProfile(profile) })
  } catch (error) {
    return handleError(res, error, 'Error GET /api/game-market/profile:')
  }
})

router.put('/profile', async (req, res) => {
  try {
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
      patch.display_name = cleanText(body.display_name, 80)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'username')) {
      const username = String(body.username || '').trim().replace(/^@/, '').toLowerCase()
      if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'El username debe tener 3–20 caracteres: letras, números o guion bajo' })
      }
      patch.username = username || null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'theme')) {
      const theme = String(body.theme || 'violet').toLowerCase()
      if (!ALLOWED_THEMES.has(theme)) return res.status(400).json({ error: 'Tema visual no válido' })
      patch.theme = theme
    }
    if (Object.prototype.hasOwnProperty.call(body, 'province')) patch.province = cleanText(body.province, 80)
    if (Object.prototype.hasOwnProperty.call(body, 'municipality')) patch.municipality = cleanText(body.municipality, 100)
    if (Object.prototype.hasOwnProperty.call(body, 'age')) {
      if (body.age === null || body.age === '') patch.age = null
      else {
        const age = Number(body.age)
        if (!Number.isInteger(age) || age < 1 || age > 120) return res.status(400).json({ error: 'La edad debe estar entre 1 y 120 años, o quedar vacía' })
        patch.age = age
      }
    }
    for (const field of ['display_name_public', 'avatar_public', 'age_public', 'location_public']) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        if (typeof body[field] !== 'boolean') return res.status(400).json({ error: `${field} debe ser booleano` })
        patch[field] = body[field]
      }
    }
    const completeProfileForm = [
      'display_name', 'username', 'age', 'province', 'municipality',
      'display_name_public', 'avatar_public', 'age_public', 'location_public',
    ].every(field => Object.prototype.hasOwnProperty.call(body, field))
    if (patch.province === null) patch.municipality = null
    if (patch.municipality && !patch.province) return res.status(400).json({ error: 'La provincia es necesaria para guardar el municipio' })

    const current = await getOrCreateProfile(req.client)
    if (completeProfileForm) {
      if (!String(patch.display_name || '').trim()) return res.status(400).json({ error: 'El nombre visible es obligatorio' })
      if (!String(patch.username || '').trim() || !/^[a-z0-9_]{3,20}$/.test(String(patch.username))) {
        return res.status(400).json({ error: 'El username es obligatorio y debe tener 3–20 caracteres: letras, números o guion bajo' })
      }
      if (!String(patch.province || '').trim() || !String(patch.municipality || '').trim()) {
        return res.status(400).json({ error: 'Selecciona provincia y municipio para completar el perfil' })
      }
      if (!current.avatar_path) return res.status(400).json({ error: 'Selecciona y sube una foto de perfil antes de finalizar' })
      patch.local_data_imported = true
    }
    const { data, error } = await supabase.from('synthesisone_profiles')
      .update(patch).eq('client_id', String(req.client.id)).select('*').single()
    if (error) throw error
    return res.json({ ok: true, profile: await serializeProfile(data || current) })
  } catch (error) {
    return handleError(res, error, 'Error PUT /api/game-market/profile:')
  }
})

router.post('/profile/import-local', async (req, res) => {
  try {
    const body = req.body || {}
    const current = await getOrCreateProfile(req.client)
    if (current.local_data_imported) {
      return res.json({ ok: true, imported: false, profile: await serializeProfile(current) })
    }

    const patch = { local_data_imported: true, updated_at: new Date().toISOString() }
    // This is a one-time, conservative migration from SharedPreferences. Keep server
    // fields that already exist, and never import avatar paths/URLs from the client.
    const displayName = cleanText(body.display_name, 80)
    if (displayName) patch.display_name = displayName

    let usernameConflict = false
    const username = String(body.username || '').trim().replace(/^@/, '').toLowerCase()
    if (username) {
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        usernameConflict = true
      } else if (!current.username) {
        const { data: duplicate, error: duplicateError } = await supabase.from('synthesisone_profiles')
          .select('client_id').eq('username', username).neq('client_id', String(req.client.id)).maybeSingle()
        if (duplicateError) throw duplicateError
        if (duplicate) usernameConflict = true
        else patch.username = username
      }
    }

    const theme = String(body.theme || '').toLowerCase()
    if (ALLOWED_THEMES.has(theme)) patch.theme = theme
    if (!current.province && cleanText(body.province, 80)) patch.province = cleanText(body.province, 80)
    const province = patch.province ?? current.province
    if (!current.municipality && province && cleanText(body.municipality, 100)) {
      patch.municipality = cleanText(body.municipality, 100)
    }
    if (current.age === null || current.age === undefined) {
      if (body.age !== undefined && body.age !== null && body.age !== '') {
        const age = Number(body.age)
        if (Number.isInteger(age) && age >= 1 && age <= 120) patch.age = age
      }
    }
    for (const field of ['display_name_public', 'avatar_public', 'age_public', 'location_public']) {
      if (body[field] === true && current[field] !== true) patch[field] = true
    }

    let updateResult = await supabase.from('synthesisone_profiles').update(patch)
      .eq('client_id', String(req.client.id)).select('*').single()
    if (updateResult.error?.code === '23505' && Object.prototype.hasOwnProperty.call(patch, 'username')) {
      // If another device claimed the username at the same time, preserve all other
      // imported fields and mark import complete; the user can choose another username.
      delete patch.username
      usernameConflict = true
      updateResult = await supabase.from('synthesisone_profiles').update(patch)
        .eq('client_id', String(req.client.id)).select('*').single()
    }
    if (updateResult.error) throw updateResult.error
    return res.json({
      ok: true,
      imported: true,
      username_conflict: usernameConflict,
      profile: await serializeProfile(updateResult.data),
    })
  } catch (error) {
    return handleError(res, error, 'Error POST /api/game-market/profile/import-local:')
  }
})

router.post('/profile/avatar', async (req, res) => {
  try {
    const image = decodeImage(req.body || {})
    const current = await getOrCreateProfile(req.client)
    const extension = image.type === 'image/png' ? 'png' : (image.type === 'image/webp' ? 'webp' : 'jpg')
    const path = `${String(req.client.id)}/${crypto.randomUUID()}.${extension}`
    await uploadImage(AVATAR_BUCKET, path, image)
    const { data, error } = await supabase.from('synthesisone_profiles')
      .update({ avatar_path: path, updated_at: new Date().toISOString() })
      .eq('client_id', String(req.client.id)).select('*').single()
    if (error) {
      await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {})
      throw error
    }
    if (current.avatar_path && current.avatar_path !== path) {
      const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([current.avatar_path])
      if (removeError) console.warn('No se pudo limpiar el avatar anterior:', removeError.message)
    }
    return res.json({ ok: true, profile: await serializeProfile(data) })
  } catch (error) {
    return handleError(res, error, 'Error POST /api/game-market/profile/avatar:')
  }
})


router.get('/catalog', async (req, res) => {
  try {
    const storeId = await getPlatformStoreId()
    return res.json(await loadCatalog({ admin: false, storeId }))
  } catch (error) {
    return handleError(res, error, 'Error GET /api/game-market/catalog:')
  }
})

router.get('/admin/catalog', requireAdmin, async (req, res) => {
  try {
    const storeId = await getPlatformStoreId()
    const catalog = await loadCatalog({ admin: true, storeId })
    catalog.pricing = await getPricingSettings()
    return res.json(catalog)
  } catch (error) {
    return handleError(res, error, 'Error GET /api/game-market/admin/catalog:')
  }
})

router.get('/admin/pricing', requireAdmin, async (req, res) => {
  try {
    return res.json({ pricing: await getPricingSettings() })
  } catch (error) {
    return handleError(res, error, 'Error GET market pricing:')
  }
})

router.put('/admin/pricing', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    for (const key of ['usd_to_cup', 'usd_to_saldo']) {
      const value = Number(body[key])
      if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return res.status(400).json({ error: `${key} debe ser mayor que cero` })
    }
    for (const key of ['cup_rounding_step', 'saldo_rounding_step']) {
      const value = Number(body[key])
      if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000) return res.status(400).json({ error: `${key} debe ser un entero mayor que cero` })
    }
    const margin = Number(body.profit_margin_pct)
    if (!Number.isFinite(margin) || margin < 0 || margin > 10000) return res.status(400).json({ error: 'El margen debe estar entre 0 y 10000 %' })
    if (!['ceil', 'nearest', 'floor'].includes(String(body.rounding_mode))) return res.status(400).json({ error: 'rounding_mode debe ser ceil, nearest o floor' })
    const pricing = normalizeMarketPricing(body)
    const { error: saveError } = await supabase.from('synthesisone_settings').upsert({
      key: 'game_market_pricing:synthesisone', value: pricing, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (saveError) throw saveError

    // Rate changes apply only to the official store; future independent sellers
    // must retain their own pricing settings.
    const platformStoreId = await getPlatformStoreId()
    const { data: automaticOffers, error: offersError } = await supabase.from('game_market_offers')
      .select('id, base_cost_usd').eq('auto_pricing', true).eq('store_id', platformStoreId)
    if (offersError) throw offersError
    for (const offer of automaticOffers || []) {
      if (offer.base_cost_usd === null || offer.base_cost_usd === undefined) continue
      const calculated = calculateOfferPrices(offer.base_cost_usd, pricing)
      const { error } = await supabase.from('game_market_offers').update({
        price_cup: calculated.price_cup, price_saldo: calculated.price_saldo,
        updated_at: new Date().toISOString(),
      }).eq('id', offer.id)
      if (error) throw error
    }
    return res.json({ ok: true, pricing })
  } catch (error) {
    return handleError(res, error, 'Error PUT market pricing:')
  }
})

router.post('/admin/images', requireAdmin, async (req, res) => {
  try {
    const image = decodeImage(req.body || {})
    const extension = image.type === 'image/png' ? 'png' : (image.type === 'image/webp' ? 'webp' : 'jpg')
    const path = `games/${crypto.randomUUID()}.${extension}`
    await uploadImage(GAME_IMAGE_BUCKET, path, image)
    // Android's uploader intentionally requires an explicit success flag. Without it,
    // a valid upload was incorrectly treated as failed and never attached to the game.
    return res.status(201).json({ ok: true, path, url: storagePublicUrl(GAME_IMAGE_BUCKET, path) })
  } catch (error) {
    return handleError(res, error, 'Error uploading Game Market image:')
  }
})

// Upload and persist a thumbnail for a specific game in one server-side operation.
// This is the dedicated admin fallback when automatic artwork cannot be found.
router.post('/admin/games/:id/thumbnail', requireAdmin, async (req, res) => {
  let uploadedPath = null
  try {
    const image = decodeImage(req.body || {})
    const storeId = await getPlatformStoreId()
    const { data: existing, error: fetchError } = await supabase.from('game_market_games')
      .select('id, thumbnail_path').eq('id', req.params.id).eq('store_id', storeId).maybeSingle()
    if (fetchError) throw fetchError
    if (!existing) return res.status(404).json({ error: 'Juego no encontrado' })

    const extension = image.type === 'image/png' ? 'png' : (image.type === 'image/webp' ? 'webp' : 'jpg')
    uploadedPath = `games/${crypto.randomUUID()}.${extension}`
    await uploadImage(GAME_IMAGE_BUCKET, uploadedPath, image)
    const { data: updated, error: updateError } = await supabase.from('game_market_games')
      .update({ thumbnail_path: uploadedPath, updated_at: new Date().toISOString() })
      .eq('id', existing.id).eq('store_id', storeId)
      .select('id, name, thumbnail_path, thumbnail_url').single()
    if (updateError) {
      await supabase.storage.from(GAME_IMAGE_BUCKET).remove([uploadedPath]).catch(() => {})
      uploadedPath = null
      throw updateError
    }

    if (existing.thumbnail_path && existing.thumbnail_path !== uploadedPath) {
      const { error: removeError } = await supabase.storage.from(GAME_IMAGE_BUCKET).remove([existing.thumbnail_path])
      if (removeError) console.warn('[Game Market] No se pudo borrar la miniatura sustituida:', removeError.message)
    }
    return res.status(201).json({
      ok: true,
      path: uploadedPath,
      url: storagePublicUrl(GAME_IMAGE_BUCKET, uploadedPath),
      game: updated,
    })
  } catch (error) {
    if (uploadedPath) await supabase.storage.from(GAME_IMAGE_BUCKET).remove([uploadedPath]).catch(() => {})
    return handleError(res, error, 'Error saving Game Market game thumbnail:')
  }
})

router.post('/admin/games', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const name = cleanText(body.name, 100)
    if (!name) return res.status(400).json({ error: 'El nombre del juego es obligatorio' })
    const slug = slugify(body.slug || name)
    if (!slug) return res.status(400).json({ error: 'No se pudo crear un identificador válido para el juego' })
    const sortOrder = Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0
    const storeId = await getPlatformStoreId()
    const { data, error } = await supabase.from('game_market_games').insert({
      store_id: storeId, slug, name, description: cleanText(body.description, 2000), category: cleanText(body.category, 80) || 'Juegos',
      thumbnail_path: cleanText(body.thumbnail_path, 500), badge: cleanText(body.badge, 30),
      is_active: parseBoolean(body.is_active, true), sort_order: sortOrder,
    }).select('*').single()
    if (error) throw error
    return res.status(201).json({ game: data })
  } catch (error) {
    return handleError(res, error, 'Error POST market game:')
  }
})

router.patch('/admin/games/:id', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      patch.name = cleanText(body.name, 100)
      if (!patch.name) return res.status(400).json({ error: 'El nombre del juego no puede quedar vacío' })
    }
    if (Object.prototype.hasOwnProperty.call(body, 'slug')) patch.slug = slugify(body.slug)
    if (Object.prototype.hasOwnProperty.call(body, 'description')) patch.description = cleanText(body.description, 2000)
    if (Object.prototype.hasOwnProperty.call(body, 'category')) patch.category = cleanText(body.category, 80) || 'Juegos'
    if (Object.prototype.hasOwnProperty.call(body, 'thumbnail_path')) patch.thumbnail_path = cleanText(body.thumbnail_path, 500)
    if (Object.prototype.hasOwnProperty.call(body, 'badge')) patch.badge = cleanText(body.badge, 30)
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) patch.is_active = parseBoolean(body.is_active, true)
    if (Object.prototype.hasOwnProperty.call(body, 'sort_order')) patch.sort_order = Number(body.sort_order) || 0
    const storeId = await getPlatformStoreId()
    const { data, error } = await supabase.from('game_market_games').update(patch)
      .eq('id', req.params.id).eq('store_id', storeId).select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Juego no encontrado' })
    return res.json({ game: data })
  } catch (error) {
    return handleError(res, error, 'Error PATCH market game:')
  }
})

router.delete('/admin/games/:id', requireAdmin, async (req, res) => {
  try {
    const storeId = await getPlatformStoreId()
    const { data: game, error: fetchError } = await supabase.from('game_market_games')
      .select('id, thumbnail_path').eq('id', req.params.id).eq('store_id', storeId).maybeSingle()
    if (fetchError) throw fetchError
    if (!game) return res.status(404).json({ error: 'Juego no encontrado' })
    const { error } = await supabase.from('game_market_games').delete().eq('id', game.id).eq('store_id', storeId)
    if (error) throw error
    if (game.thumbnail_path) {
      const { error: storageError } = await supabase.storage.from(GAME_IMAGE_BUCKET).remove([game.thumbnail_path])
      if (storageError) console.warn('No se pudo limpiar una miniatura eliminada:', storageError.message)
    }
    return res.json({ ok: true })
  } catch (error) {
    return handleError(res, error, 'Error DELETE market game:')
  }
})

router.post('/admin/games/:id/offers', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const title = cleanText(body.title, 120)
    if (!title) return res.status(400).json({ error: 'El nombre de la oferta es obligatorio' })
    const storeId = await getPlatformStoreId()
    const pricing = await getPricingSettings()
    const autoPricing = parseBoolean(body.auto_pricing, false)
    const baseCost = parseNonNegativeNumber(body.base_cost_usd, 'base_cost_usd', { optional: true })
    if (autoPricing && baseCost === null) return res.status(400).json({ error: 'El coste mayorista USD es obligatorio para el cálculo automático' })
    let priceCup = parseWholeSalePrice(body.price_cup ?? 0, 'price_cup')
    let priceSaldo = parseWholeSalePrice(body.price_saldo ?? 0, 'price_saldo')
    if (autoPricing) ({ price_cup: priceCup, price_saldo: priceSaldo } = calculateOfferPrices(baseCost, pricing))
    const { data, error } = await supabase.from('game_market_offers').insert({
      store_id: storeId, game_id: req.params.id, title,
      description: cleanText(body.description, 1000), category: cleanText(body.category, 80) || 'Paquete',
      package_data: body.package_data && typeof body.package_data === 'object' && !Array.isArray(body.package_data) ? body.package_data : {},
      price_cup: priceCup, price_saldo: priceSaldo, base_cost_usd: baseCost, auto_pricing: autoPricing,
      available: parseBoolean(body.available, true), published: parseBoolean(body.published, true),
      sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    }).select('*').single()
    if (error) throw error
    return res.status(201).json({ offer: data })
  } catch (error) {
    return handleError(res, error, 'Error POST market offer:')
  }
})

router.patch('/admin/offers/:id', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    for (const [field, max] of Object.entries({ title: 120, description: 1000, category: 80 })) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        const cleaned = cleanText(body[field], max)
        if (field === 'title' && !cleaned) return res.status(400).json({ error: 'El nombre de la oferta es obligatorio' })
        patch[field] = field === 'category' ? (cleaned || 'Paquete') : cleaned
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'package_data')) {
      if (!body.package_data || typeof body.package_data !== 'object' || Array.isArray(body.package_data)) return res.status(400).json({ error: 'package_data debe ser un objeto JSON' })
      patch.package_data = body.package_data
    }
    if (Object.prototype.hasOwnProperty.call(body, 'available')) patch.available = parseBoolean(body.available, true)
    if (Object.prototype.hasOwnProperty.call(body, 'published')) patch.published = parseBoolean(body.published, true)
    if (Object.prototype.hasOwnProperty.call(body, 'sort_order')) patch.sort_order = Number(body.sort_order) || 0

    const platformStoreId = await getPlatformStoreId()
    const { data: existing, error: fetchError } = await supabase.from('game_market_offers')
      .select('id, store_id, base_cost_usd, auto_pricing, price_cup, price_saldo')
      .eq('id', req.params.id).eq('store_id', platformStoreId).maybeSingle()
    if (fetchError) throw fetchError
    if (!existing) return res.status(404).json({ error: 'Oferta no encontrada' })
    if (Object.prototype.hasOwnProperty.call(body, 'base_cost_usd')) patch.base_cost_usd = parseNonNegativeNumber(body.base_cost_usd, 'base_cost_usd', { optional: true })
    if (Object.prototype.hasOwnProperty.call(body, 'auto_pricing')) patch.auto_pricing = parseBoolean(body.auto_pricing, false)
    const effectiveAuto = patch.auto_pricing ?? existing.auto_pricing
    const effectiveCost = Object.prototype.hasOwnProperty.call(patch, 'base_cost_usd') ? patch.base_cost_usd : existing.base_cost_usd
    if (effectiveAuto && effectiveCost === null) return res.status(400).json({ error: 'El coste mayorista USD es obligatorio para el cálculo automático' })

    if (Object.prototype.hasOwnProperty.call(body, 'price_cup')) patch.price_cup = parseWholeSalePrice(body.price_cup, 'price_cup')
    if (Object.prototype.hasOwnProperty.call(body, 'price_saldo')) patch.price_saldo = parseWholeSalePrice(body.price_saldo, 'price_saldo')
    if (effectiveAuto && (Object.prototype.hasOwnProperty.call(body, 'base_cost_usd') || Object.prototype.hasOwnProperty.call(body, 'auto_pricing') || Object.prototype.hasOwnProperty.call(body, 'price_cup') || Object.prototype.hasOwnProperty.call(body, 'price_saldo'))) {
      const calculated = calculateOfferPrices(effectiveCost, await getPricingSettings())
      patch.price_cup = calculated.price_cup
      patch.price_saldo = calculated.price_saldo
    }
    const { data, error } = await supabase.from('game_market_offers').update(patch)
      .eq('id', req.params.id).select('*').single()
    if (error) throw error
    return res.json({ offer: data })
  } catch (error) {
    return handleError(res, error, 'Error PATCH market offer:')
  }
})

router.delete('/admin/offers/:id', requireAdmin, async (req, res) => {
  try {
    const platformStoreId = await getPlatformStoreId()
    const { data, error } = await supabase.from('game_market_offers').delete()
      .eq('id', req.params.id).eq('store_id', platformStoreId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Oferta no encontrada en la tienda oficial' })
    return res.json({ ok: true })
  } catch (error) {
    return handleError(res, error, 'Error DELETE market offer:')
  }
})

module.exports = router
