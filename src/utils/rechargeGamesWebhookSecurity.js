'use strict'

const crypto = require('crypto')

function webhookSecretBytes(secretInput = process.env.RECHARGEGAMES_WEBHOOK_SECRET) {
  const secret = String(secretInput || '').trim()
  if (!secret.startsWith('whsec_')) return null
  const encoded = secret.slice('whsec_'.length)
  if (!encoded) return null
  const decoded = Buffer.from(encoded, 'base64')
  return decoded.length ? decoded : null
}

function verifyWebhookSignature({ webhookId, timestamp, signature, rawBody, nowMs = Date.now(), secret = process.env.RECHARGEGAMES_WEBHOOK_SECRET }) {
  const id = String(webhookId || '').trim()
  const timestampText = String(timestamp || '').trim()
  const key = webhookSecretBytes(secret)
  if (!id || !/^\d{1,12}$/.test(timestampText) || !signature || typeof rawBody !== 'string' || !key) return false
  const timestampMs = Number(timestampText) * 1000
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestampText}.${rawBody}`, 'utf8').digest('base64')
  const candidates = String(signature).trim().split(/\s+/)
    .filter(part => part.startsWith('v1,'))
    .map(part => part.slice(3))
  return candidates.some(candidate => {
    try {
      const actualBytes = Buffer.from(candidate, 'base64')
      const expectedBytes = Buffer.from(expected, 'base64')
      return actualBytes.length === expectedBytes.length && actualBytes.length > 0 && crypto.timingSafeEqual(actualBytes, expectedBytes)
    } catch (_) {
      return false
    }
  })
}

module.exports = { webhookSecretBytes, verifyWebhookSignature }
