'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateEtecsaPayment, normalizePayerPhone } = require('../src/utils/etecsaPaymentMatching')

const order = {
  created_at: '2026-10-16T06:00:00.000Z',
  payment_deadline_at: '2026-10-16T06:30:00.000Z',
  payment_amount: 125,
  payer_phone: '51234567',
  destination_card: '1234567890123456',
}

function outgoing(overrides = {}) {
  return {
    direction: 'ENVIADO',
    type: 'MONEDERO_TARJETA',
    network: 'PAGOMOVIL',
    currency: 'CUP',
    amount: 125,
    sender_phone: '51234567',
    receiver_account: '1234567890123456',
    transaction_id: 'TX-ETECSA-1',
    transaction_at: '2026-10-16T06:10:00.000Z',
    ...overrides,
  }
}

test('normalizes a Cuba country prefix for the payer phone', () => {
  assert.equal(normalizePayerPhone('+53 51234567'), '51234567')
})

test('accepts only an outgoing Transfermovil card transfer with matching phone, card, amount and time', () => {
  const result = evaluateEtecsaPayment(outgoing(), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, true)
  assert.deepEqual(result.reasons, [])
})

test('does not auto-confirm when Transfermovil SMS does not expose the payer phone', () => {
  const result = evaluateEtecsaPayment(outgoing({ sender_phone: null }), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('PAYER_PHONE_NOT_IN_SMS'))
})

test('rejects transfers to a different destination card', () => {
  const result = evaluateEtecsaPayment(outgoing({ receiver_account: '9999999999999999' }), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('DESTINATION_CARD_MISMATCH'))
})

test('rejects transfers outside the 30 minute ticket window', () => {
  const result = evaluateEtecsaPayment(outgoing({ transaction_at: '2026-10-16T06:31:00.000Z' }), order, '2026-10-16T06:31:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('PAYMENT_OUTSIDE_WINDOW'))
})

test('accepts delayed SMS when the transaction itself occurred inside the ticket window', () => {
  const result = evaluateEtecsaPayment(
    outgoing({ transaction_at: '2026-10-16T06:29:58.000Z' }),
    order,
    '2026-10-16T06:31:00.000Z'
  )
  assert.equal(result.matched, true)
  assert.equal(result.transaction_at, '2026-10-16T06:29:58.000Z')
})

test('does not mislabel SMS arrival time as the bank transaction time', () => {
  const result = evaluateEtecsaPayment(outgoing({ transaction_at: null }), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, true)
  assert.equal(result.transaction_at, null)
})

test('rejects payments that are not identified as Transfermovil/Pago x Móvil', () => {
  const result = evaluateEtecsaPayment(outgoing({ network: 'ENZONA' }), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('UNSUPPORTED_PAYMENT_NETWORK'))
})

test('rejects incoming transfers even when phone, card and amount match', () => {
  const result = evaluateEtecsaPayment(outgoing({ direction: 'RECIBIDO' }), order, '2026-10-16T06:11:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('NOT_OUTGOING_TRANSFER'))
})
