'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildCustomerInsights, buildAdminInsights, needsAccountContext, buildSystemPrompt } = require('../src/utils/assistantService')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('customer insights prioritize payment/support warnings and do not expose account identifiers', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  const events = buildCustomerInsights({
    now,
    orders: [
      { id: 'secret-uuid-order-1', source: 'GAMEMARKET', title: 'Diamantes', status: 'FULFILLMENT_REVIEW', updated_at: '2026-11-02T11:00:00Z' },
      { id: 'order-2', source: 'ETECSA', title: 'Nauta', status: 'COMPLETED', updated_at: '2026-11-02T11:30:00Z' },
    ],
  })
  assert.equal(events[0].severity, 'critical')
  assert.match(events[0].message, /No repitas el pago/)
  assert.equal(events.some(item => JSON.stringify(item).includes('secret-uuid-order-1')), false)
  assert.equal(events[1].kind, 'order_completed')
})

test('customer insights include available coupons and almost-complete missions, but ignore stale completed notices', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  const events = buildCustomerInsights({
    now,
    orders: [{ id: 'old', source: 'GAMEMARKET', title: 'Old order', status: 'COMPLETED', updated_at: '2026-11-01T01:00:00Z' }],
    coupons: [{ id: 'coupon-1', status: 'AVAILABLE', discount_percent: 5, issued_at: '2026-11-02T11:00:00Z' }],
    missions: [{ id: 'weekly', title: 'Racha semanal', progress: 4, target: 5, reward: 'Cupón del 3%', completed: false }],
  })
  assert.deepEqual(events.map(item => item.kind).sort(), ['coupon_available', 'mission_near_complete'])
  assert.equal(events.some(item => item.message.includes('Old order')), false)
})

test('customer insights notify about near-complete referral missions, referral-code rewards and welcome expiry', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  const events = buildCustomerInsights({
    now,
    missions: [
      { id: 'recruit', title: 'Recluta novato', progress: 2, target: 3, completed: false, reward: 'Cupón del 2%' },
      { id: 'referrals_10', title: 'Embajador · 10 referidos', progress: 9, target: 10, completed: false },
    ],
    profile: { referral_codes_entered_count: 27, referral_codes_until_next_coupon: 3 },
    welcome: { available: true, remaining_ms: 2 * 60 * 60 * 1000, ends_at: '2026-11-02T14:00:00Z' },
  })
  assert.ok(events.some(item => item.kind === 'mission_near_complete' && /Embajador/.test(item.message)))
  assert.ok(events.some(item => item.kind === 'referral_code_progress' && /faltan 3/.test(item.message)))
  assert.ok(events.some(item => item.kind === 'welcome_expiring'))
})

test('persistent unresolved order warnings remain actionable beyond 48 hours', () => {
  const now = Date.parse('2026-11-02T12:00:00Z')
  const events = buildCustomerInsights({
    now,
    orders: [{ id: 'stuck', source: 'GAMEMARKET', title: 'Recarga', status: 'PROCESSING', updated_at: '2026-10-29T12:00:00Z' }],
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'order_processing')
})

test('admin insights give safe read-only recommendations from operational counters', () => {
  const insights = buildAdminInsights({
    database: { status: 'UP' },
    automation_enabled: false,
    incidents: { open: 2, critical: 1 },
    wallet: { payment_review: 3, overdue_waiting: 4, refunds_pending: 1 },
    orders: { transfer_refunds_pending: 2, game_stuck: 5, etecsa_stuck: 1 },
    webhook_failures: 7,
    migrations_required: false,
  })
  assert.ok(insights.some(item => item.key === 'critical-incidents' && item.severity === 'critical'))
  assert.ok(insights.some(item => item.key === 'wallet-review'))
  assert.ok(insights.some(item => item.key === 'refunds'))
  assert.ok(insights.some(item => item.key === 'stuck-orders'))
  assert.ok(insights.some(item => item.key === 'webhooks'))
  assert.ok(insights.some(item => item.key === 'automation-disabled'))
  assert.ok(insights.every(item => item.recommendation.length > 20 && !item.recommendation.includes('secret-uuid')))
})

test('assistant account summaries request only the authenticated account context and include fraud guidance', () => {
  assert.equal(needsAccountContext('Hazme un resumen de mi cuenta'), true)
  const prompt = buildSystemPrompt({ wallet: { cup: 10 } })
  assert.match(prompt, /No recomiendes transferir fuera de un ticket válido/)
  assert.match(prompt, /resume únicamente los pedidos, cupones y balances/)
})

test('assistant insights endpoints require an authenticated client, and admin insights enforce admin role server-side', () => {
  const source = read('src/routes/assistant.js')
  assert.match(source, /router\.get\('\/insights', requireClient/)
  assert.match(source, /router\.get\('\/admin\/insights', requireClient/)
  assert.match(source, /String\(req\.assistantClient\.role \|\| ''\)\.toLowerCase\(\) !== 'admin'/)
  assert.match(source, /opsDashboard\.getOpsSummary\(\)/)
  assert.match(source, /reward_referral_code_entries/)
  assert.match(source, /reward_referrals/)
  assert.match(source, /welcome_started_at/)
  assert.match(source, /Cache-Control', 'no-store'/)
})
