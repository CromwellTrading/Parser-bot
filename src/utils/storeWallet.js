'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { getLicenseConfig } = require('./onboarding')
const { normalizePhone } = require('./parser')
const { normalizePayerPhone, isConfiguredPaymentReceiver, evaluateEtecsaPayment } = require('./etecsaPaymentMatching')
const { claimPaymentTransaction } = require('./paymentTransactionClaims')
const { bot, ADMINS } = require('../telegram')

const TOPUP_WINDOW_MS = 30 * 60 * 1000
const TOPUP_MIN_CUP = Math.max(100, Number(process.env.STORE_WALLET_MIN_TOPUP_CUP || 100))
const TOPUP_MAX_CUP = Math.max(TOPUP_MIN_CUP, Number(process.env.STORE_WALLET_MAX_TOPUP_CUP || 1000000))
const nowIso = () => new Date().toISOString()

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
    message: row.status === 'COMPLETED' ? 'Saldo añadido a tu Wallet.' :
      row.status === 'WAITING_PAYMENT' ? 'Esperando el pago.' :
      row.status === 'EXPIRED' ? 'El plazo de pago terminó.' : 'Operación cancelada.',
    ...(row.status === 'WAITING_PAYMENT' ? { payment: { card: row.destination_card, confirmation_phone: row.confirmation_phone } } : {}),
  }
}

async function ensureWallet(clientId) {
  const { error: upsertError } = await supabase.from('store_wallets')
    .upsert({ client_id: clientId }, { onConflict: 'client_id', ignoreDuplicates: true })
  if (upsertError) throw upsertError
  const { data, error } = await supabase.from('store_wallets').select('client_id,balance_cup,updated_at').eq('client_id', clientId).single()
  if (error) throw error
  return data
}

async function getWalletSummary(clientId) {
  const wallet = await ensureWallet(clientId)
  const [ledgerResult, topupsResult] = await Promise.all([
    supabase.from('store_wallet_transactions').select('id,kind,amount_cup,balance_after_cup,reference_type,reference_id,description,created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    supabase.from('store_wallet_topups').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(15),
  ])
  if (ledgerResult.error) throw ledgerResult.error
  if (topupsResult.error) throw topupsResult.error
  return {
    balance_cup: Number(wallet.balance_cup || 0),
    updated_at: wallet.updated_at,
    transactions: (ledgerResult.data || []).map(row => ({
      id: row.id, kind: row.kind, amount_cup: Number(row.amount_cup), balance_after_cup: Number(row.balance_after_cup),
      reference_type: row.reference_type, reference_id: row.reference_id,
      description: row.description || (row.kind === 'CREDIT' ? 'Saldo añadido' : row.kind === 'REFUND' ? 'Devolución a Wallet' : 'Compra en Game Market'),
      created_at: row.created_at,
    })),
    topups: (topupsResult.data || []).map(publicTopup),
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
    return publicTopup(expired || { ...data, status: 'EXPIRED' })
  }
  return publicTopup(data)
}

async function findMatchingTopups({ client, parsed, receivedAt }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  const isDestinationReceipt = direction === 'RECIBIDO'
  let query = supabase.from('store_wallet_topups').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED'])
    .order('created_at', { ascending: false }).limit(isDestinationReceipt ? 500 : 12)
  if (!isDestinationReceipt) query = query.eq('client_id', client.id)
  const { data, error } = await query
  if (error) throw error
  const matches = []
  for (const topup of data || []) {
    if (isDestinationReceipt && !isConfiguredPaymentReceiver(client, topup)) continue
    if (topup.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const evaluation = evaluateEtecsaPayment(parsed, topup, receivedAt)
    if (evaluation.matched) matches.push({ topup, evaluation })
    else if (topup.status === 'WAITING_PAYMENT' && Date.now() > Date.parse(topup.payment_deadline_at || '') &&
      Number(parsed?.amount) === Number(topup.amount_cup) && parsed?.receiver_account) {
      await supabase.from('store_wallet_topups').update({ status: 'EXPIRED', updated_at: nowIso() })
        .eq('id', topup.id).eq('status', 'WAITING_PAYMENT')
    }
  }
  return matches
}

async function processIncomingTransfer({ client, parsed, receivedAt, smsLogId }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  if (!['RECIBIDO', 'ENVIADO'].includes(direction)) return null
  const matches = await findMatchingTopups({ client, parsed, receivedAt })
  if (matches.length !== 1) {
    if (matches.length > 1) console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'WALLET', matching_ticket_count: matches.length }))
    return null
  }
  const { topup, evaluation } = matches[0]
  // Cross-check both official store services before crediting: one bank transfer
  // can satisfy only one ticket across wallet, game, and ETECSA.
  const [etecsaRows, gameRows] = await Promise.all([
    supabase.from('etecsa_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).order('created_at', { ascending: false }).limit(500),
    supabase.from('game_recharge_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).order('created_at', { ascending: false }).limit(500),
  ])
  if (etecsaRows.error) throw etecsaRows.error
  if (gameRows.error) throw gameRows.error
  const overlap = [
    ...(etecsaRows.data || []).filter(row => isConfiguredPaymentReceiver(client, row) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateEtecsaPayment(parsed, row, receivedAt).matched),
    ...(gameRows.data || []).filter(row => isConfiguredPaymentReceiver(client, row) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateEtecsaPayment(parsed, row, receivedAt).matched),
  ]
  if (overlap.length) {
    console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'WALLET', overlapping_official_order_count: overlap.length }))
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
    if (etecsaDuplicate.data || gameDuplicate.data || (walletDuplicate.data && walletDuplicate.data.id !== topup.id)) return null
  }
  if (parsed?.transaction_id) {
    const claimed = await claimPaymentTransaction({ transactionId: parsed.transaction_id, clientId: topup.client_id, source: 'WALLET_TOPUP', orderId: topup.id })
    if (!claimed) return null
  }
  const { data, error } = await supabase.rpc('store_wallet_credit_topup', {
    p_topup_id: topup.id,
    p_payment_transaction_id: parsed?.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
    p_payment_sms_log_id: smsLogId ? String(smsLogId) : null,
    p_payment_transaction_at: evaluation.transaction_at,
  })
  if (error) {
    if (error.code === '23505') return null
    throw error
  }
  if (data?.already_processed) return { topup_id: topup.id, status: 'COMPLETED', duplicate: true }
  console.log(JSON.stringify({ ts: nowIso(), event: 'STORE_WALLET_TOPUP_PAID', topup_id: topup.id, client_id: topup.client_id, amount_cup: Number(topup.amount_cup), transaction_id: parsed?.transaction_id || null }))
  await Promise.all((ADMINS || []).map(adminId => bot.sendMessage(adminId,
    `💰 Wallet recargada · WL-${String(topup.id).replace(/-/g, '').slice(0, 8).toUpperCase()}\nImporte: ${topup.amount_cup} CUP\nEl saldo quedó disponible para compras en Game Market.`
  ).catch(() => {})))
  return { topup_id: topup.id, status: 'COMPLETED', amount_cup: Number(topup.amount_cup) }
}

