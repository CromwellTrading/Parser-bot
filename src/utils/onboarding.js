const crypto = require('crypto')
const { normalizePhone } = require('./parser')

function envNumber(name, fallback = null) {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

function cleanDigits(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\D/g, '')
}

function normalizeIdentifier(value) {
  return cleanDigits(value)
}

function normalizeRegisteredPhone(value) {
  return normalizePhone(String(value || '')) || ''
}

function getLicenseConfig() {
  const amount = envNumber('LICENSE_PRICE_AMOUNT', null)
  const durationDays = envNumber('LICENSE_DURATION_DAYS', 30)
  const paymentCard = normalizeCard(process.env.LICENSE_PAYMENT_CARD || '')
  const paymentPhone = normalizeRegisteredPhone(process.env.LICENSE_PAYMENT_PHONE || '')
  const currency = String(process.env.LICENSE_PRICE_CURRENCY || 'CUP').trim().toUpperCase()

  return {
    amount,
    durationDays: durationDays > 0 ? durationDays : 30,
    paymentCard,
    paymentPhone,
    currency,
    configured: amount !== null && Boolean(paymentCard) && Boolean(paymentPhone),
  }
}

function generateActivationCredentials() {
  const activationId = crypto.randomBytes(18).toString('hex')
  const activationSecret = crypto.randomBytes(32).toString('hex')
  const secretHash = crypto.createHash('sha256').update(activationSecret).digest('hex')
  return { activationId, activationSecret, secretHash }
}

function hashActivationSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest('hex')
}

function paymentFingerprint({ activationId, sender, body, receivedAt, messageId, smsId }) {
  return crypto.createHash('sha256')
    .update([
      activationId || '',
      messageId || smsId || '',
      sender || '',
      String(receivedAt || ''),
      body || '',
    ].join('::'))
    .digest('hex')
}

function amountMatches(actual, expected) {
  if (actual === null || actual === undefined || expected === null || expected === undefined) return false
  return Math.abs(Number(actual) - Number(expected)) <= 0.01
}

function normalizeCard(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '')
}

function cardMatches(actualValue, expectedValue) {
  const actual = normalizeCard(actualValue)
  const expected = normalizeCard(expectedValue)
  if (!actual || !expected || actual.length !== expected.length) return false

  // X en una tarjeta enmascarada significa cualquier dígito en esa posición.
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i]
    const a = actual[i]
    if (e !== 'X' && a !== 'X' && e !== a) return false
  }
  return true
}

function paymentRecipientMatches(parsed, config) {
  return Boolean(
    parsed?.receiver_account &&
    config?.paymentCard &&
    cardMatches(parsed.receiver_account, config.paymentCard)
  )
}

function paymentDestinationIsCard(parsed) {
  return Boolean(
    parsed &&
    parsed.direction === 'ENVIADO' &&
    (parsed.type === 'TARJETA_TARJETA' || parsed.type === 'MONEDERO_TARJETA') &&
    parsed.receiver_account
  )
}

function senderMatchesSession(parsed, sessionPhone) {
  const parsedSender = normalizeRegisteredPhone(parsed?.sender_phone || '')
  if (!parsedSender || !sessionPhone) return true
  return parsedSender === normalizeRegisteredPhone(sessionPhone)
}

function evaluateLicensePayment(parsed, session, config = getLicenseConfig()) {
  const reasons = []
  if (!config.configured) {
    return { matched: false, reason: 'LICENSE_PAYMENT_CONFIG_MISSING', reasons: ['Configura LICENSE_PRICE_AMOUNT, LICENSE_PRICE_CURRENCY, LICENSE_PAYMENT_CARD y LICENSE_PAYMENT_PHONE'] }
  }

  // Algunos formatos del parser usan `amount` como gasto total (transferencia + comisión)
  // para los reportes financieros. Para la licencia debemos comparar el monto transferido,
  // no la comisión. Si existe `transfer_amount`, tiene prioridad; en los formatos actuales
  // con comisión se puede recuperar restándola.
  const licenseAmount = parsed?.transfer_amount !== undefined && parsed?.transfer_amount !== null
    ? Number(parsed.transfer_amount)
    : (parsed?.commission !== undefined && parsed?.commission !== null && parsed?.amount !== undefined && parsed?.amount !== null
      ? Number(parsed.amount) - Number(parsed.commission)
      : parsed?.amount)

  if (!paymentDestinationIsCard(parsed)) reasons.push('NOT_OUTGOING_CARD_PAYMENT')
  if (!amountMatches(licenseAmount, config.amount)) reasons.push('AMOUNT_MISMATCH')
  if (String(parsed?.currency || '').toUpperCase() !== config.currency) reasons.push('CURRENCY_MISMATCH')
  if (!paymentRecipientMatches(parsed, config)) reasons.push('RECIPIENT_MISMATCH')
  if (!senderMatchesSession(parsed, session?.phone_number)) reasons.push('SENDER_MISMATCH')

  return {
    matched: reasons.length === 0,
    reason: reasons.length ? reasons.join(',') : 'LICENSE_PAYMENT_MATCHED',
    reasons,
  }
}

function evaluateActivationTiming({
  paymentStartedAt,
  paymentDeadlineAt,
  confirmationDeadlineAt,
  receivedAt,
  transactionAt,
  clockSkewMs = 0,
}) {
  const start = new Date(paymentStartedAt || 0).getTime()
  const deadline = new Date(paymentDeadlineAt || 0).getTime()
  const confirmationDeadline = new Date(confirmationDeadlineAt || 0).getTime()
  const received = new Date(receivedAt || 0).getTime()
  const tx = transactionAt ? new Date(transactionAt).getTime() : null
  const timingKnown = Number.isFinite(tx)
  const transactionNotFuture = !timingKnown || tx <= Date.now() + clockSkewMs
  const effective = timingKnown && transactionNotFuture ? tx : received
  const withinPaymentWindow = start > 0 && deadline > 0 && effective >= start && effective <= deadline
  const receivedWithinConfirmationWindow = confirmationDeadline > 0 && received <= confirmationDeadline
  const receivedAfterPaymentWindow = deadline > 0 && received > deadline
  const receivedBeforePaymentWindow = start > 0 && received < start
  const lateUnknown = receivedAfterPaymentWindow && !withinPaymentWindow && !timingKnown && receivedWithinConfirmationWindow
  return {
    timingKnown,
    transactionAt: timingKnown ? new Date(tx).toISOString() : null,
    effectiveAt: Number.isFinite(effective) ? new Date(effective).toISOString() : null,
    withinPaymentWindow,
    receivedWithinConfirmationWindow,
    receivedAfterPaymentWindow,
    receivedBeforePaymentWindow,
    lateUnknown,
    transactionNotFuture,
  }
}

module.exports = {
  amountMatches,
  cardMatches,
  normalizeCard,
  paymentDestinationIsCard,
  evaluateLicensePayment,
  generateActivationCredentials,
  getLicenseConfig,
  hashActivationSecret,
  normalizeIdentifier,
  normalizeRegisteredPhone,
  paymentFingerprint,
  evaluateActivationTiming,
}
