'use strict'

const supabase = require('../supabase')
const { parseSms } = require('./parser')
const { processIncomingTransfer: processEtecsaTransfer } = require('./etecsaOrders')
const { processIncomingTransfer: processGameTransfer } = require('./rechargeGamesOrders')
const { processIncomingTransfer: processWalletTransfer } = require('./storeWallet')

let started = false
let running = false
const LOOKBACK_HOURS = Math.max(1, Math.min(72, Number(process.env.PAYMENT_SMS_RECONCILE_LOOKBACK_HOURS || 24)))
const INTERVAL_MS = Math.max(60_000, Number(process.env.PAYMENT_SMS_RECONCILE_INTERVAL_MS || 180_000))

async function reconcileRecentPaymentSms() {
  if (running) return { scanned: 0, matched: 0, skipped: true }
  running = true
  let scanned = 0
  let matched = 0
  try {
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()
    const { data: rows, error } = await supabase.from('sms_logs')
      .select('id, client_id, sender, body, received_at')
      .gte('received_at', cutoff)
      .order('received_at', { ascending: false })
      .limit(300)
    if (error) throw error

    // Reconciliation needs the receiver phone as well as client_id so destination-side
    // RECIBIDO receipts can be matched after a restart, even if the ticket belongs to
    // a different client/device session.
    const clientIds = [...new Set((rows || []).map(row => row.client_id).filter(Boolean))]
    const clientsById = new Map()
    if (clientIds.length) {
      const { data: clients, error: clientsError } = await supabase.from('clients')
        .select('id,phone_number').in('id', clientIds)
      if (clientsError) throw clientsError
      for (const client of clients || []) clientsById.set(String(client.id), client)
    }

    // Oldest first so a ticket's receipt is reconciled consistently if a device sent
    // several matching notifications. Matching remains idempotent on transaction ID.
    for (const row of (rows || []).slice().reverse()) {
      const parsed = parseSms(row.sender, row.body, row.received_at)
      if (String(parsed?.network || '').toUpperCase() !== 'PAGOMOVIL' ||
          String(parsed?.currency || '').toUpperCase() !== 'CUP' ||
          !['ENVIADO', 'RECIBIDO'].includes(String(parsed?.direction || '').toUpperCase()) ||
          !['TARJETA_TARJETA', 'MONEDERO_TARJETA'].includes(String(parsed?.type || '').toUpperCase()) ||
          !Number.isFinite(Number(parsed?.amount))) continue
      scanned += 1
      const client = clientsById.get(String(row.client_id)) || { id: row.client_id }
      let etecsa = null
      let game = null
      try {
        etecsa = await processEtecsaTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id })
      } catch (error) {
        console.error('[PaymentReconciler] ETECSA match failed:', error?.code || error?.message || 'unknown')
      }
      try {
        game = await processGameTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id })
      } catch (error) {
        console.error('[PaymentReconciler] Game match failed:', error?.code || error?.message || 'unknown')
      }
      let wallet = null
      try {
        wallet = await processWalletTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id })
      } catch (error) {
        console.error('[PaymentReconciler] Wallet match failed:', error?.code || error?.message || 'unknown')
      }
      if (etecsa || game || wallet) matched += 1
    }
    if (matched) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'PAYMENT_SMS_RECONCILIATION_COMPLETED', scanned, matched, lookback_hours: LOOKBACK_HOURS }))
    }
    return { scanned, matched }
  } catch (error) {
    console.error('[PaymentReconciler] Reconciliation could not complete:', error?.code || error?.message || 'unknown')
    return { scanned, matched, error: error?.code || 'reconciliation_error' }
  } finally {
    running = false
  }
}

function startPaymentSmsReconciler() {
  if (started) return
  started = true
  // Re-process recent saved notifications after deploy/restart, so a payment that
  // reached sms_logs just before the bug fix does not require the buyer to pay again.
  setTimeout(() => reconcileRecentPaymentSms().catch(() => {}), 12_000)
  setInterval(() => reconcileRecentPaymentSms().catch(() => {}), INTERVAL_MS)
}

module.exports = { reconcileRecentPaymentSms, startPaymentSmsReconciler }