function shortFailure(status, reason) {
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

async function getStoreHistory(clientId) {
  const [etecsa, games, topups, ledger] = await Promise.all([
    supabase.from('etecsa_orders').select('id,offer_name,price_label,payment_amount,price_basis,status,created_at,updated_at,paid_at,completed_at,failure_reason').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('game_recharge_orders').select('id,game_name,offer_title,payment_amount,price_basis,status,payment_source,created_at,updated_at,paid_at,completed_at,failure_reason').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('store_wallet_topups').select('id,amount_cup,status,created_at,updated_at,paid_at,payment_deadline_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    supabase.from('store_wallet_transactions').select('id,kind,amount_cup,reference_type,reference_id,description,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100),
  ])
  for (const r of [etecsa, games, topups, ledger]) if (r.error) throw r.error
  const entries = []
  for (const row of etecsa.data || []) entries.push({ id: row.id, source: 'ETECSA', title: `${row.offer_name}${row.price_label ? ` · ${row.price_label}` : ''}`, amount_cup: Number(row.payment_amount), currency: row.price_basis === 'SALDO' ? 'SALDO' : 'CUP', status: row.status, message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, completed_at: row.completed_at })
  for (const row of games.data || []) entries.push({ id: row.id, source: 'GAMEMARKET', title: `${row.game_name} · ${row.offer_title}`, amount_cup: Number(row.payment_amount), currency: row.price_basis === 'SALDO' ? 'SALDO' : 'CUP', status: row.status, message: shortFailure(row.status, row.failure_reason), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, completed_at: row.completed_at, payment_source: row.payment_source || 'TRANSFERMOVIL' })
  // Paid top-ups are represented by their CREDIT ledger movement to avoid double-counting.
  for (const row of topups.data || []) {
    if (row.status === 'COMPLETED') continue
    entries.push({ id: row.id, source: 'WALLET', title: 'Añadir fondos a Wallet', amount_cup: Number(row.amount_cup), currency: 'CUP', status: row.status, message: shortFailure(row.status), created_at: row.created_at, updated_at: row.updated_at, paid_at: row.paid_at, payment_deadline_at: row.payment_deadline_at })
  }
  for (const row of ledger.data || []) {
    // Wallet-funded Game Market purchases are already present in the order history.
    if (row.kind === 'SPEND' && row.reference_type === 'GAME_RECHARGE') continue
    entries.push({ id: row.id, source: 'WALLET_MOVEMENT', title: row.description || (row.kind === 'CREDIT' ? 'Fondos añadidos' : row.kind === 'REFUND' ? 'Devolución a Wallet' : 'Movimiento de Wallet'), amount_cup: Number(row.amount_cup), currency: 'CUP', status: row.kind, message: row.kind === 'SPEND' ? 'Compra descontada del saldo.' : row.kind === 'REFUND' ? 'Importe devuelto al saldo.' : 'Saldo añadido a Wallet.', created_at: row.created_at, updated_at: row.created_at })
  }
  entries.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))
  return entries.slice(0, 120)
}

module.exports = {
  getWalletSummary, createTopup, getTopup, findMatchingTopups,
  processIncomingTransfer, getStoreHistory, publicTopup,
}
