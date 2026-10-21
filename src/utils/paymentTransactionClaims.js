'use strict'

const supabase = require('../supabase')

/**
 * Claim one incoming Transfermóvil transaction ID for exactly one store ticket.
 * Database uniqueness makes this safe when parallel requests/device sessions see
 * the same receipt at almost the same time. Replays for the same ticket are allowed.
 */
async function claimPaymentTransaction({ transactionId, clientId, source, orderId }) {
  const id = String(transactionId || '').trim().slice(0, 120)
  if (!id) return true // Legacy SMS without a transaction identifier uses strict ticket matching.
  const allowedSources = new Set(['ETECSA', 'GAMEMARKET', 'WALLET_TOPUP', 'CART'])
  if (!allowedSources.has(source) || !clientId || !orderId) {
    const error = new Error('Invalid payment transaction claim')
    error.code = 'INVALID_PAYMENT_CLAIM'
    throw error
  }
  const { data, error } = await supabase.rpc('store_claim_payment_transaction', {
    p_transaction_id: id,
    p_client_id: clientId,
    p_source: source,
    p_order_id: orderId,
  })
  if (error) throw error
  if (data !== true) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(), event: 'PAYMENT_TRANSACTION_ALREADY_CLAIMED', source,
      transaction_id: id, order_id: orderId,
    }))
    return false
  }
  return true
}

module.exports = { claimPaymentTransaction }
