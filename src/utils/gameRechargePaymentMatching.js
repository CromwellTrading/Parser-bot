'use strict'

const { evaluateOfficialStorePayment, evaluateSaldoWalletTransfer } = require('./walletPaymentMatching')

/** Match either a legacy CUP Transfermóvil ticket or a direct CUBACEL Saldo ticket.
 * Currency and payment rail are deliberately coupled; no cross-currency matching.
 */
function evaluateGameRechargePayment(parsed, order, client, receivedAt) {
  const source = String(order?.payment_source || 'TRANSFERMOVIL').toUpperCase()
  const basis = String(order?.price_basis || 'CUP').toUpperCase()
  if (source === 'CUBACEL') {
    if (basis !== 'SALDO') return { matched: false, reasons: ['PAYMENT_SOURCE_CURRENCY_MISMATCH'] }
    const ticket = {
      currency: 'SALDO',
      amount_saldo: Number(order?.payment_amount),
      payer_phone: order?.payer_phone,
      confirmation_phone: order?.confirmation_phone,
      created_at: order?.created_at,
      payment_deadline_at: order?.payment_deadline_at,
    }
    return evaluateSaldoWalletTransfer(parsed, ticket, client, receivedAt)
  }
  if (source !== 'TRANSFERMOVIL' || basis !== 'CUP') {
    return { matched: false, reasons: ['UNSUPPORTED_GAME_RECHARGE_PAYMENT_METHOD'] }
  }
  if (String(parsed?.network || '').toUpperCase() === 'CUBACEL') {
    return { matched: false, reasons: ['PAYMENT_NETWORK_MISMATCH'] }
  }
  return evaluateOfficialStorePayment(parsed, order, receivedAt)
}

module.exports = { evaluateGameRechargePayment }
