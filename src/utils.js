const crypto = require('crypto')

/**
 * Verifica que la firma HMAC-SHA256 del payload sea válida.
 * El mismo algoritmo que usa la app Android.
 */
function verifySignature(payload, secret, signature) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  // Comparación segura para evitar timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    )
  } catch {
    return false
  }
}

module.exports = { verifySignature }
