'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// ── in-memory Supabase stand-in (only what these modules use) ────────────────
const state = { destinations: [], settings: {}, destinationsError: null }
function fakeFrom(table) {
  let filters = []; let op = 'select'; let patch = null
  const rowsFor = () => table === 'admin_payment_destinations' ? state.destinations : []
  const run = async (single) => {
    if (table === 'admin_payment_destinations') {
      if (state.destinationsError) return { data: null, error: state.destinationsError }
      let rows = rowsFor().filter(r => filters.every(([k, v]) => String(r[k]) === String(v)))
      if (op === 'update') { rows.forEach(r => Object.assign(r, patch)) }
      return { data: single ? (rows[0] || null) : rows, error: null }
    }
    if (table === 'synthesisone_settings') {
      const v = state.settings.automation_availability
      return { data: v ? { value: v, updated_at: '2026-01-01T00:00:00Z' } : null, error: null }
    }
    return { data: single ? null : [], error: null }
  }
  const b = {
    select() { return b }, order() { return b },
    eq(k, v) { filters.push([k, v]); return b },
    update(p) { op = 'update'; patch = p; return b },
    maybeSingle() { return run(true) }, single() { return run(true) },
    then(resolve, reject) { return run(false).then(resolve, reject) },
  }
  return b
}
const supabasePath = path.join(__dirname, '..', 'src', 'supabase.js')
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { from: fakeFrom } }

const dest = require('../src/utils/paymentDestinations')
const { getAutomationAvailability } = require('../src/utils/systemSettings')
const guard = require('../src/utils/paymentReceiverGuard')

const ME = { id: 'd1', admin_client_id: 'me', label: 'x', card_number: '9225123412341234', confirmation_phone: '51111111', enabled: false, updated_at: null }
const BRO = { id: 'd2', admin_client_id: 'bro', label: 'y', card_number: '9225999988887777', confirmation_phone: '52222222', enabled: true, updated_at: null }
function reset(rows, master = { enabled: true, message: 'ok' }) {
  state.destinations = rows.map(r => ({ ...r })); state.settings = { automation_availability: master }; state.destinationsError = null
  delete process.env.LICENSE_PAYMENT_CARD; delete process.env.LICENSE_PAYMENT_PHONE; delete process.env.STORE_WALLET_SALDO_RECEIVER_PHONE
  guard._resetForTests()
}

test('a disabled administrator account is never offered to customers', async () => {
  reset([ME, BRO])
  const list = await dest.getPaymentDestinations()
  assert.deepEqual(list.map(d => d.id), ['d2'])
  assert.ok(!JSON.stringify(list).includes('51111111'))
})

test('a transient database error does not resurrect the legacy .env receiver', async () => {
  reset([ME, BRO])
  process.env.LICENSE_PAYMENT_CARD = '9225123412341234'; process.env.LICENSE_PAYMENT_PHONE = '51111111'
  state.destinationsError = { code: '08006', message: 'connection terminated' }
  assert.deepEqual(await dest.getPaymentDestinations(), [])
  state.destinationsError = { code: '42P01', message: 'relation does not exist' }
  const legacy = await dest.getPaymentDestinations()
  assert.equal(legacy.length, 1) // only while the table has not been created
})

test('saldo receiver comes from an ACTIVE account even if .env still points at a disabled one', async () => {
  reset([ME, BRO])
  process.env.STORE_WALLET_SALDO_RECEIVER_PHONE = '51111111'
  const receiver = await dest.resolveSaldoReceiver()
  assert.equal(receiver.phone, '52222222')
  // a stale destination id from a customer's device must not reach the disabled account either
  assert.equal((await dest.resolveSaldoReceiver('d1')).phone, '52222222')
})

test('saldo receiver prefers the .env phone only when that account is active', async () => {
  reset([{ ...ME, enabled: true }, BRO])
  process.env.STORE_WALLET_SALDO_RECEIVER_PHONE = '52222222'
  assert.equal((await dest.resolveSaldoReceiver()).phone, '52222222')
})

