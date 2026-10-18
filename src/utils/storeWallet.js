'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { getLicenseConfig } = require('./onboarding')
const { normalizePhone, parseSms } = require('./parser')
const { readAllRows } = require('./supabasePagination')
const { normalizePayerPhone, isConfiguredPaymentReceiver } = require('./etecsaPaymentMatching')
const { evaluateOfficialStorePayment, evaluateWalletTopupPayment, isPotentialWalletTopupPayment } = require('./walletPaymentMatching')
const { claimPaymentTransaction } = require('./paymentTransactionClaims')
const { bot, ADMINS } = require('../telegram')

const TOPUP_WINDOW_MS = 30 * 60 * 1000
function configuredPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
const TOPUP_MIN_CUP = Math.max(100, configuredPositiveInteger('STORE_WALLET_MIN_TOPUP_CUP', 100))
const TOPUP_MAX_CUP = Math.max(TOPUP_MIN_CUP, configuredPositiveInteger('STORE_WALLET_MAX_TOPUP_CUP', 1000000))
const nowIso = () => new Date().toISOString()
const receiverClientCache = new Map()
const walletReviewAlerts = new Map()
const PAYMENT_RECONCILE_LOOKBACK_MS = 72 * 60 * 60 * 1000


function alertWalletReviewOnce(key, message) {
  const now = Date.now()
  if (now - (walletReviewAlerts.get(key) || 0) < 15 * 60 * 1000) return
  walletReviewAlerts.set(key, now)
  if (walletReviewAlerts.size > 2000) {
    for (const [entry, ts] of walletReviewAlerts) if (now - ts > 60 * 60 * 1000) walletReviewAlerts.delete(entry)
  }
  Promise.all((ADMINS || []).map(adminId => bot.sendMessage(adminId, message).catch(() => {}))).catch(() => {})
}

async function markTopupForIntegrityReview(topup, { smsLogId, parsed, reason }) {
  const { data: updated, error } = await supabase.from('store_wallet_topups').update({
    payment_review_at: nowIso(),
    payment_review_reason: String(reason || 'WALLET_INTEGRITY_REQUIRES_REVIEW').slice(0, 80),
    payment_review_sms_log_id: smsLogId ? String(smsLogId) : null,
    payment_review_transaction_id: parsed?.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
    updated_at: nowIso(),
  }).eq('id', topup.id).is('payment_review_at', null).select('id,client_id,amount_cup,status').maybeSingle()
  if (error) {
    console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_INTEGRITY_REVIEW_WRITE_FAILED', topup_id: topup.id, code: error.code || null, message: String(error.message || 'unknown').slice(0, 160) }))
    return
  }
  if (!updated) return
  console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_INTEGRITY_REVIEW_REQUIRED', topup_id: updated.id, client_id: updated.client_id, status: updated.status, amount_cup: Number(updated.amount_cup), reason }))
  alertWalletReviewOnce(`integrity:${updated.id}`, `🚨 Revisión de integridad de Wallet · WL-${String(updated.id).replace(/-/g, '').slice(0, 8).toUpperCase()}
Importe: ${updated.amount_cup} CUP
El sistema evitó alterar el saldo porque el libro de movimientos y el balance no coinciden. No pidas al cliente que vuelva a pagar. Revisa el balance y el movimiento del ticket en Supabase.`)
}

