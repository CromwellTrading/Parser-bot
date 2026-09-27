process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createEventId, hmacHex, validateWebhookUrl } = require('../src/utils/webhookSecurity')
const { publicClient } = require('../src/utils/clientProfile')

test('webhook URL requires HTTPS and rejects private destinations', () => {
  assert.equal(validateWebhookUrl('http://example.com').ok, false)
  assert.equal(validateWebhookUrl('https://localhost/hook').ok, false)
  assert.equal(validateWebhookUrl('https://127.0.0.1/hook').ok, false)
  assert.equal(validateWebhookUrl('https://10.0.0.2/hook').ok, false)
  assert.equal(validateWebhookUrl('https://192.168.1.20/hook').ok, false)
  assert.equal(validateWebhookUrl('https://example.com/hook').ok, true)
})

test('event id is deterministic for the same SMS', () => {
  const a = createEventId({
    clientId: 'c1',
    sender: 'PAGOxMOVIL',
    body: 'Monto: 100 CUP',
    receivedAt: '2026-09-27T12:00:00.000Z',
  })
  const b = createEventId({
    clientId: 'c1',
    sender: 'PAGOxMOVIL',
    body: 'Monto: 100 CUP',
    receivedAt: '2026-09-27T12:00:00.000Z',
  })
  assert.equal(a, b)
  assert.match(a, /^[a-f0-9]{64}$/)
})

test('HMAC-SHA256 produces a stable hex signature', () => {
  assert.equal(
    hmacHex('hello', 'secret'),
    '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b'
  )
})

test('client-facing profile does not expose token, webhook secret or webhook URLs', () => {
  const client = publicClient({
    id: 'c1',
    name: 'Cliente',
    token: 'TOKEN',
    webhook_secret: 'SECRET',
    webhook_url: 'https://example.com/hook',
    webhook_url_2: 'https://example.com/hook2',
    webhook_url_3: null,
    active: true,
    token_used: true,
    phone_number: '59190241',
    expires_at: '2099-01-01T00:00:00.000Z',
  })
  assert.equal(client.token, undefined)
  assert.equal(client.webhook_secret, undefined)
  assert.equal(client.webhook_url, undefined)
  assert.equal(client.webhook_url_2, undefined)
})

test('webhook payload exposes normalized transfer amount without secrets', () => {
  const { buildWebhookPayload } = require('../src/utils/webhookPayload')
  const payload = buildWebhookPayload(
    {
      id: 'c1',
      name: 'Cliente',
      phone_number: '59190241',
      expires_at: '2099-01-01T00:00:00.000Z',
      card1: '1234-5678',
      card2: null,
      card3: null,
      wallet: '5359190241',
      token: 'TOKEN',
      webhook_secret: 'SECRET',
    },
    {
      direction: 'ENVIADO',
      amount: 1010,
      commission: 10,
      currency: 'CUP',
      transaction_id: 'TX1',
    },
    'PAGOxMOVIL',
    'raw sms',
    '2026-09-27T12:00:00.000Z',
    'event-1',
    'log-1',
    'msg-1'
  )
  assert.equal(payload.event, 'TRANSFER_DETECTED')
  assert.equal(payload.transaction.amount, 1000)
  assert.equal(payload.transaction.commission, 10)
  assert.equal(Object.hasOwn(payload.transaction, 'transfer_amount'), false)
  assert.equal(Object.hasOwn(payload.transaction, 'total_debited'), false)
  assert.equal(payload.token, undefined)
  assert.equal(payload.webhook_secret, undefined)
})