test('with no active account there is no saldo receiver at all', async () => {
  reset([ME, { ...BRO, enabled: false }])
  process.env.STORE_WALLET_SALDO_RECEIVER_PHONE = '51111111'
  await assert.rejects(dest.resolveSaldoReceiver(), error => error.status === 503 && error.code === 'SALDO_RECEIVER_UNAVAILABLE')
})

test('automation is available only when the master switch is on and an account is active', async () => {
  reset([ME, BRO])
  let a = await getAutomationAvailability()
  assert.equal(a.enabled, true); assert.equal(a.active_destinations, 1)
  reset([ME, { ...BRO, enabled: false }])
  a = await getAutomationAvailability()
  assert.equal(a.enabled, false); assert.equal(a.master_enabled, true)
  assert.match(a.message, /cuentas de pago activas/)
  reset([ME, BRO], { enabled: false, message: 'Mantenimiento' })
  a = await getAutomationAvailability()
  assert.equal(a.enabled, false); assert.equal(a.message, 'Mantenimiento')
})

test('an administrator can switch only their own account, and cannot enable an unconfigured one', async () => {
  reset([{ ...ME, enabled: true }, BRO])
  const off = await dest.setMyPaymentDestinationEnabled('me', false)
  assert.equal(off.enabled, false)
  assert.equal(state.destinations.find(r => r.id === 'd2').enabled, true)
  reset([{ ...ME, card_number: '', confirmation_phone: '', enabled: false }])
  await assert.rejects(dest.setMyPaymentDestinationEnabled('me', true), error => error.code === 'PAYMENT_DESTINATION_REQUIRED')
})

test('open tickets that point to a switched-off account are masked for the customer', async () => {
  reset([ME, BRO])
  await guard.refreshActiveReceivers({ force: true })
  const order = { status: 'WAITING_PAYMENT', destination_card: ME.card_number, confirmation_phone: ME.confirmation_phone }
  const masked = guard.maskRetiredPayment({ destination_card: order.destination_card, confirmation_phone: order.confirmation_phone, payment: { card: order.destination_card, confirmation_phone: order.confirmation_phone, method: 'TRANSFERMOVIL', currency: 'CUP' } }, order)
  assert.equal(masked.payment_unavailable, true)
  assert.equal(masked.destination_card, null)
  assert.equal(masked.confirmation_phone, null)
  assert.deepEqual(masked.payment, { method: 'TRANSFERMOVIL', currency: 'CUP', unavailable: true })
  assert.match(masked.payment_unavailable_message, /No transfieras/)
  // the brother's active account and saldo tickets on it stay untouched
  const ok = { status: 'WAITING_PAYMENT', destination_card: BRO.card_number, confirmation_phone: BRO.confirmation_phone }
  assert.equal(guard.maskRetiredPayment({ ...ok }, ok).payment_unavailable, undefined)
  const saldoRetired = { status: 'WAITING_PAYMENT', destination_card: null, confirmation_phone: ME.confirmation_phone }
  assert.equal(guard.maskRetiredPayment({ confirmation_phone: ME.confirmation_phone }, saldoRetired).payment_unavailable, true)
  // finished tickets are never touched
  const done = { status: 'COMPLETED', destination_card: ME.card_number, confirmation_phone: ME.confirmation_phone }
  assert.equal(guard.maskRetiredPayment({ destination_card: ME.card_number }, done).payment_unavailable, undefined)
})

test('when the active-account list cannot be read nothing is hidden', async () => {
  reset([ME, BRO])
  state.destinationsError = { code: '08006', message: 'down' }
  await guard.refreshActiveReceivers({ force: true })
  const order = { status: 'WAITING_PAYMENT', destination_card: ME.card_number, confirmation_phone: ME.confirmation_phone }
  assert.equal(guard.receiverState(order.destination_card ? { card: order.destination_card, phone: order.confirmation_phone } : {}), 'unknown')
  assert.equal(guard.maskRetiredPayment({ destination_card: order.destination_card }, order).payment_unavailable, undefined)
})
