'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { publicWebhookDeliverySummary, safeDeliveryMessage } = require('../src/utils/clientWebhookStatus')

const ALLOWED_FIELDS = new Set([
  'id', 'event_id', 'event_label', 'status', 'status_label', 'attempts',
  'response_status', 'issue_message', 'created_at', 'delivered_at', 'next_attempt_at',
])

test('client delivery summary exposes status but never the stored payload, URL, body, or raw error', () => {
  const row = {
    id: 10,
    client_id: 'private-client-id',
    event_id: 'evt-1',
    webhook_url: 'https://merchant.example/private/path?secret=value',
    payload: { event: 'TRANSFER_DETECTED', sms: { body: 'PERSONAL SMS DATA' }, transaction: { amount: 1000 } },
    status: 'FAILED',
    attempts: 3,
    next_attempt_at: '2026-10-26T12:00:00.000Z',
    last_error: 'HTTP 503 upstream raw provider output',
    response_status: 503,
    response_body: 'secret response body',
    created_at: '2026-10-26T11:00:00.000Z',
    delivered_at: null,
  }
  const summary = publicWebhookDeliverySummary(row)
  assert.deepEqual(new Set(Object.keys(summary)), ALLOWED_FIELDS)
  assert.equal(summary.event_label, 'Aviso de transferencia')
  assert.equal(summary.status_label, 'No entregado')
  assert.equal(summary.issue_message, 'El servidor receptor respondió con HTTP 503. Puedes revisar su disponibilidad; SynthesisOne reintentará cuando corresponda.')
  assert.doesNotMatch(JSON.stringify(summary), /PERSONAL SMS DATA|secret=value|secret response body|private-client-id|upstream raw provider output/)
})

test('client delivery summary normalizes unknown statuses instead of exposing arbitrary database values', () => {
  const summary = publicWebhookDeliverySummary({ status: 'PRIVATE_INTERNAL_STATUS', attempts: -5, response_status: 999, payload: { event: 'PRIVATE_EVENT_NAME' } })
  assert.equal(summary.status, 'FAILED')
  assert.equal(summary.status_label, 'No entregado')
  assert.equal(summary.attempts, 0)
  assert.equal(summary.response_status, null)
  assert.equal(summary.event_label, 'Aviso de automatización')
})

test('delivery failure messages are safe and actionable', () => {
  assert.match(safeDeliveryMessage({ status: 'FAILED', last_error: 'Webhook timeout' }), /tardó demasiado/)
  assert.match(safeDeliveryMessage({ status: 'FAILED', last_error: 'Destino de webhook no permitido' }), /reglas de seguridad/)
  assert.match(safeDeliveryMessage({ status: 'FAILED', last_error: 'LICENSE_INACTIVE_OR_EXPIRED' }), /licencia no estaba activa/)
  assert.equal(safeDeliveryMessage({ status: 'DELIVERED', last_error: null }), null)
})
