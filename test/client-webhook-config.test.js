process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeWebhookTargets } = require('../src/utils/clientWebhooks')

const current = {
  webhook_url: 'https://merchant.example/hooks/payments',
  webhook_url_2: null,
  webhook_url_3: null,
}

test('client webhook configuration accepts an HTTPS main target and optional target', () => {
  const result = normalizeWebhookTargets({
    webhook_url: 'https://store.example/so/events',
    webhook_url_2: 'https://backup.example/events',
    webhook_url_3: '',
  }, current)

  assert.equal(result.ok, true)
  assert.equal(result.configured, true)
  assert.deepEqual(result.patch, {
    webhook_url: 'https://store.example/so/events',
    webhook_url_2: 'https://backup.example/events',
    webhook_url_3: null,
  })
})

test('client webhook configuration rejects insecure, private, malformed and non-text URLs', () => {
  for (const value of [
    'http://merchant.example/hook',
    'https://localhost/hook',
    'https://192.168.1.10/hook',
    'not a url',
    { url: 'https://merchant.example/hook' },
  ]) {
    const result = normalizeWebhookTargets({ webhook_url: value }, current)
    assert.equal(result.ok, false, `expected rejection for ${String(value)}`)
  }
})

test('omitted targets are preserved while explicit blanks clear a target', () => {
  const result = normalizeWebhookTargets({ webhook_url_2: '' }, current)
  assert.equal(result.ok, true)
  assert.equal(result.patch.webhook_url, current.webhook_url)
  assert.equal(result.patch.webhook_url_2, null)
  assert.equal(result.patch.webhook_url_3, null)
})

test('all blank targets deliberately disable deliveries and no-field updates are rejected', () => {
  const disabled = normalizeWebhookTargets({ webhook_url: '', webhook_url_2: '', webhook_url_3: '' }, current)
  assert.equal(disabled.ok, true)
  assert.equal(disabled.configured, false)
  assert.deepEqual(disabled.urls, [])
  assert.equal(normalizeWebhookTargets({}, current).ok, false)
})
