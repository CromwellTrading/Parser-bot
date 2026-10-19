'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { evaluateSaldoWalletTransfer, isPotentialWalletTopupPayment } = require('../src/utils/walletPaymentMatching')

const topup = {
  currency: 'SALDO',
  amount_saldo: 500,
  payer_phone: '51234567',
  confirmation_phone: '53591902',
  created_at: '2026-10-19T14:00:00.000Z',
  payment_deadline_at: '2026-10-19T14:30:00.000Z',
}
const receiverClient = { id: 'receiver', phone_number: '53591902' }
const payerClient = { id: 'payer', phone_number: '51234567' }

function received(overrides = {}) {
  return {
    direction: 'RECIBIDO', type: 'CUBACEL', network: 'CUBACEL',
    // Cubacel's SMS often labels the unit CUP; this is still a mobile-credit rail.
    currency: 'CUP', amount: 500, sender_phone: '51234567', receiver_phone: null,
    transaction_at: null,
    ...overrides,
  }
}
function sent(overrides = {}) {
  return {
    direction: 'ENVIADO', type: 'CUBACEL', network: 'CUBACEL',
    currency: 'CUP', amount: 500, sender_phone: null, receiver_phone: '53591902',
    transaction_at: '2026-10-19T14:10:00.000Z',
    ...overrides,
  }
}

test('credits Saldo Móvil only for an exact incoming CUBACEL transfer to configured receiver phone', () => {
  const result = evaluateSaldoWalletTransfer(received(), topup, receiverClient, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, true)
  assert.equal(result.match_mode, 'CUBACEL_RECIBIDO')
})

test('credits Saldo Móvil when the payer-side CUBACEL SMS matches sender and destination phones', () => {
  const result = evaluateSaldoWalletTransfer(sent(), topup, payerClient, '2026-10-19T14:10:01.000Z')
  assert.equal(result.matched, true)
  assert.equal(result.match_mode, 'CUBACEL_ENVIADO')
})

test('does not cross-credit a CUP Transfermóvil topup with a CUBACEL SMS', () => {
  const result = evaluateSaldoWalletTransfer(received(), { ...topup, currency: 'CUP' }, receiverClient, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, false)
  assert.ok(result.reasons.includes('WALLET_CURRENCY_MISMATCH'))
})

test('rejects wrong mobile amount, payer phone, receiver phone, and late transfer', () => {
  const wrongAmount = evaluateSaldoWalletTransfer(received({ amount: 499 }), topup, receiverClient, '2026-10-19T14:10:00.000Z')
  assert.ok(wrongAmount.reasons.includes('AMOUNT_MISMATCH'))
  const wrongPayer = evaluateSaldoWalletTransfer(received({ sender_phone: '51111111' }), topup, receiverClient, '2026-10-19T14:10:00.000Z')
  assert.ok(wrongPayer.reasons.includes('PAYER_PHONE_MISMATCH'))
  const wrongReceiver = evaluateSaldoWalletTransfer(sent({ receiver_phone: '53511111' }), topup, payerClient, '2026-10-19T14:10:00.000Z')
  assert.ok(wrongReceiver.reasons.includes('RECEIVER_PHONE_MISMATCH'))
  const late = evaluateSaldoWalletTransfer(sent({ transaction_at: '2026-10-19T14:40:00.000Z' }), topup, payerClient, '2026-10-19T14:40:00.000Z')
  assert.ok(late.reasons.includes('PAYMENT_OUTSIDE_WINDOW'))
})

test('flags an otherwise plausible Saldo Móvil receipt missing its payer phone for manual review, never auto-credit', () => {
  const sms = received({ sender_phone: null })
  const result = evaluateSaldoWalletTransfer(sms, topup, receiverClient, '2026-10-19T14:10:00.000Z')
  assert.equal(result.matched, false)
  assert.equal(isPotentialWalletTopupPayment(sms, topup, '2026-10-19T14:10:00.000Z', receiverClient), true)
})

test('dual-currency migration keeps separate balance and ledger columns and currency-aware atomic purchase/refund RPCs', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/024_dual_currency_wallet.sql'), 'utf8')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS balance_saldo/)
  assert.match(migration, /ADD COLUMN IF NOT EXISTS amount_saldo/)
  assert.match(migration, /currency = 'CUP'.*amount_cup/s)
  assert.match(migration, /currency = 'SALDO'.*amount_saldo/s)
  assert.match(migration, /store_wallet_create_game_order\([\s\S]*p_currency text/)
  assert.match(migration, /Compra Game Market con Wallet Saldo Móvil/)
  assert.match(migration, /SET status='REFUNDED',wallet_refunded_at=now\(\)/)
})
