'use strict'

const supabase = require('../supabase')
const { parseSms } = require('./parser')
const { processIncomingTransfer: processEtecsaTransfer } = require('./etecsaOrders')
const { processIncomingTransfer: processGameTransfer } = require('./rechargeGamesOrders')
const { processIncomingTransfer: processWalletTransfer } = require('./storeWallet')
const { processIncomingTransfer: processCartTransfer, getCartFeatureStatus } = require('./storeCartOrders')
const { readAllRows } = require('./supabasePagination')

let started = false
let running = false
function boundedIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
const LOOKBACK_HOURS = boundedIntegerEnv('PAYMENT_SMS_RECONCILE_LOOKBACK_HOURS', 72, 1, 72)
const INTERVAL_MS = boundedIntegerEnv('PAYMENT_SMS_RECONCILE_INTERVAL_MS', 90_000, 60_000, 24 * 60 * 60 * 1000)
const MAX_SMS_ROWS = boundedIntegerEnv('PAYMENT_SMS_RECONCILE_MAX_ROWS', 10_000, 500, 20_000)
const PAGE_SIZE = 500

async function reconcileRecentPaymentSms() {
  if (running) return { scanned: 0, matched: 0, skipped: true }
  running = true
  let scanned = 0
  let matched = 0
  try {
    const lookbackCutoffMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
    const lookbackCutoff = new Date(lookbackCutoffMs).toISOString()

    // Don't repeatedly scan old SMS if no store ticket can currently be paid/reconciled.
    // EXPIRED tickets stay eligible only when their bank transaction timestamp proves it
    // happened during the ticket window (enforced by each payment matcher).
    const cartAvailable = await getCartFeatureStatus().then(v => v.enabled).catch(() => false)
    const [etecsaTickets, gameTickets, walletTickets, cartTickets] = await Promise.all([
      supabase.from('etecsa_orders').select('created_at').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', lookbackCutoff).order('created_at', { ascending: true }).limit(1000),
      supabase.from('game_recharge_orders').select('created_at').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', lookbackCutoff).order('created_at', { ascending: true }).limit(1000),
      supabase.from('store_wallet_topups').select('created_at').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', lookbackCutoff).order('created_at', { ascending: true }).limit(1000),
      ...(cartAvailable ? [supabase.from('store_cart_orders').select('created_at').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', lookbackCutoff).order('created_at', { ascending: true }).limit(1000)] : []),
    ])
    for (const result of [etecsaTickets, gameTickets, walletTickets, ...((cartAvailable && cartTickets) ? [cartTickets] : [])]) if (result.error) throw result.error
    // Do not cap reviewed completed tickets at an arbitrary 100: a customer's successful
    // credit may need ledger repair after a past partial/manual operation.
    const reviewedCompletedWallet = await readAllRows(() => supabase.from('store_wallet_topups')
      .select('id,payment_transaction_id,payment_sms_log_id,payment_transaction_at')
      .eq('status', 'COMPLETED').not('payment_review_at', 'is', null)
      .gte('created_at', lookbackCutoff).order('created_at', { ascending: true }),
    { pageSize: 500, maxRows: 100_000 })
    // A completed ticket can still need ledger repair if a prior RPC exposed a balance/ledger
    // mismatch. Retry the idempotent SQL repair automatically; never increment balance blindly.
    for (const topup of reviewedCompletedWallet) {
      const { error } = await supabase.rpc('store_wallet_credit_topup', {
        p_topup_id: topup.id,
        p_payment_transaction_id: topup.payment_transaction_id || null,
        p_payment_sms_log_id: topup.payment_sms_log_id || null,
        p_payment_transaction_at: topup.payment_transaction_at || null,
      })
      if (error) console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'PAYMENT_RECONCILE_COMPLETED_WALLET_REPAIR_FAILED', topup_id: topup.id, code: error.code || null, message: String(error.message || 'unknown').slice(0, 160) }))
      else console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'PAYMENT_RECONCILE_COMPLETED_WALLET_REPAIR_OK', topup_id: topup.id }))
    }
    const tickets = [...(etecsaTickets.data || []), ...(gameTickets.data || []), ...(walletTickets.data || []), ...((cartAvailable && cartTickets) ? (cartTickets.data || []) : [])]
    if (!tickets.length) return { scanned: 0, matched: 0, skipped: true, reason: reviewedCompletedWallet.length ? 'REVIEWED_WALLET_RECONCILED' : 'NO_RECONCILABLE_TICKETS' }
    const oldestTicketMs = Math.min(...tickets.map(row => Date.parse(row.created_at || '')).filter(Number.isFinite))
    const cutoffMs = Number.isFinite(oldestTicketMs) ? Math.max(lookbackCutoffMs, oldestTicketMs - 2 * 60 * 1000) : lookbackCutoffMs
    const cutoff = new Date(cutoffMs).toISOString()

    // Page instead of silently trusting the common PostgREST 1,000-row limit.
    // Order descending to retain the newest window if the explicit 10k safety cap is hit;
    // process that retained set oldest-first below.
    const rows = []
    let rowCapReached = false
    for (let offset = 0; offset < MAX_SMS_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await supabase.from('sms_logs')
        .select('id,client_id,sender,body,received_at')
        .gte('received_at', cutoff)
        .order('received_at', { ascending: false })
        .range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_SMS_ROWS - 1))
      if (error) throw error
      const page = data || []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
      if (offset + PAGE_SIZE >= MAX_SMS_ROWS) { rowCapReached = true; break }
    }

    const clientIds = [...new Set(rows.map(row => row.client_id).filter(Boolean))]
    const clientsById = new Map()
    if (clientIds.length) {
      // Keep the database payload small. Split large .in() lists for predictable PostgREST URLs.
      for (let i = 0; i < clientIds.length; i += 500) {
        const batch = clientIds.slice(i, i + 500)
        const { data: clients, error: clientsError } = await supabase.from('clients')
          .select('id,phone_number').in('id', batch)
        if (clientsError) throw clientsError
        for (const client of clients || []) clientsById.set(String(client.id), client)
      }
    }

    for (const row of rows.slice().reverse()) {
      const parsed = parseSms(row.sender, row.body, row.received_at)
      const network = String(parsed?.network || '').toUpperCase()
      const direction = String(parsed?.direction || '').toUpperCase()
      const validCupPayment = network === 'PAGOMOVIL' && String(parsed?.currency || '').toUpperCase() === 'CUP' &&
        ['TARJETA_TARJETA', 'MONEDERO_TARJETA'].includes(String(parsed?.type || '').toUpperCase())
      const validSaldoPayment = network === 'CUBACEL' && String(parsed?.type || '').toUpperCase() === 'CUBACEL' &&
        ['ENVIADO', 'RECIBIDO'].includes(direction)
      if ((!validCupPayment && !validSaldoPayment) || !Number.isFinite(Number(parsed?.amount))) continue
      scanned += 1
      const client = clientsById.get(String(row.client_id)) || { id: row.client_id }
      let etecsa = null
      let game = null
      let wallet = null
      let cart = null
      let ambiguousCart = false
      if (validCupPayment && cartAvailable) {
        try {
          cart = await processCartTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id })
          ambiguousCart = cart?.ambiguous === true
        } catch (error) {
          console.error('[PaymentReconciler] Cart match failed:', error?.code || error?.message || 'unknown')
          ambiguousCart = true
        }
      }
      if (validCupPayment && !cart && !ambiguousCart) {
        try { etecsa = await processEtecsaTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id }) }
        catch (error) { console.error('[PaymentReconciler] ETECSA match failed:', error?.code || error?.message || 'unknown') }
        try { game = await processGameTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id }) }
        catch (error) { console.error('[PaymentReconciler] Game match failed:', error?.code || error?.message || 'unknown') }
      }
      if (!ambiguousCart && !cart) {
        try { wallet = await processWalletTransfer({ client, parsed, receivedAt: row.received_at, smsLogId: row.id }) }
        catch (error) { console.error('[PaymentReconciler] Wallet match failed:', JSON.stringify({ sms_log_id: row.id, code: error?.code || null, message: String(error?.message || 'unknown').slice(0, 160) })) }
      }
      if (etecsa || game || wallet || (cart && !cart.ambiguous)) matched += 1
    }
    if (rowCapReached) {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), event: 'PAYMENT_RECONCILE_ROW_CAP_REACHED', max_rows: MAX_SMS_ROWS, lookback_hours: LOOKBACK_HOURS, cutoff }))
    }
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'PAYMENT_SMS_RECONCILIATION_COMPLETED', scanned, matched, lookback_hours: LOOKBACK_HOURS, rows_seen: rows.length }))
    return { scanned, matched, rows_seen: rows.length }
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
  // Retry saved Transfermóvil SMS after deploy/restart and then periodically. The wallet
  // credit RPC is transactional/idempotent, so multiple passes cannot double-credit a ticket.
  setTimeout(() => reconcileRecentPaymentSms().catch(() => {}), 12_000)
  setInterval(() => reconcileRecentPaymentSms().catch(() => {}), INTERVAL_MS)
}

module.exports = { reconcileRecentPaymentSms, startPaymentSmsReconciler }
