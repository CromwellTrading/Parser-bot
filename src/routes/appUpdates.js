'use strict'

const express = require('express')
const crypto = require('crypto')
const supabase = require('../supabase')
const { requireNonRevokedToken } = require('../utils/tokenState')

const router = express.Router()
const BUCKET = 'synthesisone-app-updates'
const SETTING_KEY = 'app_latest_release'
const MAX_APK_BYTES = 80 * 1024 * 1024

function tokenFromRequest(req) {
  const auth = String(req.headers.authorization || '')
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  return req.headers['x-client-token'] || null
}

async function authenticatedClient(req, res, adminOnly = false) {
  const token = tokenFromRequest(req)
  if (!token) { res.status(401).json({ ok: false, error: 'Debes iniciar sesión para realizar esta acción.' }); return null }
  try { await requireNonRevokedToken(token) }
  catch (_) { res.status(403).json({ ok: false, error: 'La sesión ya no está activa.' }); return null }
  const { data, error } = await supabase.from('clients')
    .select('id, name, token, active, role, expires_at, store_only')
    .eq('token', token).maybeSingle()
  if (error) { res.status(503).json({ ok: false, error: 'No se pudo verificar la cuenta.' }); return null }
  if (!data || !data.active || data.store_only) { res.status(403).json({ ok: false, error: 'La cuenta no tiene acceso a esta función.' }); return null }
  if (adminOnly && String(data.role || '').toLowerCase() !== 'admin') { res.status(403).json({ ok: false, code: 'ADMIN_REQUIRED', error: 'Esta función está disponible únicamente para administradores.' }); return null }
  return data
}

async function loadLatestRelease() {
  const { data, error } = await supabase.from('synthesisone_settings').select('value, updated_at')
    .eq('key', SETTING_KEY).maybeSingle()
  if (error) throw error
  const value = data?.value && typeof data.value === 'object' ? data.value : null
  return value && value.storage_path && Number.isInteger(Number(value.version_code)) ? { ...value, updated_at: data.updated_at || value.published_at || null } : null
}

router.get('/latest', async (req, res) => {
  const client = await authenticatedClient(req, res, false)
  if (!client) return
  try {
    const release = await loadLatestRelease()
    res.set('Cache-Control', 'no-store')
    if (!release) return res.json({ ok: true, available: false, release: null })
    return res.json({ ok: true, available: true, release: {
      version_code: Number(release.version_code), version_name: String(release.version_name || ''),
      release_notes: String(release.release_notes || ''), published_at: release.published_at || release.updated_at || null,
      size_bytes: Number(release.size_bytes || 0), sha256: String(release.sha256 || ''),
      download_endpoint: '/api/app-updates/download',
    } })
  } catch (error) {
    console.error(JSON.stringify({ event: 'APP_UPDATE_LOOKUP_FAILED', code: error.code || null }))
    return res.status(503).json({ ok: false, error: 'No se pudo comprobar si hay una actualización disponible.' })
  }
})

router.get('/download', async (req, res) => {
  const client = await authenticatedClient(req, res, false)
  if (!client) return
  try {
    const release = await loadLatestRelease()
    if (!release?.storage_path) return res.status(404).json({ ok: false, error: 'No hay una actualización publicada.' })
    // Keep the bucket private and avoid buffering an 80 MB APK in the backend
    // process. A short-lived URL is created server-side and never returned as API
    // data; the Android client follows this redirect and verifies SHA-256 itself.
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(String(release.storage_path), 120, { download: 'SynthesisOne-update.apk' })
    if (error || !data?.signedUrl) throw error || new Error('No se pudo preparar la descarga')
    res.set('Cache-Control', 'no-store')
    return res.redirect(302, data.signedUrl)
  } catch (error) {
    console.error(JSON.stringify({ event: 'APP_UPDATE_DOWNLOAD_FAILED', code: error.code || null }))
    return res.status(503).json({ ok: false, error: 'No se pudo descargar la actualización. Inténtalo más tarde.' })
  }
})

