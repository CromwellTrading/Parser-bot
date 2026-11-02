'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateGameRechargePayment } = require('../src/utils/gameRechargePaymentMatching')

const ticket = {
  payment_source: 'CUBACEL', price_basis: 'SALDO', payment_amount: 625,
  payer_phone: '51234567', confirmation_phone: '53591902',
  created_at: '2026-10-19T14:00:00.000Z',
  payment_deadline_at: '2026-10-19T14:30:00.000Z',
}
const payer = { id: 'payer', phone_number: '51234567' }
const receiver = { id: 'receiver', phone_number: '53591902' }
function sms(direction, overrides = {}) {
  return {
    direction, type: 'CUBACEL', network: 'CUBACEL', currency: 'CUP', amount: 625,
    sender_phone: direction === 'RECIBIDO' ? '51234567' : null,
    receiver_phone: direction === 'ENVIADO' ? '53591902' : null,
    transaction_at: '2026-10-19T14:10:00.000Z',
    ...overrides,
  }
}

test('matches an incoming CUBACEL receipt on the configured receiving line', () => {
  const result = evaluateGameRechargePayment(sms('RECIBIDO'), ticket, receiver, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, true)
  assert.equal(result.match_mode, 'CUBACEL_RECIBIDO')
})

test('matches a sent CUBACEL transfer only from the authenticated payer line', () => {
  const result = evaluateGameRechargePayment(sms('ENVIADO'), ticket, payer, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, true)
  assert.equal(result.match_mode, 'CUBACEL_ENVIADO')
})

test('rejects an incorrect amount, payer, receiver, or late transaction', () => {
  assert.ok(evaluateGameRechargePayment(sms('RECIBIDO', { amount: 624 }), ticket, receiver, '2026-10-19T14:10:00.000Z').reasons.includes('AMOUNT_MISMATCH'))
  assert.ok(evaluateGameRechargePayment(sms('RECIBIDO', { sender_phone: '51111111' }), ticket, receiver, '2026-10-19T14:10:00.000Z').reasons.includes('PAYER_PHONE_MISMATCH'))
  assert.ok(evaluateGameRechargePayment(sms('ENVIADO', { receiver_phone: '53511111' }), ticket, payer, '2026-10-19T14:10:00.000Z').reasons.includes('RECEIVER_PHONE_MISMATCH'))
  assert.ok(evaluateGameRechargePayment(sms('ENVIADO', { transaction_at: '2026-10-19T14:40:00.000Z' }), ticket, payer, '2026-10-19T14:40:00.000Z').reasons.includes('PAYMENT_OUTSIDE_WINDOW'))
})

test('does not match CUBACEL against CUP Transfermóvil orders', () => {
  const result = evaluateGameRechargePayment(sms('RECIBIDO'), { ...ticket, payment_source: 'TRANSFERMOVIL', price_basis: 'CUP' }, receiver, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('PAYMENT_NETWORK_MISMATCH'))
})

test('rejects a CUBACEL payment source paired with CUP pricing', () => {
  const result = evaluateGameRechargePayment(sms('RECIBIDO'), { ...ticket, price_basis: 'CUP' }, receiver, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('PAYMENT_SOURCE_CURRENCY_MISMATCH'))
})
