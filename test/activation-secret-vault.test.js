const test = require('node:test')
const assert = require('node:assert/strict')

process.env.ACTIVATION_SECRET_ENCRYPTION_KEY = 'test-key-for-synthesisone-admin-diagnostics'
const { encryptActivationSecret, decryptActivationSecret } = require('../src/utils/activationSecretVault')

test('activation secret encrypt/decrypt round trip', () => {
  const secret = '4f8f9dc7b3a4f9d5c6e7f8a9b0c1d2e3'
  const encrypted = encryptActivationSecret(secret)
  assert.match(encrypted, /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
  assert.notEqual(encrypted, secret)
  assert.equal(decryptActivationSecret(encrypted), secret)
})

test('wrong key cannot decrypt activation secret', () => {
  const encrypted = encryptActivationSecret('secret-value')
  process.env.ACTIVATION_SECRET_ENCRYPTION_KEY = 'different-key'
  assert.throws(() => decryptActivationSecret(encrypted))
  process.env.ACTIVATION_SECRET_ENCRYPTION_KEY = 'test-key-for-synthesisone-admin-diagnostics'
})
