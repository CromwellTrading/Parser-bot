'use strict'

const express = require('express')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')
const { canUseOfficialStore } = require('../utils/storeSessionAccess')
const { getDashboard, ensureProfile, applyReferral, listCampaigns, createCampaign, rewardsEnabled, rewardsSchemaReady } = require('../utils/rewards')

const router = express.Router()

function extractToken(req) {
  const header = String(req.headers.authorization || '')
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

async function requireRewardsClient(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ ok: false, error: 'Vuelve a conectar con tu cuenta.' })
    await requireNonRevokedToken(token)
    const { data: client, error } = await supabase.from('clients')
      .select('id,token,active,role,expires_at,device_id,store_only')
      .eq('token', token).maybeSingle()
    if (error) throw error
    if (!client || !canUseOfficialStore(client)) return res.status(401).json({ ok: false, error: 'La sesión no está activa. Vuelve a conectarte.' })
    const requestedDevice = String(req.headers['x-device-id'] || '').trim().slice(0, 160)
    if (!requestedDevice) return res.status(400).json({ ok: false, error: 'No se pudo identificar esta instalación.' })
    if (client.device_id && requestedDevice !== String(client.device_id)) {
      return res.status(403).json({ ok: false, error: 'Esta instalación no coincide con tu sesión.' })
    }
    // Some older store-only sessions do not persist a device id in clients yet. The
    // request header is bound to the authenticated request and is stored in reward_profiles.
    req.rewardClient = { ...client, device_id: requestedDevice }
    next()
  } catch (error) {
    if (error?.code === 'TOKEN_REVOKED') return res.status(401).json({ ok: false, error: 'La sesión ya no está activa.' })
    console.error('[Rewards] Error validando sesión:', error?.code || error?.message || 'unknown')
    return res.status(500).json({ ok: false, error: 'No se pudo validar la sesión.' })
  }
}

function respondError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ ok: false, code: error.code || 'REWARDS_ERROR', error: error.message })
  console.error('[Rewards] Error:', error?.code || error?.message || 'unknown')
  return res.status(500).json({ ok: false, error: fallback })
}
function requireAdmin(req, res, next) {
  if (String(req.rewardClient?.role || '').toLowerCase() !== 'admin') return res.status(403).json({ ok: false, error: 'Esta operación requiere permisos de administrador.' })
  next()
}

router.get('/status', async (_req, res) => {
  const enabled = rewardsEnabled() && await rewardsSchemaReady()
  return res.json({ ok: true, enabled })
})

// This gate only disables rewards endpoints; it never disables the main API or payments.
router.use(async (_req, res, next) => {
  if (!rewardsEnabled()) return res.status(503).json({ ok: false, code: 'REWARDS_NOT_ENABLED', error: 'El programa de recompensas todavía no está disponible.' })
  if (!(await rewardsSchemaReady())) return res.status(503).json({ ok: false, code: 'REWARDS_SCHEMA_UNAVAILABLE', error: 'El programa de recompensas todavía no está disponible.' })
  return next()
})
router.use(requireRewardsClient)

router.post('/bootstrap', async (req, res) => {
  try {
    const profile = await ensureProfile(req.rewardClient, req.body?.installed_at)
    return res.json({ ok: true, referral_code: profile.referral_code, welcome_started_at: profile.welcome_started_at })
  } catch (error) { return respondError(res, error, 'No se pudo iniciar el programa de recompensas.') }
})

router.get('/dashboard', async (req, res) => {
  try { return res.json(await getDashboard(req.rewardClient)) }
  catch (error) { return respondError(res, error, 'No se pudo cargar tu progreso de recompensas.') }
})

router.post('/referral', async (req, res) => {
  try { return res.json({ ok: true, referral: await applyReferral(req.rewardClient, req.body?.code || req.body?.referral_code) }) }
  catch (error) { return respondError(res, error, 'No se pudo vincular el código de referido.') }
})

router.get('/campaigns', async (req, res) => {
  try { return res.json({ ok: true, campaigns: await listCampaigns({ activeOnly: true }) }) }
  catch (error) { return respondError(res, error, 'No se pudieron cargar las misiones especiales.') }
})

router.get('/admin/campaigns', requireAdmin, async (_req, res) => {
  try { return res.json({ ok: true, campaigns: await listCampaigns() }) }
  catch (error) { return respondError(res, error, 'No se pudieron cargar las campañas.') }
})

router.post('/admin/campaigns', requireAdmin, async (req, res) => {
  try { return res.status(201).json({ ok: true, campaign: await createCampaign(req.rewardClient.id, req.body || {}) }) }
  catch (error) { return respondError(res, error, 'No se pudo guardar la campaña.') }
})

module.exports = router
