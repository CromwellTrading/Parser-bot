'use strict'

const { evaluateEtecsaPayment, normalizePayerPhone, isConfiguredPaymentReceiver, amountMatches } = require('./etecsaPaymentMatching')

/**
 * Transfermóvil Wallet tickets historically use amount_cup. Normalize only at
 * the boundary; the currency column remains the source of truth.
 */
function walletTicketForPaymentMatching(topup) {
  if (!topup || typeof topup !== 'object') return topup
  return { ...topup, payment_amount: topup.amount_cup }
}

function evaluateOfficialStorePayment(parsed, ticket, receivedAt) {
  const strict = evaluateEtecsaPayment(parsed, ticket, receivedAt)
  if (strict.matched) return { ...strict, match_mode: 'STRICT' }

  // Some destination-side Transfermóvil receipts omit the payer phone. Only
  // permit the exception when a unique transaction ID and every other field match.
  const senderPhoneMissing = !normalizePayerPhone(parsed?.sender_phone)
  if (
    String(parsed?.direction || '').toUpperCase() === 'RECIBIDO' &&
    String(parsed?.transaction_id || '').trim() !== '' &&
    senderPhoneMissing && strict.reasons.length === 1 && strict.reasons[0] === 'PAYER_PHONE_NOT_IN_SMS'
  ) return { ...strict, matched: true, reasons: [], match_mode: 'RECEIPT_TRANSACTION_ID' }
  return { ...strict, match_mode: 'NO_MATCH' }
}

function evaluateWalletTopupPayment(parsed, topup, receivedAt) {
  return evaluateOfficialStorePayment(parsed, walletTicketForPaymentMatching(topup), receivedAt)
}

/**
 * Validate a mobile-credit transfer into the Saldo Móvil wallet. Cubacel SMS
 * often spells the amount suffix as CUP, but it represents mobile account
 * balance, not CUP cash. It must never match a PAGOMOVIL wallet ticket.
 *
 * Supports the receiving line's RECIBIDO SMS and the payer line's ENVIADO SMS.
 * A credit requires exact value, both known phone roles, CUBACEL network, and
 * a timestamp inside the ticket window. No amount/currency conversion occurs.
 */
function evaluateSaldoWalletTransfer(parsed, topup, client, receivedAt, toleranceMs = 120_000) {
  const reasons = []
  const direction = String(parsed?.direction || '').toUpperCase()
  const network = String(parsed?.network || '').toUpperCase()
  const type = String(parsed?.type || '').toUpperCase()
  const ticketCurrency = String(topup?.currency || 'CUP').toUpperCase()
  const payer = normalizePayerPhone(topup?.payer_phone)
  const destination = normalizePayerPhone(topup?.confirmation_phone)
  const clientPhone = normalizePayerPhone(client?.phone_number)
  const amount = topup?.amount_saldo

  if (ticketCurrency !== 'SALDO') reasons.push('WALLET_CURRENCY_MISMATCH')
  if (network !== 'CUBACEL' || type !== 'CUBACEL') reasons.push('NOT_CUBACEL_BALANCE_TRANSFER')
  if (!['RECIBIDO', 'ENVIADO'].includes(direction)) reasons.push('UNSUPPORTED_TRANSFER_DIRECTION')
  if (!amountMatches(parsed?.amount, amount)) reasons.push('AMOUNT_MISMATCH')
  if (!payer || !destination) reasons.push('TOPUP_PHONE_CONFIGURATION_MISSING')

  if (direction === 'RECIBIDO') {
    if (!clientPhone || !destination || clientPhone !== destination) reasons.push('RECEIVER_PHONE_MISMATCH')
    const sender = normalizePayerPhone(parsed?.sender_phone)
    if (!sender) reasons.push('PAYER_PHONE_NOT_IN_SMS')
    else if (!payer || sender !== payer) reasons.push('PAYER_PHONE_MISMATCH')
  } else if (direction === 'ENVIADO') {
    // On the sender's device, the account's registered phone identifies who sent it.
    if (!clientPhone || !payer || clientPhone !== payer) reasons.push('PAYER_DEVICE_MISMATCH')
    const recipient = normalizePayerPhone(parsed?.receiver_phone)
    if (!recipient || !destination || recipient !== destination) reasons.push('RECEIVER_PHONE_MISMATCH')
  }

  const start = Date.parse(topup?.created_at || '')
  const deadline = Date.parse(topup?.payment_deadline_at || '')
  const transactionAt = Date.parse(parsed?.transaction_at || '')
  const received = Date.parse(receivedAt || '')
  const hasTransactionTime = Number.isFinite(transactionAt)
  const effective = hasTransactionTime ? transactionAt : received
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || !Number.isFinite(effective)) {
    reasons.push('PAYMENT_TIME_UNAVAILABLE')
  } else if (hasTransactionTime
    ? effective < start || effective > deadline
    : effective < start - toleranceMs || effective > deadline + toleranceMs) {
    reasons.push('PAYMENT_OUTSIDE_WINDOW')
  }

  return {
    matched: reasons.length === 0,
    reasons,
    transaction_at: hasTransactionTime ? new Date(transactionAt).toISOString() : null,
    match_mode: reasons.length === 0 ? `CUBACEL_${direction}` : 'NO_MATCH',
  }
}

function isPotentialWalletTopupPayment(parsed, topup, receivedAt, client = null) {
  if (String(topup?.currency || 'CUP').toUpperCase() === 'SALDO') {
    const result = evaluateSaldoWalletTransfer(parsed, topup, client, receivedAt)
    // A matching CUBACEL amount may deserve human review if the receipt omits
    // a phone/time field or an account was registered under an old number. It
    // is never auto-credited by this fallback; amount and rail must still match.
    const potentiallyReviewable = new Set([
      'PAYER_PHONE_NOT_IN_SMS', 'PAYER_PHONE_MISMATCH', 'PAYER_DEVICE_MISMATCH',
      'RECEIVER_PHONE_MISMATCH', 'PAYMENT_TIME_UNAVAILABLE', 'PAYMENT_OUTSIDE_WINDOW',
      'TOPUP_PHONE_CONFIGURATION_MISSING',
    ])
    return result.reasons.length > 0 && result.reasons.every(reason => potentiallyReviewable.has(reason))
  }
  const strict = evaluateEtecsaPayment(parsed, walletTicketForPaymentMatching(topup), receivedAt)
  const allowedUnverified = new Set(['PAYER_PHONE_NOT_IN_SMS', 'PAYER_PHONE_MISMATCH', 'PAYMENT_TIME_UNAVAILABLE', 'PAYMENT_OUTSIDE_WINDOW'])
  return !strict.matched && strict.reasons.length > 0 && strict.reasons.every(reason => allowedUnverified.has(reason))
}

module.exports = {
  walletTicketForPaymentMatching,
  evaluateOfficialStorePayment,
  evaluateWalletTopupPayment,
  evaluateSaldoWalletTransfer,
  isPotentialWalletTopupPayment,
  isConfiguredPaymentReceiver,
}
