'use strict'

const { evaluateEtecsaPayment, normalizePayerPhone } = require('./etecsaPaymentMatching')

/**
 * Wallet tickets name their requested amount `amount_cup`, while ETECSA and
 * Game Market tickets name it `payment_amount`. Always adapt that schema at
 * the boundary before using the shared Transfermóvil matcher.
 */
function walletTicketForPaymentMatching(topup) {
  if (!topup || typeof topup !== 'object') return topup
  return { ...topup, payment_amount: topup.amount_cup }
}

function evaluateOfficialStorePayment(parsed, ticket, receivedAt) {
  const strict = evaluateEtecsaPayment(parsed, ticket, receivedAt)
  if (strict.matched) return { ...strict, match_mode: 'STRICT' }

  // Some Transfermóvil receipt templates omit the payer phone. A unique
  // destination-side receipt can still be safely matched only when it carries
  // a bank transaction ID and every other field (amount, destination card,
  // payment receiver, and time window) matches exactly. Global cross-store
  // ambiguity checks are performed by the caller before crediting.
  const senderPhoneMissing = !normalizePayerPhone(parsed?.sender_phone)
  if (
    String(parsed?.direction || '').toUpperCase() === 'RECIBIDO' &&
    String(parsed?.transaction_id || '').trim() !== '' &&
    senderPhoneMissing &&
    strict.reasons.length === 1 &&
    strict.reasons[0] === 'PAYER_PHONE_NOT_IN_SMS'
  ) {
    return { ...strict, matched: true, reasons: [], match_mode: 'RECEIPT_TRANSACTION_ID' }
  }
  return { ...strict, match_mode: 'NO_MATCH' }
}

function evaluateWalletTopupPayment(parsed, topup, receivedAt) {
  return evaluateOfficialStorePayment(parsed, walletTicketForPaymentMatching(topup), receivedAt)
}

function isPotentialWalletTopupPayment(parsed, topup, receivedAt) {
  const strict = evaluateEtecsaPayment(parsed, walletTicketForPaymentMatching(topup), receivedAt)
  // Card/network/currency/amount/type mismatches are not this ticket's payment.
  // When destination, value and payment route match but phone/time is missing or ambiguous,
  // raise a review instead of silently losing a potentially genuine, delayed bank SMS.
  const allowedUnverified = new Set([
    'PAYER_PHONE_NOT_IN_SMS', 'PAYER_PHONE_MISMATCH',
    'PAYMENT_TIME_UNAVAILABLE', 'PAYMENT_OUTSIDE_WINDOW',
  ])
  return !strict.matched && strict.reasons.length > 0 && strict.reasons.every(reason => allowedUnverified.has(reason))
}

module.exports = {
  walletTicketForPaymentMatching,
  evaluateOfficialStorePayment,
  evaluateWalletTopupPayment,
  isPotentialWalletTopupPayment,
}
