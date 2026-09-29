const supabase = require('../supabase')

/**
 * Returns true when a non-null expiration date has passed.
 * A missing expiration date is treated as non-expiring (used for admins).
 */
function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false
  const time = new Date(expiresAt).getTime()
  return Number.isFinite(time) && time <= now
}

/**
 * Immediately blocks every expired client that is still marked active.
 * We deliberately DO NOT delete the client row: the panel needs the record
 * for audit/history, and renewals can reuse the same client row.
 *
 * Blocking consists of:
 *   1) active = false
 *   2) token -> token_blacklist with reason LICENSE_EXPIRED
 */
async function expireDueLicenses({ limit = 1000 } = {}) {
  const nowIso = new Date().toISOString()

  const { data: due, error: selectError } = await supabase
    .from('clients')
    .select('id, token, name, phone_number, expires_at')
    .eq('role', 'client')
    .eq('active', true)
    .not('expires_at', 'is', null)
    .lte('expires_at', nowIso)
    .order('expires_at', { ascending: true })
    .limit(limit)

  if (selectError) throw selectError
  if (!due?.length) return { expired: 0 }

  // First disable access. This is the authoritative access flag even if the
  // token blacklist is temporarily unavailable.
  const ids = due.map(client => client.id)
  const { data: blocked, error: updateError } = await supabase
    .from('clients')
    .update({ active: false })
    .in('id', ids)
    .eq('active', true)
    .lte('expires_at', nowIso)
    .select('id, token, name, phone_number, expires_at')
  if (updateError) throw updateError

  const actuallyBlocked = blocked || []
  const blacklistRows = actuallyBlocked
    .filter(client => client.token)
    .map(client => ({
      token: client.token,
      client_id: client.id,
      reason: 'LICENSE_EXPIRED',
      invalidated_at: nowIso,
    }))

  if (blacklistRows.length) {
    const { error: blacklistError } = await supabase
      .from('token_blacklist')
      .upsert(blacklistRows, { onConflict: 'token', ignoreDuplicates: true })
    if (blacklistError) {
      // Do not restore active=true. Access is already blocked by clients.active=false.
      console.error('Error registrando tokens expirados en blacklist:', blacklistError)
    }
  }

  for (const client of actuallyBlocked) {
    console.log(`⏱️ Licencia expirada y bloqueada: ${client.name || client.id} | expira=${client.expires_at}`)
  }

  return { expired: actuallyBlocked.length }
}

/**
 * Keeps expiry enforcement running while the service process is alive.
 * Requests also call expireDueLicenses(), so a sleeping/woken Render service
 * still enforces expiry as soon as it receives traffic again.
 */
function startLicenseExpiryWorker(intervalMs = 60 * 1000) {
  const run = async () => {
    try {
      await expireDueLicenses()
    } catch (error) {
      console.error('Error en trabajador de expiración de licencias:', error)
    }
  }

  run()
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return timer
}

module.exports = {
  isExpired,
  expireDueLicenses,
  startLicenseExpiryWorker,
}
