const crypto = require('crypto')

function getConfiguredAdminSecret() {
  const preferred = process.env.PANEL_ADMIN_PASSWORD
  const legacy = process.env.ADMIN_SECRET
  return String(preferred || legacy || '').trim()
}

function secretsMatch(provided) {
  const expected = getConfiguredAdminSecret()
  const actual = String(provided || '').trim()

  if (!expected || !actual) return false

  const expectedBuffer = Buffer.from(expected, 'utf8')
  const actualBuffer = Buffer.from(actual, 'utf8')
  if (expectedBuffer.length !== actualBuffer.length) return false

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

module.exports = {
  getConfiguredAdminSecret,
  secretsMatch,
}