// Android sends the selected APK as the raw request body. It is first uploaded
// under a unique key, then published atomically in synthesisone_settings. Only
// after the metadata points to the new release is the previous object removed.
router.put('/publish', async (req, res, next) => {
  const admin = await authenticatedClient(req, res, true)
  if (!admin) return
  req.updatePublishingAdmin = admin
  return next()
}, express.raw({ type: ['application/vnd.android.package-archive', 'application/octet-stream'], limit: MAX_APK_BYTES }), async (req, res) => {
  const admin = req.updatePublishingAdmin
  const bytes = Buffer.isBuffer(req.body) ? req.body : null
  if (!bytes || bytes.length < 1024 || bytes.length > MAX_APK_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return res.status(400).json({ ok: false, error: 'Selecciona un archivo APK válido de hasta 80 MB.' })
  }
  const versionCode = Number(req.query.version_code)
  const versionName = String(req.query.version_name || '').trim().slice(0, 40)
  const encodedNotes = String(req.headers['x-release-notes-base64'] || '').trim()
  let headerNotes = ''
  if (encodedNotes) {
    try { headerNotes = Buffer.from(encodedNotes, 'base64').toString('utf8') }
    catch (_) { return res.status(400).json({ ok: false, error: 'Las notas de la versión no tienen un formato válido.' }) }
  }
  const releaseNotes = String(headerNotes || req.query.notes || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 8000)
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !versionName) return res.status(400).json({ ok: false, error: 'No se pudo leer la versión del APK.' })
  if (!releaseNotes) return res.status(400).json({ ok: false, error: 'Escribe las novedades de esta versión antes de publicarla.' })

  let previous = null
  let path = null
  try {
    previous = await loadLatestRelease()
    if (previous && versionCode <= Number(previous.version_code)) {
      return res.status(409).json({ ok: false, code: 'VERSION_NOT_NEWER', error: 'La versión seleccionada debe ser más reciente que la publicada.' })
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    path = `releases/${versionCode}-${Date.now()}-${sha256.slice(0, 12)}.apk`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'application/vnd.android.package-archive', cacheControl: '0', upsert: false,
    })
    if (uploadError) throw uploadError

    const publishedAt = new Date().toISOString()
    const release = {
      version_code: versionCode, version_name: versionName, release_notes: releaseNotes,
      published_at: publishedAt, storage_path: path, size_bytes: bytes.length, sha256,
      package_name: 'com.synthesisone.app', published_by: String(admin.id),
    }
    const { error: saveError } = await supabase.from('synthesisone_settings')
      .upsert({ key: SETTING_KEY, value: release, updated_at: publishedAt }, { onConflict: 'key' })
    if (saveError) throw saveError

    let oldDeleted = true
    if (previous?.storage_path && previous.storage_path !== path) {
      const { error: deleteError } = await supabase.storage.from(BUCKET).remove([String(previous.storage_path)])
      if (deleteError) {
        oldDeleted = false
        console.error(JSON.stringify({ event: 'APP_UPDATE_OLD_FILE_DELETE_FAILED', version_code: previous.version_code, code: deleteError.code || null }))
      }
    }
    console.log(JSON.stringify({ event: 'APP_UPDATE_PUBLISHED', version_code: versionCode, size_bytes: bytes.length, old_file_deleted: oldDeleted, admin_client_id: admin.id }))
    return res.status(201).json({ ok: true, old_file_deleted: oldDeleted, release: {
      version_code: versionCode, version_name: versionName, published_at: publishedAt, size_bytes: bytes.length,
    } })
  } catch (error) {
    if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    console.error(JSON.stringify({ event: 'APP_UPDATE_PUBLISH_FAILED', code: error.code || null }))
    return res.status(503).json({ ok: false, error: 'No se pudo publicar la actualización. La versión anterior se conserva si la publicación no llegó a completarse.' })
  }
})

module.exports = router
