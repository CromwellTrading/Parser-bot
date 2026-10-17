'use strict'

const { normalizePhone } = require('./parser')
const { cardMatches, normalizeCard } = require('./onboarding')

function normalizePayerPhone(value) {
  const normalized = normalizePhone(String(value || '')) || ''
  return normalized.replace(/\D/g, '')
}

function amountMatches(actual, expected) {
  if (actual === null || actual === undefined || expected === null || expected === undefined) return false
  const a = Number(actual)
  const b = Number(expected)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01
}

function evaluateEtecsaPayment(parsed, order, receivedAt, toleranceMs = 120_000) {
  const reasons = []
  const direction = String(parsed?.direction || '').toUpperCase()
  const type = String(parsed?.type || '').toUpperCase()
  const network = String(parsed?.network || '').toUpperCase()
  // A transfer can be observed either on the payer's phone (ENVIADO) or
  // on the destination account's phone (RECIBIDO). Both are acceptable only
  // when the rest of the payment details match the ticket exactly.
  if (!['ENVIADO', 'RECIBIDO'].includes(direction)) reasons.push('UNSUPPORTED_TRANSFER_DIRECTION')
  if (network !== 'PAGOMOVIL') reasons.push('UNSUPPORTED_PAYMENT_NETWORK')
  if (!['TARJETA_TARJETA', 'MONEDERO_TARJETA'].includes(type)) reasons.push('NOT_CARD_TRANSFER')
  if (String(parsed?.currency || '').toUpperCase() !== 'CUP') reasons.push('CURRENCY_MISMATCH')
  if (!amountMatches(parsed?.amount, order?.payment_amount)) reasons.push('AMOUNT_MISMATCH')

  const actualCard = String(parsed?.receiver_account || '')
  const expectedCard = normalizeCard(order?.destination_card || '')
  if (!actualCard || !expectedCard || !cardMatches(actualCard, expectedCard)) reasons.push('DESTINATION_CARD_MISMATCH')

  const actualPhone = normalizePayerPhone(parsed?.sender_phone)
  const expectedPhone = normalizePayerPhone(order?.payer_phone)
  if (!actualPhone) reasons.push('PAYER_PHONE_NOT_IN_SMS')
  else if (!expectedPhone || actualPhone !== expectedPhone) reasons.push('PAYER_PHONE_MISMATCH')

  const start = Date.parse(order?.created_at || '')
  const deadline = Date.parse(order?.payment_deadline_at || '')
  const transactionAt = Date.parse(parsed?.transaction_at || '')
  const received = Date.parse(receivedAt || '')
  const hasTransactionTime = Number.isFinite(transactionAt)
  const effective = hasTransactionTime ? transactionAt : received
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || !Number.isFinite(effective)) {
    reasons.push('PAYMENT_TIME_UNAVAILABLE')
  } else if (hasTransactionTime
      ? (effective < start || effective > deadline)
      : (effective < start - toleranceMs || effective > deadline + toleranceMs)) {
    // If the bank timestamp exists, enforce the exact ticket window. The small
    // tolerance is only for SMS delivery time when the bank timestamp is absent.
    reasons.push('PAYMENT_OUTSIDE_WINDOW')
  }

  return {
    matched: reasons.length === 0,
    reasons,
    transaction_at: hasTransactionTime ? new Date(transactionAt).toISOString() : null,
  }
}

module.exports = { normalizePayerPhone, amountMatches, evaluateEtecsaPayment }
