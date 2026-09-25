const test = require('node:test')
const assert = require('node:assert/strict')
const { parseSms } = require('../src/utils/parser')
const { evaluateLicensePayment, evaluateActivationTiming } = require('../src/utils/onboarding')
const { normalizeClientProfile } = require('../src/utils/clientProfile')

const config = {
  configured: true,
  amount: 20,
  currency: 'CUP',
  paymentCard: '1234567890123456',
}

test('matches an outgoing MiTransfer payment with exact phone and amount', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 20 CUP. Beneficiario: 1234567890123456. Ordenante: 51234567. Nro Transaccion: ABC123. Saldo restante: 100 CUP')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, true)
})


test('matches transfer amount when parser amount includes a commission', () => {
  const parsed = {
    direction: 'ENVIADO',
    type: 'MONEDERO_TARJETA',
    amount: 21,
    commission: 1,
    currency: 'CUP',
    receiver_account: '1234567890123456',
    sender_phone: '51234567',
  }
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, true)
})

test('rejects wrong amount', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 25 CUP. Beneficiario: 1234567890123456. Ordenante: 51234567. Nro Transaccion: ABC124. Saldo restante: 95 CUP')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, false)
  assert.match(result.reason, /AMOUNT_MISMATCH/)
})

test('rejects wrong recipient', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 20 CUP. Beneficiario: 9999999999999999. Ordenante: 51234567. Nro Transaccion: ABC125. Saldo restante: 100 CUP')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, false)
  assert.match(result.reason, /RECIPIENT_MISMATCH/)
})

test('does not confuse wallet with phone in client profile', () => {
  const profile = normalizeClientProfile({ wallet: '5359190241', card1: '1234-5678' })
  assert.equal(profile.phone_number, undefined)
  assert.equal(profile.wallet, '5359190241')
  assert.equal(profile.card1, '1234-5678')
})


test('rejects an incoming payment even when amount and destination data look similar', () => {
  const parsed = parseSms('PAGOxMOVIL', 'EL TITULAR DEL TELEFONO 51234567 LE HA REALIZADO UNA TRANSFERENCIA A LA CUENTA: 1234567890123456 DE 20 CUP. NRO. TRANSACCION ABC126.')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, false)
  assert.match(result.reason, /NOT_OUTGOING_CARD_PAYMENT/)
})

test('rejects a mobile/wallet payment to the same amount when it is not sent to the configured card', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 20 CUP. Beneficiario: 5359190241. Nro Transaccion: ABC126. Saldo restante: 80 CUP')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, false)
  assert.match(result.reason, /NOT_OUTGOING_CARD_PAYMENT|RECIPIENT_MISMATCH/)
})

test('accepts a masked destination card when it corresponds to the configured full card', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 20 CUP. Beneficiario: 1234XXXXXXXX3456. Ordenante: 51234567. Nro Transaccion: ABC127. Saldo restante: 100 CUP')
  const result = evaluateLicensePayment(parsed, { phone_number: '51234567' }, config)
  assert.equal(result.matched, true)
})


test('extracts transaction time from a full Cuba date/time', () => {
  const parsed = parseSms('PAGOxMOVIL', 'LA TRANSFERENCIA FUE COMPLETADA. Monto: 20 CUP. Beneficiario: 1234567890123456. Ordenante: 51234567. Fecha: 25/09/2026 12:04:58. Nro Transaccion: ABC128')
  assert.match(parsed.transaction_at || '', /2026-09-25T16:04:58\.000Z/)
})

test('late SMS is accepted when transaction time was inside the 5-minute payment window', () => {
  const result = evaluateActivationTiming({
    paymentStartedAt: '2026-09-25T16:00:00.000Z',
    paymentDeadlineAt: '2026-09-25T16:05:00.000Z',
    confirmationDeadlineAt: '2026-09-25T16:20:00.000Z',
    receivedAt: '2026-09-25T16:11:00.000Z',
    transactionAt: '2026-09-25T16:04:58.000Z',
  })
  assert.equal(result.withinPaymentWindow, true)
  assert.equal(result.receivedWithinConfirmationWindow, true)
})

test('late SMS without transaction time stays pending', () => {
  const result = evaluateActivationTiming({
    paymentStartedAt: '2026-09-25T16:00:00.000Z',
    paymentDeadlineAt: '2026-09-25T16:05:00.000Z',
    confirmationDeadlineAt: '2026-09-25T16:20:00.000Z',
    receivedAt: '2026-09-25T16:11:00.000Z',
    transactionAt: null,
  })
  assert.equal(result.lateUnknown, true)
})

test('payment made after the 5-minute window is rejected', () => {
  const result = evaluateActivationTiming({
    paymentStartedAt: '2026-09-25T16:00:00.000Z',
    paymentDeadlineAt: '2026-09-25T16:05:00.000Z',
    confirmationDeadlineAt: '2026-09-25T16:20:00.000Z',
    receivedAt: '2026-09-25T16:08:10.000Z',
    transactionAt: '2026-09-25T16:08:00.000Z',
  })
  assert.equal(result.withinPaymentWindow, false)
  assert.equal(result.lateUnknown, false)
})

test('payment made before the user started the window is rejected', () => {
  const result = evaluateActivationTiming({
    paymentStartedAt: '2026-09-25T16:00:00.000Z',
    paymentDeadlineAt: '2026-09-25T16:05:00.000Z',
    confirmationDeadlineAt: '2026-09-25T16:20:00.000Z',
    receivedAt: '2026-09-25T16:01:10.000Z',
    transactionAt: '2026-09-25T15:59:59.000Z',
  })
  assert.equal(result.withinPaymentWindow, false)
})