function fail(message, status = 400, code = 'WALLET_ERROR') {
  const error = new Error(message); error.status = status; error.code = code; return error
}
function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
function publicTopup(row) {
  if (!row) return null
  return {
    id: row.id,
    ticket: `WL-${String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    type: 'WALLET_TOPUP', status: row.status,
    amount_cup: Number(row.amount_cup), currency: 'CUP',
    created_at: row.created_at, updated_at: row.updated_at,
    payment_deadline_at: row.payment_deadline_at,
    paid_at: row.paid_at || null,
    payment_transaction_id: row.payment_transaction_id || null,
    message: row.payment_review_at ? 'Detectamos un posible pago y lo estamos verificando. No vuelvas a pagar.' :
      row.status === 'COMPLETED' ? 'Saldo añadido a tu Wallet.' :
      row.status === 'WAITING_PAYMENT' ? 'Esperando el pago.' :
      row.status === 'EXPIRED' ? 'El plazo de pago terminó.' : 'Operación cancelada.',
    payment_review_required: Boolean(row.payment_review_at),
    ...(row.status === 'WAITING_PAYMENT' ? { payment: { card: row.destination_card, confirmation_phone: row.confirmation_phone } } : {}),
  }
}

function samePhone(a, b) {
  const left = normalizePayerPhone(a)
  const right = normalizePayerPhone(b)
  return Boolean(left && right && left === right)
}

async function readCompletedTopups(clientId) {
  return readAllRows(() => supabase.from('store_wallet_topups').select('id,amount_cup')
    .eq('client_id', clientId).eq('status', 'COMPLETED').order('created_at', { ascending: true }),
  { pageSize: 500, maxRows: 100_000 })
}

async function findCompletedTopupsMissingLedger(clientId, completedTopups) {
  const byReference = new Map()
  for (let index = 0; index < completedTopups.length; index += 500) {
    const ids = completedTopups.slice(index, index + 500).map(row => String(row.id))
    if (!ids.length) continue
    const { data, error } = await supabase.from('store_wallet_transactions')
      .select('reference_id,amount_cup').eq('client_id', clientId).eq('kind', 'CREDIT')
      .eq('reference_type', 'WALLET_TOPUP').in('reference_id', ids)
    if (error) throw error
    for (const row of data || []) byReference.set(String(row.reference_id), Number(row.amount_cup))
  }
  return completedTopups.filter(row => !byReference.has(String(row.id)) ||
    Math.abs(byReference.get(String(row.id)) - Number(row.amount_cup)) > 0.01)
}

async function ensureWallet(clientId) {
  const { data: existing, error: existingError } = await supabase.from('store_wallets')
    .select('client_id,balance_cup,total_credited_cup,total_spent_cup,updated_at').eq('client_id', clientId).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    const storedBalance = Number(existing.balance_cup)
    if (!Number.isFinite(storedBalance) || storedBalance < 0) {
      throw fail('El saldo guardado no es válido. No mostraremos 0 CUP ni permitiremos gastar hasta revisar la Wallet.', 503, 'WALLET_BALANCE_INVALID')
    }
    return existing
  }

  // If the account row is missing, reconstruct only from the append-only ledger.
  // Never create a zero balance that hides credits already recorded in transactions.
  const movements = await readAllRows(() => supabase.from('store_wallet_transactions')
    .select('kind,amount_cup').eq('client_id', clientId).order('created_at', { ascending: true }), { pageSize: 500, maxRows: 100_000 })
  const totals = movements.reduce((acc, row) => {
    const amount = Number(row.amount_cup) || 0
    if (row.kind === 'CREDIT' || row.kind === 'REFUND') acc.credited += amount
    if (row.kind === 'SPEND') acc.spent += amount
    return acc
  }, { credited: 0, spent: 0 })
  const recoveredBalance = Math.round((totals.credited - totals.spent) * 100) / 100
  if (recoveredBalance < -0.01) throw fail('El registro de movimientos de Wallet no cuadra. No se mostrará un saldo estimado; contacta con soporte.', 503, 'WALLET_LEDGER_INCONSISTENT')

  const completedTopups = await readCompletedTopups(clientId)
  const missingOrWrong = await findCompletedTopupsMissingLedger(clientId, completedTopups)
  if (missingOrWrong.length) {
    console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_INTEGRITY_ALERT', client_id: clientId, completed_topups_missing_or_mismatched_ledger: missingOrWrong.length }))
    throw fail('Hay una recarga marcada como pagada cuyo movimiento no puede verificarse. No se creará un saldo de 0 ni se duplicará dinero; contacta con soporte para reconciliarla.', 503, 'WALLET_TOPUP_LEDGER_MISSING')
  }

  const { error: upsertError } = await supabase.from('store_wallets').upsert({
    client_id: clientId, balance_cup: Math.max(0, recoveredBalance),
    total_credited_cup: totals.credited, total_spent_cup: totals.spent,
  }, { onConflict: 'client_id', ignoreDuplicates: true })
  if (upsertError) throw upsertError
  const { data, error } = await supabase.from('store_wallets')
    .select('client_id,balance_cup,total_credited_cup,total_spent_cup,updated_at').eq('client_id', clientId).single()
  if (error) throw error
  return data
}

async function getWalletSummary(clientId) {
  const wallet = await ensureWallet(clientId)
  const [ledgerResult, topupsResult, allMovements, allCompletedTopups] = await Promise.all([
    supabase.from('store_wallet_transactions').select('id,kind,amount_cup,balance_after_cup,reference_type,reference_id,description,created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    supabase.from('store_wallet_topups').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1000),
    readAllRows(() => supabase.from('store_wallet_transactions').select('kind,amount_cup')
      .eq('client_id', clientId).order('created_at', { ascending: true }), { pageSize: 500, maxRows: 100_000 }),
    readCompletedTopups(clientId),
  ])
  if (ledgerResult.error) throw ledgerResult.error
  if (topupsResult.error) throw topupsResult.error
  const ledgerNetBalance = Math.round(allMovements.reduce((balance, row) => {
    const amount = Number(row.amount_cup) || 0
    if (row.kind === 'CREDIT' || row.kind === 'REFUND') return balance + amount
    if (row.kind === 'SPEND') return balance - amount
    return balance
  }, 0) * 100) / 100
  const balanceMatchesLedger = Math.abs(ledgerNetBalance - Number(wallet.balance_cup)) <= 0.01
  const completedTopupsMissingLedgerRows = await findCompletedTopupsMissingLedger(clientId, allCompletedTopups)
  const completedTopupsMissingLedger = completedTopupsMissingLedgerRows.map(row => String(row.id))
  if (completedTopupsMissingLedger.length) console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_INTEGRITY_ALERT', client_id: clientId, completed_topups_missing_or_mismatched_ledger: completedTopupsMissingLedger.length }))
  if (!balanceMatchesLedger) console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_BALANCE_LEDGER_MISMATCH', client_id: clientId, stored_balance_cup: Number(wallet.balance_cup), ledger_balance_cup: ledgerNetBalance }))
  if (completedTopupsMissingLedger.length || !balanceMatchesLedger) {
    alertWalletReviewOnce(`summary:${clientId}`, `🚨 Integridad de Wallet requiere revisión\nCliente: ${clientId}\nSaldo guardado: ${Number(wallet.balance_cup)} CUP · libro de movimientos: ${ledgerNetBalance} CUP\nTickets completados sin movimiento verificado: ${completedTopupsMissingLedger.length}\nEl sistema no modificó el saldo. Revisa los registros y no pidas al cliente que vuelva a pagar.`)
  }
  return {
    balance_cup: Number(wallet.balance_cup),
    integrity: { healthy: completedTopupsMissingLedger.length === 0 && balanceMatchesLedger, balance_matches_ledger: balanceMatchesLedger, ledger_balance_cup: ledgerNetBalance, completed_topups_missing_or_mismatched_ledger: completedTopupsMissingLedger.length },
    updated_at: wallet.updated_at,
    transactions: (ledgerResult.data || []).map(row => ({
      id: row.id, kind: row.kind, amount_cup: Number(row.amount_cup), balance_after_cup: Number(row.balance_after_cup),
      reference_type: row.reference_type, reference_id: row.reference_id,
      description: row.description || (row.kind === 'CREDIT' ? 'Saldo añadido' : row.kind === 'REFUND' ? 'Devolución a Wallet' : 'Compra en Game Market'),
      created_at: row.created_at,
    })),
    topups: (topupsResult.data || []).slice(0, 15).map(publicTopup),
  }
}

async function assertNoActiveCheckout(clientId) {
  const [etecsa, game, topup] = await Promise.all([
    supabase.from('etecsa_orders').select('id,status,payment_deadline_at').eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').limit(1),
    supabase.from('game_recharge_orders').select('id,status,payment_deadline_at').eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').limit(1),
    supabase.from('store_wallet_topups').select('id,status,payment_deadline_at').eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').limit(1),
  ])
  for (const result of [etecsa, game, topup]) if (result.error) throw result.error
  for (const result of [etecsa, game, topup]) {
    const row = result.data?.[0]
    if (!row) continue
    if (Date.now() > Date.parse(row.payment_deadline_at || '')) {
      const table = result === etecsa ? 'etecsa_orders' : result === game ? 'game_recharge_orders' : 'store_wallet_topups'
      await supabase.from(table).update({ status: 'EXPIRED', updated_at: nowIso() }).eq('id', row.id).eq('status', 'WAITING_PAYMENT')
      continue
    }
    throw fail('Ya tienes un pago pendiente. Complétalo antes de crear otro ticket.', 409, 'CHECKOUT_ACTIVE')
  }
}

async function createTopup(client, body) {
  const amount = Number(body?.amount_cup ?? body?.amount)
  if (!Number.isSafeInteger(amount) || amount < TOPUP_MIN_CUP || amount > TOPUP_MAX_CUP) {
    throw fail(`El importe debe estar entre ${TOPUP_MIN_CUP} y ${TOPUP_MAX_CUP} CUP.`, 400, 'INVALID_TOPUP_AMOUNT')
  }
  const payerPhone = (normalizePayerPhone(body?.payer_phone) || '').replace(/\D/g, '')
  if (!/^5\d{7}$/.test(payerPhone)) throw fail('Introduce el móvil desde el que realizarás la transferencia.', 400, 'INVALID_PAYER_PHONE')
  const config = getLicenseConfig()
  if (!config.configured || config.currency !== 'CUP') throw fail('El método de pago está temporalmente no disponible.', 503, 'PAYMENT_CONFIG_MISSING')
  await assertNoActiveCheckout(client.id)
  const createdAt = new Date()
  const deadline = new Date(createdAt.getTime() + TOPUP_WINDOW_MS)
  const { data, error } = await supabase.from('store_wallet_topups').insert({
    client_id: client.id, amount_cup: amount, payer_phone: payerPhone,
    destination_card: config.paymentCard, confirmation_phone: config.paymentPhone,
    status: 'WAITING_PAYMENT', created_at: createdAt.toISOString(), updated_at: createdAt.toISOString(),
    payment_deadline_at: deadline.toISOString(),
  }).select('*').single()
  if (error) {
    if (error.code === '23505') throw fail('Ya tienes una recarga de Wallet pendiente.', 409, 'TOPUP_ACTIVE')
    throw error
  }
  console.log(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_TOPUP_CREATED', topup_id: data.id, client_id: client.id, amount_cup: amount }))
  return publicTopup(data)
}

async function getTopup(clientId, topupId) {
  const { data, error } = await supabase.from('store_wallet_topups').select('*').eq('id', topupId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!data) return null
  if (data.status === 'WAITING_PAYMENT' && Date.now() > Date.parse(data.payment_deadline_at || '')) {
    const { data: expired, error: expireError } = await supabase.from('store_wallet_topups').update({ status: 'EXPIRED', updated_at: nowIso() })
      .eq('id', data.id).eq('status', 'WAITING_PAYMENT').select('*').maybeSingle()
    if (expireError) throw expireError
    if (expired) return publicTopup(expired)
    // A payment processor may complete the ticket between our initial read and expiry update.
    // Never return a made-up EXPIRED state when the conditional update lost a race.
    const { data: latest, error: latestError } = await supabase.from('store_wallet_topups').select('*')
      .eq('id', data.id).eq('client_id', clientId).maybeSingle()
    if (latestError) throw latestError
    return publicTopup(latest || data)
  }
  return publicTopup(data)
}

// Manual refresh reprocesses already-synchronized Transfermóvil SMS for this ticket.
// The same strict matcher and atomic credit RPC are used; the endpoint never creates payment evidence.
async function refreshTopupStatus(clientId, topupId) {
  const { data: topup, error: topupError } = await supabase.from('store_wallet_topups').select('*')
    .eq('id', topupId).eq('client_id', clientId).maybeSingle()
  if (topupError) throw topupError
  if (!topup) return null

  let refreshed = false
  let scannedSms = 0
  if (topup.status === 'COMPLETED') {
    try {
      const { error: repairError } = await supabase.rpc('store_wallet_credit_topup', {
        p_topup_id: topup.id,
        p_payment_transaction_id: topup.payment_transaction_id || topup.payment_review_transaction_id || null,
        p_payment_sms_log_id: topup.payment_sms_log_id || topup.payment_review_sms_log_id || null,
        p_payment_transaction_at: topup.payment_transaction_at || null,
      })
      if (repairError) {
        const message = String(repairError.message || '')
        if (/(WALLET_BALANCE_LEDGER_MISMATCH|TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED|WALLET_TOPUP_LEDGER_AMOUNT_MISMATCH|WALLET_TOPUP_PARTIAL_STATE_REVIEW_REQUIRED)/.test(message)) {
          await markTopupForIntegrityReview(topup, { smsLogId: topup.payment_sms_log_id, parsed: { transaction_id: topup.payment_transaction_id }, reason: message })
        } else throw repairError
      } else refreshed = true
    } catch (repairError) {
      const message = String(repairError?.message || '')
      console.error(JSON.stringify({ ts: nowIso(), event: 'WALLET_COMPLETED_TOPUP_REPAIR_FAILED', topup_id: topup.id, code: repairError?.code || null, message: message.slice(0, 160) }))
      if (!/(WALLET_BALANCE_LEDGER_MISMATCH|TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED|WALLET_TOPUP_LEDGER_AMOUNT_MISMATCH|WALLET_TOPUP_PARTIAL_STATE_REVIEW_REQUIRED)/.test(message)) throw repairError
    }
  }
  if (['WAITING_PAYMENT', 'EXPIRED'].includes(topup.status)) {
    const now = Date.now()
    const createdMs = Date.parse(topup.created_at || '')
    const sinceMs = Math.max(now - PAYMENT_RECONCILE_LOOKBACK_MS, (Number.isFinite(createdMs) ? createdMs : now) - 2 * 60 * 1000)
    const since = new Date(sinceMs).toISOString()
    const cacheKey = normalizePayerPhone(topup.confirmation_phone)
    let receiverClients = receiverClientCache.get(cacheKey)
    if (!receiverClients || receiverClients.expiresAt <= now) {
      const exact = await supabase.from('clients').select('id,phone_number').eq('phone_number', topup.confirmation_phone).limit(100)
      if (exact.error) throw exact.error
      let found = (exact.data || []).filter(row => samePhone(row.phone_number, topup.confirmation_phone))
      if (!found.length) {
        found = []
        for (let offset = 0; offset < 100_000; offset += 500) {
          const { data, error } = await supabase.from('clients').select('id,phone_number').order('id', { ascending: true }).range(offset, offset + 499)
          if (error) throw error
          for (const row of data || []) if (samePhone(row.phone_number, topup.confirmation_phone)) found.push(row)
          if (!data || data.length < 500) break
        }
      }
      receiverClients = { rows: found, expiresAt: now + 60_000 }
      receiverClientCache.set(cacheKey, receiverClients)
      if (receiverClientCache.size > 500) {
        for (const [key, value] of receiverClientCache) if (value.expiresAt <= now) receiverClientCache.delete(key)
      }
    }

    const { data: owner, error: ownerError } = await supabase.from('clients').select('id,phone_number').eq('id', clientId).maybeSingle()
    if (ownerError) throw ownerError
    const clientById = new Map()
    if (owner) clientById.set(String(owner.id), owner)
    for (const row of receiverClients.rows) clientById.set(String(row.id), row)
    const ids = [...clientById.keys()]
    if (ids.length) {
      const rows = await readAllRows(() => supabase.from('sms_logs').select('id,client_id,sender,body,received_at')
        .in('client_id', ids).gte('received_at', since).order('received_at', { ascending: true }), { pageSize: 500, maxRows: 100_000 })
      for (const row of rows) {
        const parsed = parseSms(row.sender, row.body, row.received_at)
        if (String(parsed?.network || '').toUpperCase() !== 'PAGOMOVIL' ||
            String(parsed?.currency || '').toUpperCase() !== 'CUP' ||
            !['ENVIADO', 'RECIBIDO'].includes(String(parsed?.direction || '').toUpperCase()) ||
            !['TARJETA_TARJETA', 'MONEDERO_TARJETA'].includes(String(parsed?.type || '').toUpperCase()) ||
            !Number.isFinite(Number(parsed?.amount))) continue
        scannedSms++
        try {
          const result = await processIncomingTransfer({
            client: clientById.get(String(row.client_id)) || { id: row.client_id },
            parsed, receivedAt: row.received_at, smsLogId: row.id,
          })
          if (result?.topup_id === topupId) refreshed = true
        } catch (error) {
          console.error(JSON.stringify({ ts: nowIso(), event: 'WALLET_MANUAL_REFRESH_RETRY_FAILED', topup_id: topupId, sms_log_id: row.id, code: error?.code || null, message: String(error?.message || 'unknown').slice(0, 160) }))
        }
      }
    }
  }
  const currentTopup = await getTopup(clientId, topupId)
  const wallet = await getWalletSummary(clientId)
  console.log(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_TOPUP_REFRESHED', topup_id: topupId, client_id: clientId, scanned_sms: scannedSms, refreshed, status: currentTopup?.status || null, balance_cup: wallet.balance_cup }))
  return { topup: currentTopup, wallet, refreshed, scanned_sms: scannedSms }
}

async function findMatchingTopups({ client, parsed, receivedAt }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  const isDestinationReceipt = direction === 'RECIBIDO'
  const cutoff = new Date(Date.now() - PAYMENT_RECONCILE_LOOKBACK_MS).toISOString()
  const buildQuery = () => {
    let query = supabase.from('store_wallet_topups').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED'])
      .gte('created_at', cutoff).order('created_at', { ascending: false })
    if (!isDestinationReceipt) query = query.eq('client_id', client.id)
    return query
  }
  const data = await readAllRows(buildQuery, { pageSize: 500, maxRows: 100_000 })
  const matches = []
  for (const topup of data) {
    if (isDestinationReceipt && !isConfiguredPaymentReceiver(client, topup)) continue
    if (topup.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const evaluation = evaluateWalletTopupPayment(parsed, topup, receivedAt)
    if (evaluation.matched) matches.push({ topup, evaluation })
    else if (topup.status === 'WAITING_PAYMENT' && Date.now() > Date.parse(topup.payment_deadline_at || '') &&
      Number(parsed?.amount) === Number(topup.amount_cup) && parsed?.receiver_account) {
      const { error: expireError } = await supabase.from('store_wallet_topups').update({ status: 'EXPIRED', updated_at: nowIso() })
        .eq('id', topup.id).eq('status', 'WAITING_PAYMENT')
      if (expireError) throw expireError
    }
  }
  return matches
}

async function markPotentialTopupsForReview({ client, parsed, receivedAt, smsLogId, reason }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  if (!['RECIBIDO', 'ENVIADO'].includes(direction) ||
      String(parsed?.network || '').toUpperCase() !== 'PAGOMOVIL' ||
      String(parsed?.currency || '').toUpperCase() !== 'CUP' ||
      !Number.isFinite(Number(parsed?.amount))) return []
  const cutoff = new Date(Date.now() - PAYMENT_RECONCILE_LOOKBACK_MS).toISOString()
  const candidates = await readAllRows(() => {
    let query = supabase.from('store_wallet_topups').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED'])
      .gte('created_at', cutoff).order('created_at', { ascending: false })
    if (direction === 'ENVIADO') query = query.eq('client_id', client.id)
    return query
  }, { pageSize: 500, maxRows: 100_000 })
  const flagged = []
  for (const topup of candidates) {
    if (topup.payment_review_at) continue
    if (direction === 'RECIBIDO' && !isConfiguredPaymentReceiver(client, topup)) continue
    if (topup.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const strictOrSafeMatch = evaluateWalletTopupPayment(parsed, topup, receivedAt).matched
    if (!strictOrSafeMatch && !isPotentialWalletTopupPayment(parsed, topup, receivedAt)) continue
    const patch = {
      payment_review_at: nowIso(),
      payment_review_reason: String(reason || 'PAYMENT_DETAILS_REQUIRE_REVIEW').slice(0, 80),
      payment_review_sms_log_id: smsLogId ? String(smsLogId) : null,
      payment_review_transaction_id: parsed?.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
      updated_at: nowIso(),
    }
    const { data: updated, error: updateError } = await supabase.from('store_wallet_topups').update(patch)
      .eq('id', topup.id).in('status', ['WAITING_PAYMENT', 'EXPIRED']).is('payment_review_at', null)
      .select('id,client_id,amount_cup').maybeSingle()
    if (updateError) throw updateError
    if (!updated) continue
    flagged.push(updated)
    console.warn(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_PAYMENT_REVIEW_REQUIRED', topup_id: updated.id, client_id: updated.client_id, amount_cup: Number(updated.amount_cup), sms_log_id: smsLogId || null, reason: patch.payment_review_reason }))
    await Promise.all((ADMINS || []).map(adminId => bot.sendMessage(adminId,
      `⚠️ Pago de Wallet requiere revisión · WL-${String(updated.id).replace(/-/g, '').slice(0, 8).toUpperCase()}\nImporte: ${updated.amount_cup} CUP\nEl SMS se recibió, pero falta confirmar un dato. No se acredita automáticamente y el cliente verá el aviso; revisa la transferencia antes de aprobar.`
    ).catch(() => {})))
  }
  return flagged
}

async function processIncomingTransfer({ client, parsed, receivedAt, smsLogId }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  if (!['RECIBIDO', 'ENVIADO'].includes(direction)) return null
  const matches = await findMatchingTopups({ client, parsed, receivedAt })
  if (matches.length !== 1) {
    const reason = matches.length > 1 ? 'MULTIPLE_MATCHING_TICKETS' : 'PAYER_PHONE_OR_RECEIPT_DETAILS_UNVERIFIED'
    if (matches.length > 1) console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'WALLET', matching_ticket_count: matches.length, sms_log_id: smsLogId || null }))
    try { await markPotentialTopupsForReview({ client, parsed, receivedAt, smsLogId, reason }) }
    catch (reviewError) { console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_REVIEW_RECORD_FAILED', sms_log_id: smsLogId || null, code: reviewError.code || null, message: String(reviewError.message || 'unknown').slice(0, 180) })) }
    if (matches.length === 0 && String(parsed?.direction || '').toUpperCase() === 'RECIBIDO') {
      console.warn(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_PAYMENT_NO_MATCH', sms_log_id: smsLogId || null, amount_cup: Number(parsed?.amount), has_transaction_id: Boolean(parsed?.transaction_id), has_sender_phone: Boolean(parsed?.sender_phone), has_receiver_account: Boolean(parsed?.receiver_account) }))
    }
    return null
  }
  const { topup, evaluation } = matches[0]
  // Cross-check both official store services before crediting: one bank transfer
  // can satisfy only one ticket across wallet, game, and ETECSA.
  const cutoff = new Date(Date.now() - PAYMENT_RECONCILE_LOOKBACK_MS).toISOString()
  const [etecsaRows, gameRows] = await Promise.all([
    readAllRows(() => supabase.from('etecsa_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }), { pageSize: 500, maxRows: 100_000 }),
    readAllRows(() => supabase.from('game_recharge_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }), { pageSize: 500, maxRows: 100_000 }),
  ])
  const inTransferScope = row => direction === 'RECIBIDO'
    ? isConfiguredPaymentReceiver(client, row)
    : String(row.client_id) === String(client.id)
  const overlap = [
    ...etecsaRows.filter(row => inTransferScope(row) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, row, receivedAt).matched),
    ...gameRows.filter(row => inTransferScope(row) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, row, receivedAt).matched),
  ]
  if (overlap.length) {
    console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'WALLET', overlapping_official_order_count: overlap.length, topup_id: topup.id, sms_log_id: smsLogId || null }))
    try {
      await markPotentialTopupsForReview({ client, parsed, receivedAt, smsLogId, reason: 'PAYMENT_MATCH_OVERLAPS_OTHER_STORE' })
    } catch (reviewError) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_REVIEW_RECORD_FAILED', topup_id: topup.id, sms_log_id: smsLogId || null, code: reviewError.code || null }))
    }
    return null
  }
  if (parsed?.transaction_id) {
    const txn = String(parsed.transaction_id).slice(0, 120)
    const [etecsaDuplicate, gameDuplicate, walletDuplicate] = await Promise.all([
      supabase.from('etecsa_orders').select('id').eq('payment_transaction_id', txn).maybeSingle(),
      supabase.from('game_recharge_orders').select('id').eq('payment_transaction_id', txn).maybeSingle(),
      supabase.from('store_wallet_topups').select('id').eq('payment_transaction_id', txn).maybeSingle(),
    ])
    for (const r of [etecsaDuplicate, gameDuplicate, walletDuplicate]) if (r.error) throw r.error
    if (etecsaDuplicate.data || gameDuplicate.data || (walletDuplicate.data && walletDuplicate.data.id !== topup.id)) {
      console.warn(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_DUPLICATE_BANK_TRANSACTION', topup_id: topup.id, sms_log_id: smsLogId || null }))
      try {
        await markPotentialTopupsForReview({ client, parsed, receivedAt, smsLogId, reason: 'PAYMENT_ALREADY_ATTACHED_TO_ANOTHER_ORDER' })
      } catch (reviewError) {
        console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_REVIEW_RECORD_FAILED', topup_id: topup.id, sms_log_id: smsLogId || null, code: reviewError.code || null }))
      }
      return null
    }
  }
  const claimed = await claimPaymentTransaction({ transactionId: parsed?.transaction_id, smsLogId, clientId: topup.client_id, source: 'WALLET_TOPUP', orderId: topup.id })
  if (!claimed) {
    // Never credit a receipt already claimed by another ticket, but never leave a real
    // customer-facing ticket silently waiting either. Make the conflict visible for review.
    try {
      await markPotentialTopupsForReview({ client, parsed, receivedAt, smsLogId, reason: 'PAYMENT_TRANSACTION_ALREADY_CLAIMED' })
    } catch (reviewError) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_REVIEW_RECORD_FAILED', topup_id: topup.id, sms_log_id: smsLogId || null, code: reviewError.code || null }))
    }
    return null
  }
  const { data, error } = await supabase.rpc('store_wallet_credit_topup', {
    p_topup_id: topup.id,
    p_payment_transaction_id: parsed?.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
    p_payment_sms_log_id: smsLogId ? String(smsLogId) : null,
    p_payment_transaction_at: evaluation.transaction_at,
  })
  if (error) {
    const errorText = String(error.message || '')
    console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_CREDIT_RPC_FAILED', topup_id: topup.id, client_id: topup.client_id, sms_log_id: smsLogId || null, transaction_id: parsed?.transaction_id || null, code: error.code || null, message: errorText.slice(0, 180) }))
    if (error.code === '23505') return null
    if (/(WALLET_BALANCE_LEDGER_MISMATCH|TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED|WALLET_TOPUP_LEDGER_AMOUNT_MISMATCH|WALLET_TOPUP_PARTIAL_STATE_REVIEW_REQUIRED)/.test(errorText)) {
      try { await markTopupForIntegrityReview(topup, { smsLogId, parsed, reason: errorText }) }
      catch (reviewError) { console.error(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_INTEGRITY_REVIEW_EXCEPTION', topup_id: topup.id, message: String(reviewError?.message || 'unknown').slice(0, 160) })) }
    }
    throw error
  }
  if (data?.already_processed) return { topup_id: topup.id, status: 'COMPLETED', duplicate: true }
  console.log(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_TOPUP_PAID', topup_id: topup.id, client_id: topup.client_id, amount_cup: Number(topup.amount_cup), transaction_id: parsed?.transaction_id || null }))
  await Promise.all((ADMINS || []).map(adminId => bot.sendMessage(adminId,
    `💰 Wallet recargada · WL-${String(topup.id).replace(/-/g, '').slice(0, 8).toUpperCase()}\nImporte: ${topup.amount_cup} CUP\nEl saldo quedó disponible para compras en Game Market.`
  ).catch(() => {})))
  return { topup_id: topup.id, status: 'COMPLETED', amount_cup: Number(topup.amount_cup) }
}

function shortFailure(status, reason, paymentReviewRequired = false) {
  if (paymentReviewRequired) return 'Detectamos un posible pago y lo estamos verificando. No vuelvas a pagar.'
  if (status === 'COMPLETED') return 'Entregado correctamente.'
  if (status === 'PROCESSING' || status === 'SUBMITTING_TO_PROVIDER') return 'Pago confirmado; pedido en proceso.'
  if (status === 'WAITING_PAYMENT') return 'Esperando el pago.'
  if (status === 'EXPIRED') return 'El plazo de pago terminó.'
  if (status === 'CANCELED') return 'Pedido cancelado.'
  if (status === 'REFUND_REQUIRED') return 'La entrega falló. Tu caso requiere resolución; no vuelvas a pagar.'
  if (status === 'FULFILLMENT_REVIEW') return 'El pedido necesita revisión. No vuelvas a pagar.'
  if (status === 'PAYMENT_RECEIVED_WAITING_DETAILS') return 'Pago recibido; faltan datos para entregar.'
  return 'Pedido pendiente de actualización.'
}

async function getStoreStatusSnapshot(clientId) {
  // The status feed is deliberately separate from purchase history. Query all active
  // tickets (paged) plus every recently changed ticket so an old, still-pending payment
  // cannot vanish just because the customer placed many newer orders. Never return a
  // silently truncated list: readAllRows throws when its safety cap is exceeded.
  // Wallet top-ups are read across the full account history so a phone that was offline
  // for longer still learns that its balance was credited.
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const queryRows = (table, columns, activeFilter, { includeAll = false } = {}) => Promise.all([
    readAllRows(() => {
      const base = supabase.from(table).select(columns).eq('client_id', clientId)
      return (includeAll ? base : activeFilter(base)).order('updated_at', { ascending: false })
    }, { pageSize: 500, maxRows: 10000 }),
    includeAll ? Promise.resolve([]) : readAllRows(() => supabase.from(table).select(columns).eq('client_id', clientId)
      .gte('updated_at', recentCutoff).order('updated_at', { ascending: false }), { pageSize: 500, maxRows: 10000 }),
  ]).then(([active, recent]) => {
    const byId = new Map()
    for (const row of [...active, ...recent]) byId.set(row.id, row)
    return [...byId.values()]
  })
  const [etecsaRows, gameRows, topupRows] = await Promise.all([
    queryRows('etecsa_orders', 'id,offer_name,price_label,payment_amount,status,created_at,updated_at,paid_at,completed_at,failure_reason', q => q.in('status', ['WAITING_PAYMENT', 'PAYMENT_RECEIVED_WAITING_DETAILS', 'PROCESSING', 'SUBMITTING_TO_SOKY', 'SUBMITTING_TO_PROVIDER', 'FULFILLMENT_REVIEW', 'REFUND_REQUIRED'])),
    queryRows('game_recharge_orders', 'id,game_name,offer_title,payment_amount,status,created_at,updated_at,paid_at,completed_at,failure_reason,payment_source', q => q.in('status', ['WAITING_PAYMENT', 'PAYMENT_RECEIVED_WAITING_DETAILS', 'PROCESSING', 'SUBMITTING_TO_PROVIDER', 'SUBMITTING_TO_SOKY', 'FULFILLMENT_REVIEW', 'REFUND_REQUIRED'])),
    queryRows('store_wallet_topups', 'id,amount_cup,status,created_at,updated_at,paid_at,payment_deadline_at,payment_review_at,payment_review_reason', q => q.or('status.eq.WAITING_PAYMENT,payment_review_at.not.is.null'), { includeAll: true }),
  ])
  const etecsa = { data: etecsaRows }
  const games = { data: gameRows }
  const topups = { data: topupRows }
  const entries = []
  for (const row of etecsa.data || []) entries.push({
    id: row.id, ticket_id: row.id, receipt_code: `SO-ET-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`,
    source: 'ETECSA', title: `${row.offer_name}${row.price_label ? ` · ${row.price_label}` : ''}`,
    amount_cup: Number(row.payment_amount), currency: 'CUP', status: row.status,
    message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at,
    paid_at: row.paid_at, completed_at: row.completed_at,
  })
  for (const row of games.data || []) entries.push({
    id: row.id, ticket_id: row.id, receipt_code: `SO-GM-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`,
    source: 'GAMEMARKET', title: `${row.game_name} · ${row.offer_title}`,
    amount_cup: Number(row.payment_amount), currency: 'CUP', status: row.status,
    message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at,
    paid_at: row.paid_at, completed_at: row.completed_at, payment_source: row.payment_source || 'TRANSFERMOVIL',
  })
  for (const row of topups.data || []) entries.push({
    id: row.id, ticket_id: row.id, receipt_code: `SO-WL-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`,
    source: 'WALLET', title: 'Añadir fondos a Wallet', amount_cup: Number(row.amount_cup), currency: 'CUP',
    status: row.status, message: shortFailure(row.status, null, Boolean(row.payment_review_at)),
    payment_review_required: Boolean(row.payment_review_at), created_at: row.created_at, updated_at: row.updated_at,
    paid_at: row.paid_at, payment_deadline_at: row.payment_deadline_at,
  })
  entries.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))
  return entries
}

async function getStoreHistory(clientId) {
  const [etecsa, games, topups, ledger] = await Promise.all([
    supabase.from('etecsa_orders').select('id,offer_name,price_label,payment_amount,price_basis,status,created_at,updated_at,paid_at,completed_at,failure_reason').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('game_recharge_orders').select('id,game_name,offer_title,payment_amount,price_basis,status,payment_source,created_at,updated_at,paid_at,completed_at,failure_reason').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('store_wallet_topups').select('id,amount_cup,status,created_at,updated_at,paid_at,payment_deadline_at,payment_review_at,payment_review_reason').eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    supabase.from('store_wallet_transactions').select('id,kind,amount_cup,reference_type,reference_id,description,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100),
  ])
  for (const r of [etecsa, games, topups, ledger]) if (r.error) throw r.error
  const entries = []
  for (const row of etecsa.data || []) entries.push({ id: row.id, ticket_id: row.id, receipt_code: `SO-ET-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`, source: 'ETECSA', title: `${row.offer_name}${row.price_label ? ` · ${row.price_label}` : ''}`, amount_cup: Number(row.payment_amount), currency: row.price_basis === 'SALDO' ? 'SALDO' : 'CUP', status: row.status, message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, completed_at: row.completed_at })
  for (const row of games.data || []) entries.push({ id: row.id, ticket_id: row.id, receipt_code: `SO-GM-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`, source: 'GAMEMARKET', title: `${row.game_name} · ${row.offer_title}`, amount_cup: Number(row.payment_amount), currency: row.price_basis === 'SALDO' ? 'SALDO' : 'CUP', status: row.status, message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, completed_at: row.completed_at, payment_source: row.payment_source || 'TRANSFERMOVIL' })
  // Paid top-ups are represented by their CREDIT ledger movement to avoid double-counting.
  for (const row of topups.data || []) {
    if (row.status === 'COMPLETED') continue
    entries.push({ id: row.id, ticket_id: row.id, receipt_code: `SO-WL-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`, source: 'WALLET', title: 'Añadir fondos a Wallet', amount_cup: Number(row.amount_cup), currency: 'CUP', status: row.status, message: shortFailure(row.status, null, Boolean(row.payment_review_at)), payment_review_required: Boolean(row.payment_review_at), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, payment_deadline_at: row.payment_deadline_at })
  }
  for (const row of ledger.data || []) {
    // Wallet-funded Game Market purchases are already present in the order history.
    if (row.kind === 'SPEND' && row.reference_type === 'GAME_RECHARGE') continue
    entries.push({ id: row.id, ticket_id: row.reference_type === 'WALLET_TOPUP' ? row.reference_id : row.id, receipt_code: row.reference_type === 'WALLET_TOPUP' && row.reference_id ? `SO-WL-${String(row.reference_id).replace(/-/g, '').slice(0, 10).toUpperCase()}` : `SO-MV-${String(row.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`, reference_type: row.reference_type, reference_id: row.reference_id, source: 'WALLET_MOVEMENT', title: row.description || (row.kind === 'CREDIT' ? 'Fondos añadidos' : row.kind === 'REFUND' ? 'Devolución a Wallet' : 'Movimiento de Wallet'), amount_cup: Number(row.amount_cup), currency: 'CUP', status: row.kind, message: row.kind === 'SPEND' ? 'Compra descontada del saldo.' : row.kind === 'REFUND' ? 'Importe devuelto al saldo.' : 'Saldo añadido a Wallet.', created_at: row.created_at, updated_at: row.created_at })
  }
  entries.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))
  return entries.slice(0, 120)
}

module.exports = {
  getWalletSummary, createTopup, getTopup, refreshTopupStatus, findMatchingTopups,
  processIncomingTransfer, getStoreHistory, getStoreStatusSnapshot, publicTopup, markPotentialTopupsForReview,
}
