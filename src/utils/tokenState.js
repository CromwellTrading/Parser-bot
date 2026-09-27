const supabase = require('../supabase')

async function getBlacklistEntry(token) {
  if (!token) return null

  const { data, error } = await supabase
    .from('token_blacklist')
    .select('token, invalidated_at, reason, client_id')
    .eq('token', token)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function requireNonRevokedToken(token) {
  const blacklisted = await getBlacklistEntry(token)
  if (blacklisted) {
    const error = new Error('Token revocado')
    error.code = 'TOKEN_REVOKED'
    error.blacklist = blacklisted
    throw error
  }
  return true
}

module.exports = {
  getBlacklistEntry,
  requireNonRevokedToken,
}
