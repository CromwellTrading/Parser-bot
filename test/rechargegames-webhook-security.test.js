'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { verifyWebhookSignature, webhookSecretBytes } = require('../src/utils/rechargeGamesWebhookSecurity')

function sign(secret, id, timestamp, body) {
  const key = Buffer.from(secret, 'utf8')
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64')}`
}

test('validates a current HMAC-SHA256 provider webhook signature', () => {
  const key = 'rechargegames-unit-test-secret'
  const secret = `whsec_${Buffer.from(key).toString('base64')}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = '{"type":"webhook.test","id":"evt_1"}'
  assert.equal(verifyWebhookSignature({
    webhookId: 'msg_123', timestamp, signature: sign(key, 'msg_123', timestamp, body),
    rawBody: body, secret,
  }), true)
})

test('rejects modified bodies, stale timestamps, unsupported signature versions, and missing secrets', () => {
  const key = 'rechargegames-unit-test-secret'
  const secret = `whsec_${Buffer.from(key).toString('base64')}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const body = '{"type":"webhook.test"}'
  const signature = sign(key, 'msg_123', timestamp, body)
  assert.equal(verifyWebhookSignature({ webhookId: 'msg_123', timestamp, signature, rawBody: `${body} `, secret }), false)
  assert.equal(verifyWebhookSignature({ webhookId: 'msg_123', timestamp: '1', signature, rawBody: body, secret }), false)
  assert.equal(verifyWebhookSignature({ webhookId: 'msg_123', timestamp, signature: signature.replace('v1,', 'v2,'), rawBody: body, secret }), false)
  assert.equal(verifyWebhookSignature({ webhookId: 'msg_123', timestamp, signature, rawBody: body, secret: '' }), false)
  assert.equal(webhookSecretBytes('invalid') , null)
})
