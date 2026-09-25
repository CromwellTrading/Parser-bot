const crypto = require('crypto')

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'

function getKey() {
  const configured = String(
    process.env.ACTIVATION_SECRET_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim()

  if (!configured) {
    throw new Error('ACTIVATION_SECRET_ENCRYPTION_KEY o SUPABASE_SERVICE_KEY requerido')
  }

  // Derive a fixed 32-byte key without ever storing the raw environment secret in the DB.
  return crypto.createHash('sha256').update(configured, 'utf8').digest()
}

function encryptActivationSecret(secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(String(secret || ''), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':')
}

function decryptActivationSecret(payload) {
  const raw = String(payload || '').trim()
  if (!raw) return null

  const [version, ivHex, tagHex, ciphertextHex] = raw.split(':')
  if (version !== VERSION || !ivHex || !tagHex || !ciphertextHex) {
    throw new Error('Credencial de activación cifrada inválida')
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, 'hex')
  )
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

module.exports = {
  encryptActivationSecret,
  decryptActivationSecret,
}
