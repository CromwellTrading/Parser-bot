'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { readAllRows } = require('./supabasePagination')
const { bot, ADMINS } = require('../telegram')
const { getLicenseConfig, cardMatches } = require('./onboarding')
const { normalizePhone } = require('./parser')
const { getAutomationAvailability } = require('./systemSettings')
const { normalizePayerPhone, isConfiguredPaymentReceiver } = require('./etecsaPaymentMatching')
const { evaluateOfficialStorePayment } = require('./walletPaymentMatching')
const { rechargeGamesRequest, RechargeGamesApiError } = require('./rechargeGamesApi')
const { buildRechargeGamesOrderPayload } = require('./rechargeGamesOrderPayload')
const { getPlatformStoreId } = require('./rechargeGamesCatalog')
const { verifyWebhookSignature } = require('./rechargeGamesWebhookSecurity')
const { findMatchingTopups } = require('./storeWallet')
const { claimPaymentTransaction } = require('./paymentTransactionClaims')

const PAYMENT_WINDOW_MS = 30 * 60 * 1000
const BLOCKING_STATUSES = ['WAITING_PAYMENT']
const TERMINAL_PROVIDER_STATUSES = new Set(['delivered', 'failed'])
let workerStarted = false
let reconciliationInFlight = false

function nowIso() { return new Date().toISOString() }
function cleanText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
function errorWithStatus(message, status, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}
function makeTicket(id) { return `RG-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}` }

function publicOrder(order) {
  if (!order) return null
  const result = {
    id: order.id,
    ticket: makeTicket(order.id),
    status: order.wallet_refunded_at ? 'REFUNDED' : order.status,
    game_name: order.game_name,
    offer_title: order.offer_title,
    provider_game_slug: order.provider_game_slug,
    provider_region_name: order.provider_region_name || null,
    provider_delivery: order.provider_delivery,
    price_basis: order.price_basis,
    amount: Number(order.payment_amount),
    currency: String(order.payment_source || 'TRANSFERMOVIL').toUpperCase() === 'WALLET' && String(order.price_basis || 'CUP').toUpperCase() === 'SALDO' ? 'SALDO' : 'CUP',
    payer_phone: order.payer_phone,
    player_id: order.player_id || null,
    server_id: order.server_id || null,
    created_at: order.created_at,
    payment_deadline_at: order.payment_deadline_at,
    paid_at: order.paid_at || null,
    updated_at: order.updated_at,
    provider_status: order.provider_status || null,
    delivery_note: order.provider_delivery_note || null,
    failure_reason: order.wallet_refunded_at ? 'La entrega falló y el importe ya fue devuelto a tu Wallet.' : order.status === 'REFUND_REQUIRED' ? 'La entrega falló. Tu caso requiere resolución; no vuelvas a pagar.' : order.status === 'FULFILLMENT_REVIEW' ? 'El pedido necesita revisión. No vuelvas a pagar.' : order.failure_reason || null,
    payment_source: order.payment_source || 'TRANSFERMOVIL',
    requirements: {
      delivery: order.provider_delivery,
      player_id: order.provider_delivery === 'player_id',
      server_id: order.provider_delivery === 'player_id' && /mobile[-_ ]?legends/i.test(String(order.provider_game_slug || '')),
    },
  }
  if (order.status === 'WAITING_PAYMENT') {
    result.payment = { card: order.destination_card, confirmation_phone: order.confirmation_phone }
  }
  return result
}

async function notifyAdmins(message) {
  await Promise.all((ADMINS || []).map(id => bot.sendMessage(id, message).catch(error => {
    console.error('[RechargeGames] No se pudo notificar al administrador:', error.message)
  })))
}

async function expireOrderIfNeeded(order) {
  if (!order || order.status !== 'WAITING_PAYMENT' || !order.payment_deadline_at) return order
  if (Date.now() <= Date.parse(order.payment_deadline_at)) return order
  const { data, error } = await supabase.from('game_recharge_orders')
    .update({ status: 'EXPIRED', failure_reason: 'PAYMENT_WINDOW_EXPIRED', updated_at: nowIso() })
    .eq('id', order.id).eq('status', 'WAITING_PAYMENT').select('*').maybeSingle()
  if (error) throw error
  return data || order
}

async function findBlockingOrder(clientId) {
  const { data, error } = await supabase.from('game_recharge_orders').select('*')
    .eq('client_id', clientId).in('status', BLOCKING_STATUSES)
    .order('created_at', { ascending: false }).limit(5)
  if (error) throw error
  for (const candidate of data || []) {
    const checked = await expireOrderIfNeeded(candidate)
    if (BLOCKING_STATUSES.includes(checked.status)) return checked
  }
  return null
}

async function assertNoOtherWaitingCheckout(clientId) {
  const gameOrder = await findBlockingOrder(clientId)
  if (gameOrder) throw Object.assign(errorWithStatus('Ya tienes una compra de juegos pendiente de pago. Págala o cancélala antes de iniciar otra.', 409, 'CHECKOUT_ACTIVE'), { order: publicOrder(gameOrder) })

  const { data: etecsa, error } = await supabase.from('etecsa_orders').select('*')
    .eq('client_id', clientId).eq('status', 'WAITING_PAYMENT')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (etecsa) {
    if (Date.now() > Date.parse(etecsa.payment_deadline_at || '')) {
      await supabase.from('etecsa_orders').update({ status: 'EXPIRED', failure_reason: 'PAYMENT_WINDOW_EXPIRED', updated_at: nowIso() })
        .eq('id', etecsa.id).eq('status', 'WAITING_PAYMENT')
    } else {
      throw Object.assign(errorWithStatus('Ya tienes una operación pendiente de pago. Complétala o cancélala antes de iniciar otra.', 409, 'CHECKOUT_ACTIVE'), {
        order: { id: etecsa.id, ticket: `ET-${String(etecsa.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`, status: etecsa.status },
      })
    }
  }
  const { data: topups, error: topupError } = await supabase.from('store_wallet_topups').select('id,status,payment_deadline_at')
    .eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').order('created_at', { ascending: false }).limit(1)
  if (topupError) throw topupError
  const topup = topups?.[0]
  if (topup) {
    if (Date.now() > Date.parse(topup.payment_deadline_at || '')) {
      await supabase.from('store_wallet_topups').update({ status: 'EXPIRED', updated_at: nowIso() }).eq('id', topup.id).eq('status', 'WAITING_PAYMENT')
    } else {
      throw Object.assign(errorWithStatus('Ya tienes una recarga de Wallet pendiente. Complétala antes de iniciar otra compra.', 409, 'CHECKOUT_ACTIVE'), { order: { id: topup.id, status: topup.status } })
    }
  }
}

async function getCheckoutConfig() {
  const automation = await getAutomationAvailability()
  const config = getLicenseConfig()
  return {
    automation_enabled: automation.enabled,
    automation_message: automation.message,
    payment_configured: Boolean(config.configured && config.currency === 'CUP'),
    payment: config.configured ? { card: config.paymentCard, confirmation_phone: config.paymentPhone, currency: 'CUP' } : null,
  }
}

async function getProviderOffer(offerId) {
  const storeId = await getPlatformStoreId()
  const { data: offer, error } = await supabase.from('game_market_offers')
    .select('id, store_id, game_id, title, description, category, package_data, price_cup, price_saldo, base_cost_usd, available, published, provider, provider_product_key, provider_game_slug, provider_region_slug, provider_region_name, provider_delivery, provider_out_of_stock')
    .eq('id', offerId).eq('store_id', storeId).maybeSingle()
  if (error) throw error
  if (!offer || offer.provider !== 'rechargegames' || !offer.provider_product_key) {
    throw errorWithStatus('Esta oferta no está disponible para compra automática.', 409, 'OFFER_NOT_PROVIDER_MANAGED')
  }
  if (!offer.published || !offer.available || offer.provider_out_of_stock) {
    throw errorWithStatus('Este paquete está temporalmente agotado. Elige otro.', 409, 'OFFER_OUT_OF_STOCK')
  }
  const { data: game, error: gameError } = await supabase.from('game_market_games')
    .select('id, name, slug, is_active').eq('id', offer.game_id).eq('store_id', storeId).maybeSingle()
  if (gameError) throw gameError
  if (!game || !game.is_active) throw errorWithStatus('Este juego no está disponible.', 409, 'GAME_UNAVAILABLE')
  return { ...offer, game_name: game.name, game_slug: game.slug }
}

async function createPaymentOrder(client, body) {
  const automation = await getAutomationAvailability()
  if (!automation.enabled) throw errorWithStatus(automation.message || 'Los pagos automáticos están temporalmente desactivados.', 503, 'AUTOMATION_UNAVAILABLE')
  const paymentConfig = getLicenseConfig()
  if (!paymentConfig.configured || paymentConfig.currency !== 'CUP') throw errorWithStatus('El método de pago no está configurado. Inténtalo más tarde.', 503, 'PAYMENT_CONFIG_MISSING')

  await assertNoOtherWaitingCheckout(client.id)
  const offerId = cleanText(body?.offer_id, 100)
  const basis = String(body?.price_basis || '').trim().toUpperCase()
  const payerPhone = normalizePayerPhone(body?.payer_phone)
  if (!offerId || basis !== 'CUP') throw errorWithStatus('Selecciona un paquete con precio CUP. Saldo Móvil se muestra como referencia, pero no es un importe de transferencia válido.', 400, 'INVALID_OFFER_SELECTION')
  if (!/^5\d{7}$/.test(payerPhone)) throw errorWithStatus('Introduce el móvil cubano desde el que realizarás la transferencia.', 400, 'INVALID_PAYER_PHONE')

  const offer = await getProviderOffer(offerId)
  const playerId = cleanText(body?.player_id, 200) || null
  const serverId = cleanText(body?.server_id, 200) || null
  if (offer.provider_delivery === 'player_id' && !playerId) {
    throw errorWithStatus('Introduce el ID del jugador antes de crear el ticket de pago.', 400, 'PLAYER_ID_REQUIRED')
  }
  if (offer.provider_delivery === 'player_id' && /mobile[-_ ]?legends/i.test(String(offer.provider_game_slug || '')) && !serverId) {
    throw errorWithStatus('Introduce también el ID del servidor antes de crear el ticket.', 400, 'SERVER_ID_REQUIRED')
  }
  const amount = Number(offer.price_cup)
  if (!Number.isSafeInteger(amount) || amount <= 0) throw errorWithStatus('El precio seleccionado no es válido. Actualiza el catálogo e inténtalo de nuevo.', 409, 'INVALID_LOCAL_PRICE')
  const providerMeta = offer.package_data?.rechargegames || {}
  const providerCost = Number(providerMeta.provider_price_usdt ?? offer.base_cost_usd)
  if (!Number.isFinite(providerCost) || providerCost <= 0) throw errorWithStatus('El precio del paquete está siendo actualizado. Inténtalo de nuevo.', 409, 'PROVIDER_PRICE_UNAVAILABLE')

  const id = crypto.randomUUID()
  const createdAt = new Date()
  const deadline = new Date(createdAt.getTime() + PAYMENT_WINDOW_MS)
  const payload = {
    id,
    client_id: client.id,
    offer_id: offer.id,
    game_name: cleanText(offer.game_name, 100),
    offer_title: cleanText(offer.title, 120),
    provider_product_key: offer.provider_product_key,
    provider_product_name: cleanText(providerMeta.product_name || offer.title, 120),
    provider_game_slug: cleanText(offer.provider_game_slug, 160) || cleanText(providerMeta.game_slug, 160),
    provider_region_slug: offer.provider_region_slug || providerMeta.region_slug || null,
    provider_region_name: offer.provider_region_name || providerMeta.region_name || null,
    provider_delivery: offer.provider_delivery || providerMeta.delivery,
    provider_kind: providerMeta.provider_kind || 'topup',
    provider_cost_usdt: providerCost,
    price_basis: basis,
    payment_amount: amount,
    payer_phone: payerPhone,
    player_id: playerId,
    server_id: serverId,
    destination_card: paymentConfig.paymentCard,
    confirmation_phone: paymentConfig.paymentPhone,
    status: 'WAITING_PAYMENT',
    buyer_ref: `SO-${id}`,
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    payment_deadline_at: deadline.toISOString(),
  }
  const { data: order, error } = await supabase.from('game_recharge_orders').insert(payload).select('*').single()
  if (error) {
    if (error.code === '23505') {
      const blocking = await findBlockingOrder(client.id)
      throw Object.assign(errorWithStatus('Ya tienes una compra de juegos pendiente de pago. Págala o cancélala antes de iniciar otra.', 409, 'CHECKOUT_ACTIVE'), { order: publicOrder(blocking) })
    }
    throw error
  }
  const publicData = publicOrder(order)
  notifyAdmins(`🎮 Ticket de juego creado · ${publicData.ticket}\nJuego: ${order.game_name}\nPaquete: ${order.offer_title}\nImporte: ${amount} CUP (${basis})\nTarjeta destino: ${order.destination_card}\nTeléfono a confirmar: ${order.confirmation_phone}\nPagador: ${payerPhone}\nEstado: esperando pago`).catch(() => {})
  console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_ORDER_CREATED', order_id: order.id, client_id: client.id, provider_product_key_hash: crypto.createHash('sha256').update(order.provider_product_key).digest('hex').slice(0, 16), amount, basis }))
  return publicData
}

async function createWalletGameOrder(client, body) {
  if (!String(process.env.RECHARGEGAMES_API_KEY || '').trim()) {
    throw errorWithStatus('Las compras con Wallet están temporalmente no disponibles. Inténtalo más tarde.', 503, 'PROVIDER_NOT_CONFIGURED')
  }
  const offerId = cleanText(body?.offer_id, 100)
  const basis = String(body?.price_basis || 'CUP').trim().toUpperCase()
  if (!offerId || !['CUP', 'SALDO'].includes(basis)) throw errorWithStatus('Selecciona un paquete y una moneda válida para Wallet.', 400, 'INVALID_OFFER_SELECTION')
  const idempotencyKey = cleanText(body?.idempotency_key, 128)
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) throw errorWithStatus('No se pudo verificar el intento de compra. Vuelve a intentarlo.', 400, 'INVALID_IDEMPOTENCY_KEY')
  await assertNoOtherWaitingCheckout(client.id)
  const offer = await getProviderOffer(offerId)
  const playerId = cleanText(body?.player_id, 200) || null
  const serverId = cleanText(body?.server_id, 200) || null
  if (offer.provider_delivery === 'player_id' && !playerId) throw errorWithStatus('Introduce el ID del jugador antes de comprar.', 400, 'PLAYER_ID_REQUIRED')
  if (offer.provider_delivery === 'player_id' && /mobile[-_ ]?legends/i.test(String(offer.provider_game_slug || '')) && !serverId) {
    throw errorWithStatus('Introduce también el ID del servidor antes de comprar.', 400, 'SERVER_ID_REQUIRED')
  }
  const amount = Number(basis === 'SALDO' ? offer.price_saldo : offer.price_cup)
  if (!Number.isSafeInteger(amount) || amount <= 0) throw errorWithStatus(`El precio de este paquete en ${basis === 'SALDO' ? 'Saldo Móvil' : 'CUP'} no está disponible.`, 409, 'INVALID_LOCAL_PRICE')
  const providerMeta = offer.package_data?.rechargegames || {}
  const providerCost = Number(providerMeta.provider_price_usdt ?? offer.base_cost_usd)
  if (!Number.isFinite(providerCost) || providerCost <= 0) throw errorWithStatus('El precio del paquete se está actualizando. Inténtalo más tarde.', 409, 'PROVIDER_PRICE_UNAVAILABLE')

  const id = crypto.randomUUID()
  const createdAt = new Date()
  const orderPayload = {
    id, offer_id: offer.id, game_name: cleanText(offer.game_name, 100), offer_title: cleanText(offer.title, 120),
    provider_product_key: offer.provider_product_key,
    provider_product_name: cleanText(providerMeta.product_name || offer.title, 120),
    provider_game_slug: cleanText(offer.provider_game_slug, 160) || cleanText(providerMeta.game_slug, 160),
    provider_region_slug: offer.provider_region_slug || providerMeta.region_slug || null,
    provider_region_name: offer.provider_region_name || providerMeta.region_name || null,
    provider_delivery: offer.provider_delivery || providerMeta.delivery,
    provider_kind: providerMeta.provider_kind || 'topup', provider_cost_usdt: providerCost,
    price_basis: basis, payment_amount: amount, payer_phone: null,
    player_id: playerId, server_id: serverId, buyer_ref: `SO-${id}`,
  }
  const { data: rpcData, error: rpcError } = await supabase.rpc('store_wallet_create_game_order', {
    p_client_id: client.id, p_amount: amount, p_order: orderPayload, p_idempotency_key: idempotencyKey, p_currency: basis,
  })
  if (rpcError) {
    if (String(rpcError.message || '').includes('INSUFFICIENT_WALLET_BALANCE')) {
      throw errorWithStatus(`No tienes suficiente saldo ${basis === 'SALDO' ? 'móvil' : 'CUP'} en Wallet. Añade fondos en esa moneda o elige otro paquete.`, 409, 'INSUFFICIENT_WALLET_BALANCE')
    }
    if (String(rpcError.message || '').includes('IDEMPOTENCY_KEY_REUSED')) throw errorWithStatus('Este intento ya se utilizó. Inicia una nueva compra.', 409, 'IDEMPOTENCY_KEY_REUSED')
    if (rpcError.code === '23505') throw errorWithStatus('Esta compra ya se está procesando. Revisa tu historial.', 409, 'ORDER_ALREADY_EXISTS')
    throw rpcError
  }
  const rawOrder = rpcData?.order || rpcData
  const orderId = rawOrder?.id || id
  const createdOrder = rpcData?.order ? publicOrder(rpcData.order) : null
  console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_DEBITED', order_id: orderId, client_id: client.id, currency: basis, amount, balance_cup: Number(rpcData?.balance_cup || 0), balance_saldo: Number(rpcData?.balance_saldo || 0) }))
  // If the same idempotency key is replayed, return the existing order. The recovery
  // worker resolves a stale SUBMITTING_TO_PROVIDER state by buyer_ref, avoiding a
  // second concurrent provider submission while never leaving a crashed order behind.
  if (rpcData?.already_processed) return createdOrder || publicOrder(rawOrder)

  // A new Wallet debit must immediately start provider submission. The SQL RPC has
  // atomically reserved the balance and created a SUBMITTING_TO_PROVIDER order; if
  // this call has a transient database error, keep the persisted order visible and
  // let the reconciliation worker safely retry with the same buyer_ref.
  let submitted
  try {
    submitted = await submitProviderOrder(orderId, { playerId, serverId })
  } catch (submitError) {
    console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_SUBMISSION_DEFERRED', order_id: orderId, code: submitError?.code || 'submission_error' }))
    notifyAdmins(`⚠️ Compra con Wallet pendiente de envío · ${makeTicket(orderId)}\nEl saldo quedó reservado y el pedido se recuperará automáticamente. No solicites otro pago al cliente.`).catch(() => {})
    const { data: refreshed, error: refreshError } = await supabase.from('game_recharge_orders')
      .select('*').eq('id', orderId).maybeSingle()
    if (refreshError) throw refreshError
    if (!refreshed) throw submitError
    submitted = publicOrder(refreshed)
  }

  let finalSubmitted = submitted
  if (submitted.status === 'REFUND_REQUIRED') {
    const { error: refundError } = await supabase.rpc('store_wallet_refund_game_order', { p_order_id: orderId })
    if (refundError) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_AUTO_REFUND_FAILED', order_id: orderId, code: refundError.code || 'REFUND_FAILED' }))
      notifyAdmins(`🚨 Devolución pendiente · ${makeTicket(orderId)}\nNo se pudo devolver automáticamente el saldo de Wallet. El sistema reintentará la operación; revisa la incidencia y no pidas otro pago al cliente.`).catch(() => {})
    } else {
      console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_AUTO_REFUNDED', order_id: orderId, currency: basis, amount }))
    }
    // Return the authoritative persisted state, not the pre-refund response. The
    // RPC may have completed the refund even if this request began with REFUND_REQUIRED.
    const { data: refreshed, error: refreshError } = await supabase.from('game_recharge_orders')
      .select('*').eq('id', orderId).maybeSingle()
    if (refreshError) throw refreshError
    if (refreshed) finalSubmitted = publicOrder(refreshed)
  }
  return finalSubmitted
}

async function getRecentOrders(clientId) {
  const { data, error } = await supabase.from('game_recharge_orders').select('*')
    .eq('client_id', clientId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  const orders = []
  for (const row of data || []) orders.push(publicOrder(await expireOrderIfNeeded(row)))
  return orders
}

async function getOwnedOrder(clientId, orderId) {
  const { data, error } = await supabase.from('game_recharge_orders').select('*')
    .eq('id', orderId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return publicOrder(await expireOrderIfNeeded(data))
}

async function cancelPaymentOrder(clientId, orderId) {
  const { data: order, error } = await supabase.from('game_recharge_orders').select('*')
    .eq('id', orderId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!order) throw errorWithStatus('No se encontró esta operación.', 404, 'ORDER_NOT_FOUND')
  const checked = await expireOrderIfNeeded(order)
  if (checked.status !== 'WAITING_PAYMENT') throw errorWithStatus('Solo puedes cancelar una operación que todavía espera el pago.', 409, 'ORDER_CANNOT_CANCEL')
  const { data: updated, error: updateError } = await supabase.from('game_recharge_orders')
    .update({ status: 'CANCELED', canceled_at: nowIso(), updated_at: nowIso() })
    .eq('id', orderId).eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').select('*').maybeSingle()
  if (updateError) throw updateError
  if (!updated) throw errorWithStatus('La operación cambió de estado y no se pudo cancelar.', 409, 'ORDER_STATE_CHANGED')
  return publicOrder(updated)
}

function providerFailureReason(error) {
  const code = String(error?.code || 'provider_error')
  const safeMessages = {
    insufficient_balance: 'El servicio de recargas está temporalmente no disponible. Contacta con soporte.',
    out_of_stock: 'El paquete se agotó después de iniciar la compra. Contacta con soporte para resolver el pago.',
    unknown_product: 'El paquete cambió y necesita revisión. Contacta con soporte.',
    invalid_api_key: 'El servicio de recargas está temporalmente no disponible. Contacta con soporte.',
    resellers_only: 'El servicio de recargas está temporalmente no disponible. Contacta con soporte.',
  }
  return safeMessages[code] || 'No se pudo confirmar la entrega automática. El pedido requiere revisión; no vuelvas a pagar.'
}

async function persistProviderResult(order, providerOrder, raw = null) {
  const providerStatus = String(providerOrder?.status || 'pending').toLowerCase()
  const status = providerStatus === 'delivered' ? 'COMPLETED' : providerStatus === 'failed' ? 'REFUND_REQUIRED' : 'PROCESSING'
  const patch = {
    provider_order_id: cleanText(providerOrder?.order_id, 120) || order.provider_order_id || null,
    provider_status: providerStatus,
    provider_delivery_note: cleanText(providerOrder?.delivery_note, 1000) || null,
    provider_failure_reason: cleanText(providerOrder?.failure_reason, 1000) || null,
    provider_payload: raw || providerOrder || null,
    status,
    failure_reason: providerStatus === 'failed' ? providerFailureReason({ code: providerOrder?.failure_reason }) : null,
    updated_at: nowIso(),
    completed_at: providerStatus === 'delivered' ? nowIso() : null,
  }
  // A terminal provider webhook may race the HTTP response. Only update an order that
  // is still in a provider-submission/reconciliation state; never overwrite a refund or
  // a terminal state with a stale REST response.
  const { data, error } = await supabase.from('game_recharge_orders').update(patch)
    .eq('id', order.id).in('status', ['SUBMITTING_TO_PROVIDER', 'PROCESSING', 'FULFILLMENT_REVIEW'])
    .select('*').maybeSingle()
  if (error) throw error
  if (!data) {
    const { data: latest, error: latestError } = await supabase.from('game_recharge_orders').select('*').eq('id', order.id).maybeSingle()
    if (latestError) throw latestError
    return publicOrder(latest || order)
  }

  let finalOrder = data
  if (status === 'COMPLETED') {
    console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_DELIVERED', order_id: order.id, provider_order_id: patch.provider_order_id }))
    notifyAdmins(`✅ Recarga de juego entregada · ${makeTicket(order.id)}\nJuego: ${order.game_name}\nPaquete: ${order.offer_title}${patch.provider_delivery_note ? `\nEntrega: ${patch.provider_delivery_note}` : ''}`).catch(() => {})
  } else if (status === 'REFUND_REQUIRED') {
    console.error('[RechargeGames] La entrega falló después del pago local:', JSON.stringify({ order_id: order.id, provider_order_id: patch.provider_order_id, provider_status: providerStatus }))
    if (data.payment_source === 'WALLET') {
      const { error: refundError } = await supabase.rpc('store_wallet_refund_game_order', { p_order_id: data.id })
      if (refundError) {
        console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_AUTO_REFUND_FAILED', order_id: data.id, code: refundError.code || 'REFUND_FAILED' }))
      } else {
        const { data: refreshed, error: readError } = await supabase.from('game_recharge_orders').select('*').eq('id', data.id).maybeSingle()
        if (readError) throw readError
        finalOrder = refreshed || data
      }
    }
    notifyAdmins(`⚠️ Recarga de juego necesita resolución · ${makeTicket(order.id)}\nJuego: ${order.game_name}\nPaquete: ${order.offer_title}\nEstado del proveedor: ${providerStatus}\nMotivo: ${patch.failure_reason || 'No disponible'}\nEl pedido ya fue pagado; comprueba el estado de la devolución antes de pedir cualquier otro pago.`).catch(() => {})
  }
  return publicOrder(finalOrder)
}

async function markProviderFailure(order, error) {
  const noOrderCreated = Number(error?.status) >= 400 && Number(error?.status) < 500
    && ['out_of_stock', 'unknown_product', 'insufficient_balance', 'invalid_request'].includes(String(error?.code || ''))
  const status = noOrderCreated ? 'REFUND_REQUIRED' : 'FULFILLMENT_REVIEW'
  const safeMessage = providerFailureReason(error)
  // Do not let a late network exception overwrite a provider webhook or another worker's
  // terminal result. The periodic worker will retry refund/reconciliation if necessary.
  const { data, error: updateError } = await supabase.from('game_recharge_orders').update({
    status,
    provider_status: 'error',
    provider_failure_reason: cleanText(`${error?.code || 'provider_error'}${error?.status ? ` HTTP ${error.status}` : ''}`, 300),
    failure_reason: safeMessage,
    updated_at: nowIso(),
  }).eq('id', order.id).in('status', ['SUBMITTING_TO_PROVIDER', 'PROCESSING', 'FULFILLMENT_REVIEW'])
    .select('*').maybeSingle()
  if (updateError) throw updateError
  if (!data) {
    const { data: latest, error: latestError } = await supabase.from('game_recharge_orders').select('*').eq('id', order.id).maybeSingle()
    if (latestError) throw latestError
    return publicOrder(latest || order)
  }

  let finalOrder = data
  if (status === 'REFUND_REQUIRED' && data.payment_source === 'WALLET') {
    const { error: refundError } = await supabase.rpc('store_wallet_refund_game_order', { p_order_id: data.id })
    if (refundError) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_AUTO_REFUND_FAILED', order_id: data.id, code: refundError.code || 'REFUND_FAILED' }))
    } else {
      const { data: refreshed, error: readError } = await supabase.from('game_recharge_orders').select('*').eq('id', data.id).maybeSingle()
      if (readError) throw readError
      finalOrder = refreshed || data
    }
  }
  notifyAdmins(`⚠️ Falló el envío de recarga de juego · ${makeTicket(order.id)}\nJuego: ${order.game_name}\nPaquete: ${order.offer_title}\nCódigo proveedor: ${error?.code || 'error'}${error?.status ? ` (HTTP ${error.status})` : ''}\nEstado actual: ${finalOrder.status}. Comprueba la entrega o devolución antes de pedir otro pago.`).catch(() => {})
  console.error('[RechargeGames] Error al solicitar una recarga:', JSON.stringify({ order_id: order.id, code: error?.code || null, status: error?.status || null, local_status: finalOrder.status }))
  return publicOrder(finalOrder)
}

async function submitProviderOrder(orderId, { playerId = null, serverId = null } = {}) {
  const { data: order, error } = await supabase.from('game_recharge_orders').select('*').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order) throw errorWithStatus('No se encontró esta operación.', 404, 'ORDER_NOT_FOUND')
  if (order.provider_order_id || ['PROCESSING', 'COMPLETED'].includes(order.status)) return publicOrder(order)
  if (!['PAYMENT_RECEIVED_WAITING_DETAILS', 'SUBMITTING_TO_PROVIDER', 'FULFILLMENT_REVIEW'].includes(order.status)) {
    throw errorWithStatus('Esta compra no está lista para enviarse.', 409, 'ORDER_NOT_READY')
  }
  if (order.provider_delivery === 'player_id' && !cleanText(playerId ?? order.player_id, 200)) {
    throw errorWithStatus('Introduce el ID de jugador para procesar la recarga.', 400, 'PLAYER_ID_REQUIRED')
  }
  const effectivePlayerId = cleanText(playerId ?? order.player_id, 200) || null
  const effectiveServerId = cleanText(serverId ?? order.server_id, 200) || null
  if (order.provider_delivery === 'player_id' && /mobile[-_ ]?legends/i.test(String(order.provider_game_slug || '')) && !effectiveServerId) {
    throw errorWithStatus('Introduce también el ID del servidor para este juego.', 400, 'SERVER_ID_REQUIRED')
  }

  const patch = {
    status: 'SUBMITTING_TO_PROVIDER',
    player_id: effectivePlayerId,
    server_id: effectiveServerId,
    submitted_at: nowIso(),
    updated_at: nowIso(),
  }
  const { data: claiming, error: claimError } = await supabase.from('game_recharge_orders')
    .update(patch).eq('id', order.id).in('status', ['PAYMENT_RECEIVED_WAITING_DETAILS', 'SUBMITTING_TO_PROVIDER', 'FULFILLMENT_REVIEW'])
    .select('*').maybeSingle()
  if (claimError) throw claimError
  if (!claiming) throw errorWithStatus('La compra ya está siendo procesada.', 409, 'ORDER_ALREADY_PROCESSING')

  const body = buildRechargeGamesOrderPayload(order, {
    playerId: effectivePlayerId,
    serverId: effectiveServerId,
    note: `SynthesisOne ${makeTicket(order.id)}`,
  })
  try {
    let result
    try {
      result = await rechargeGamesRequest('/v1/orders', { method: 'POST', body })
    } catch (firstError) {
      // Network timeouts can occur after the provider committed the order. Retry once with
      // exactly the same buyer_ref, which the provider documents as idempotent.
      if (!['provider_timeout', 'provider_network_error'].includes(firstError?.code)) throw firstError
      result = await rechargeGamesRequest('/v1/orders', { method: 'POST', body })
    }
    const providerOrder = result.data?.order || result.data
    if (!providerOrder?.order_id) {
      const malformed = new RechargeGamesApiError('RechargeGames returned an unrecognized order response', { status: 502, code: 'invalid_provider_response', details: result.data })
      return await markProviderFailure(claiming, malformed)
    }
    return await persistProviderResult(claiming, providerOrder, result.data)
  } catch (error) {
    return await markProviderFailure(claiming, error)
  }
}

async function submitRecipientDetails(clientId, orderId, body) {
  const { data: order, error } = await supabase.from('game_recharge_orders').select('*')
    .eq('id', orderId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!order) throw errorWithStatus('No se encontró esta operación.', 404, 'ORDER_NOT_FOUND')
  if (order.status !== 'PAYMENT_RECEIVED_WAITING_DETAILS') throw errorWithStatus('Esta compra no está esperando datos del jugador.', 409, 'ORDER_NOT_WAITING_DETAILS')
  return submitProviderOrder(order.id, {
    playerId: body?.player_id,
    serverId: body?.server_id,
  })
}

async function processIncomingTransfer({ client, parsed, receivedAt, smsLogId }) {
  const direction = String(parsed?.direction || '').toUpperCase()
  const isDestinationReceipt = direction === 'RECIBIDO'
  // A received SMS is emitted by the payment destination's phone, which is often
  // an admin/merchant client rather than the buyer that owns the order.
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  const buildCandidateQuery = () => {
    let query = supabase.from('game_recharge_orders').select('*')
      .in('status', ['WAITING_PAYMENT', 'EXPIRED'])
      .gte('created_at', cutoff).order('created_at', { ascending: false })
    if (!isDestinationReceipt) query = query.eq('client_id', client.id)
    return query
  }
  const candidates = await readAllRows(buildCandidateQuery, { pageSize: 500, maxRows: 100_000 })
  const matchedCandidates = []
  for (const candidate of candidates || []) {
    // Cross-client RECIBIDO receipts are accepted only from the configured
    // payment destination phone; ENVIADO remains scoped to the ticket owner.
    if (isDestinationReceipt && !isConfiguredPaymentReceiver(client, candidate)) continue
    if (candidate.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const result = evaluateOfficialStorePayment(parsed, candidate, receivedAt)
    if (result.matched) matchedCandidates.push({ order: candidate, evaluation: result })
    const potentiallyRelevant = ['AMOUNT_MISMATCH', 'DESTINATION_CARD_MISMATCH', 'PAYER_PHONE_MISMATCH', 'PAYER_PHONE_NOT_IN_SMS', 'PAYMENT_OUTSIDE_WINDOW']
    if (candidate.status === 'WAITING_PAYMENT' && Date.now() > Date.parse(candidate.payment_deadline_at || '') &&
      ['ENVIADO', 'RECIBIDO'].includes(direction) && Number(parsed?.amount) === Number(candidate.payment_amount) &&
      parsed?.receiver_account && cardMatches(parsed.receiver_account, candidate.destination_card) &&
      result.reasons.every(reason => potentiallyRelevant.includes(reason))) {
      await expireOrderIfNeeded(candidate)
    }
  }
  if (matchedCandidates.length !== 1) {
    if (matchedCandidates.length > 1) console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'RECHARGEGAMES', direction, matching_ticket_count: matchedCandidates.length }))
    return null
  }
  const { order: selected, evaluation } = matchedCandidates[0]

  if (isDestinationReceipt) {
    const walletMatches = await findMatchingTopups({ client, parsed, receivedAt })
    if (walletMatches.length) {
      console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'RECHARGEGAMES', wallet_ticket_count: walletMatches.length }))
      return null
    }

    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const etecsaCandidates = await readAllRows(() => supabase.from('etecsa_orders').select('*')
      .in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }),
      { pageSize: 500, maxRows: 100_000 })
    const etecsaMatches = etecsaCandidates.filter(candidate =>
      isConfiguredPaymentReceiver(client, candidate) &&
      !(candidate.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, candidate, receivedAt).matched)
    if (etecsaMatches.length) {
      console.warn(JSON.stringify({ ts: nowIso(), event: 'PAYMENT_MATCH_AMBIGUOUS', source: 'RECHARGEGAMES', direction, matching_etecsa_ticket_count: etecsaMatches.length }))
      return null
    }
  }

  if (parsed?.transaction_id) {
    const [dupeGame, dupeEtecsa, dupeWallet] = await Promise.all([
      supabase.from('game_recharge_orders').select('id').eq('payment_transaction_id', String(parsed.transaction_id)).maybeSingle(),
      supabase.from('etecsa_orders').select('id').eq('payment_transaction_id', String(parsed.transaction_id)).maybeSingle(),
      supabase.from('store_wallet_topups').select('id').eq('payment_transaction_id', String(parsed.transaction_id)).maybeSingle(),
    ])
    if (dupeGame.error) throw dupeGame.error
    if (dupeEtecsa.error) throw dupeEtecsa.error
    if (dupeWallet.error) throw dupeWallet.error
    if (dupeGame.data || dupeEtecsa.data || dupeWallet.data) return null
  }

  const claimed = await claimPaymentTransaction({ transactionId: parsed?.transaction_id, smsLogId, clientId: selected.client_id, source: 'GAMEMARKET', orderId: selected.id })
  if (!claimed) return null

  const requiresServer = /mobile[-_ ]?legends/i.test(String(selected.provider_game_slug || ''))
  const hasAllRecipientDetails = selected.provider_delivery === 'code' ||
    (selected.provider_delivery === 'player_id' && Boolean(cleanText(selected.player_id, 200)) && (!requiresServer || Boolean(cleanText(selected.server_id, 200))))
  const nextStatus = hasAllRecipientDetails ? 'SUBMITTING_TO_PROVIDER' : 'PAYMENT_RECEIVED_WAITING_DETAILS'
  const { data: updated, error: updateError } = await supabase.from('game_recharge_orders').update({
    status: nextStatus,
    paid_at: nowIso(),
    payment_transaction_id: parsed?.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
    payment_sms_log_id: smsLogId ? String(smsLogId) : null,
    payment_transaction_at: evaluation.transaction_at,
    updated_at: nowIso(),
  }).eq('id', selected.id).eq('status', selected.status).select('*').maybeSingle()
  if (updateError) {
    if (updateError.code === '23505') return null
    throw updateError
  }
  if (!updated) return null
  console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_PAYMENT_MATCHED', order_id: updated.id, client_id: client.id, transaction_id: updated.payment_transaction_id || null, status: updated.status }))
  notifyAdmins(`✅ Pago recibido para recarga de juego · ${makeTicket(updated.id)}\nJuego: ${updated.game_name}\nPaquete: ${updated.offer_title}\nImporte: ${updated.payment_amount} CUP\nPagador: ${updated.payer_phone}\n${nextStatus === 'SUBMITTING_TO_PROVIDER' ? 'Enviando el pedido al proveedor.' : 'Faltan datos del jugador; el cliente debe completarlos.'}`).catch(() => {})
  if (nextStatus === 'SUBMITTING_TO_PROVIDER') {
    const submitted = await submitProviderOrder(updated.id, { playerId: updated.player_id, serverId: updated.server_id })
    return { order_id: updated.id, status: submitted.status, ticket: makeTicket(updated.id) }
  }
  return { order_id: updated.id, status: updated.status, ticket: makeTicket(updated.id) }
}

async function handleProviderWebhook(event, webhookId) {
  const eventType = cleanText(event?.type, 80)
  const cleanWebhookId = cleanText(webhookId, 200)
  if (!cleanWebhookId) throw errorWithStatus('Webhook ID is required.', 400, 'WEBHOOK_ID_MISSING')

  const { data: previousEvent, error: previousError } = await supabase.from('rechargegames_webhook_events')
    .select('event_id').eq('event_id', cleanWebhookId).maybeSingle()
  if (previousError) throw previousError
  if (previousEvent) return { ok: true, duplicate: true }

  if (eventType === 'webhook.test') {
    const { error: testInsertError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType })
    if (testInsertError && testInsertError.code !== '23505') throw testInsertError
    return { ok: true, test: true }
  }
  if (!['order.delivered', 'order.failed'].includes(eventType)) {
    const { error: ignoredInsertError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType || 'unknown' })
    if (ignoredInsertError && ignoredInsertError.code !== '23505') throw ignoredInsertError
    return { ok: true, ignored: true }
  }
  const data = event?.data
  const providerId = cleanText(data?.order_id, 120)
  const buyerRef = cleanText(data?.buyer_ref, 200)
  let order = null
  if (providerId) {
    const found = await supabase.from('game_recharge_orders').select('*').eq('provider_order_id', providerId).maybeSingle()
    if (found.error) throw found.error
    order = found.data
  }
  // Some providers can fire the terminal event immediately after POST /orders, before
  // the HTTP response has persisted provider_order_id; buyer_ref makes that race safe.
  if (!order && buyerRef) {
    const found = await supabase.from('game_recharge_orders').select('*').eq('buyer_ref', buyerRef).maybeSingle()
    if (found.error) throw found.error
    order = found.data
  }
  if (!order) {
    const { error: unmatchedInsertError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType })
    if (unmatchedInsertError && unmatchedInsertError.code !== '23505') throw unmatchedInsertError
    console.warn('[RechargeGames] Webhook válido sin pedido local relacionado:', JSON.stringify({ webhook_id: cleanWebhookId, event_type: eventType, has_order_id: Boolean(providerId), has_buyer_ref: Boolean(buyerRef) }))
    return { ok: true, unmatched: true }
  }
  if (order.status === 'REFUNDED' || order.status === 'COMPLETED' || order.webhook_event_id) {
    const { error: finalEventError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType })
    if (finalEventError && finalEventError.code !== '23505') throw finalEventError
    const conflictsWithFinal = (order.status === 'REFUNDED' && eventType === 'order.delivered') ||
      (order.status === 'COMPLETED' && eventType === 'order.failed')
    if (conflictsWithFinal) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_PROVIDER_TERMINAL_CONFLICT', order_id: order.id, local_status: order.status, provider_event: eventType, webhook_id: cleanWebhookId }))
      notifyAdmins(`🚨 Conflicto de estado del proveedor · ${makeTicket(order.id)}\nEstado local: ${order.status}; nuevo evento: ${eventType}. No se modificó el estado ni el saldo automáticamente. Revisa la operación.`).catch(() => {})
      return { ok: true, conflict: true, status: order.status }
    }
    return { ok: true, duplicate: true, status: order.status }
  }
  const status = eventType === 'order.delivered' ? 'COMPLETED' : 'REFUND_REQUIRED'
  const deliveryNote = cleanText(data?.delivery_note, 1000) || null
  const providerFailureReason = cleanText(data?.failure_reason, 1000) || null
  const patch = {
    status,
    provider_order_id: providerId || order.provider_order_id,
    provider_status: eventType === 'order.delivered' ? 'delivered' : 'failed',
    provider_delivery_note: deliveryNote,
    provider_failure_reason: providerFailureReason,
    provider_payload: data || {},
    webhook_event_id: cleanWebhookId,
    failure_reason: eventType === 'order.failed' ? providerFailureReason || 'El proveedor no pudo completar la recarga. Contacta con soporte.' : null,
    completed_at: eventType === 'order.delivered' ? nowIso() : null,
    updated_at: nowIso(),
  }
  const { data: updatedOrder, error: updateError } = await supabase.from('game_recharge_orders')
    .update(patch).eq('id', order.id).is('webhook_event_id', null)
    .in('status', ['SUBMITTING_TO_PROVIDER', 'PROCESSING', 'FULFILLMENT_REVIEW', 'REFUND_REQUIRED'])
    .select('id,client_id,payment_source,payment_amount,status').maybeSingle()
  if (updateError) throw updateError
  if (!updatedOrder) {
    // A different, concurrent provider event already finalized this order.
    const { error: duplicateInsertError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType })
    if (duplicateInsertError && duplicateInsertError.code !== '23505') throw duplicateInsertError
    const { data: latest, error: latestError } = await supabase.from('game_recharge_orders').select('status').eq('id', order.id).maybeSingle()
    if (latestError) throw latestError
    return { ok: true, duplicate: true, status: latest?.status || order.status }
  }
  // Record the idempotency key only after the order update succeeds. A failed DB update
  // returns 5xx and lets the provider retry rather than being acknowledged as a duplicate.
  const { error: eventInsertError } = await supabase.from('rechargegames_webhook_events').insert({ event_id: cleanWebhookId, event_type: eventType })
  if (eventInsertError && eventInsertError.code !== '23505') throw eventInsertError
  if (eventType === 'order.delivered') {
    console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_DELIVERED_WEBHOOK', order_id: order.id, provider_order_id: patch.provider_order_id }))
    notifyAdmins(`✅ Recarga de juego completada · ${makeTicket(order.id)}\n${order.game_name} · ${order.offer_title}${deliveryNote ? `\nEntrega: ${deliveryNote}` : ''}`).catch(() => {})
  } else {
    console.warn('[RechargeGames] El proveedor marcó el pedido como fallido tras recibir el pago local:', JSON.stringify({ order_id: order.id, provider_order_id: patch.provider_order_id }))
    if (updatedOrder.payment_source === 'WALLET') {
      const { error: refundError } = await supabase.rpc('store_wallet_refund_game_order', { p_order_id: order.id })
      if (refundError) console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_WEBHOOK_REFUND_FAILED', order_id: order.id, code: refundError.code || 'REFUND_FAILED' }))
    }
    notifyAdmins(`⚠️ Recarga de juego fallida · ${makeTicket(order.id)}\n${order.game_name} · ${order.offer_title}\nPago recibido; comprueba la devolución o resolución antes de solicitar otro pago.`).catch(() => {})
  }
  const { data: finalOrder, error: finalReadError } = await supabase.from('game_recharge_orders').select('*').eq('id', order.id).maybeSingle()
  if (finalReadError) throw finalReadError
  return { ok: true, order_id: order.id, status: finalOrder?.status || status }
}

async function findProviderOrderByBuyerRef(buyerRef) {
  if (!buyerRef) return null
  const response = await rechargeGamesRequest('/v1/orders', { query: { buyer_ref: buyerRef, limit: 1 } })
  const data = response.data
  // Keep compatibility with both the documented direct list and envelope variants
  // used by gateways; never assume a wrapped response is empty and resubmit blindly.
  const rows = Array.isArray(data) ? data
    : Array.isArray(data?.orders) ? data.orders
      : Array.isArray(data?.results) ? data.results
        : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.data?.orders) ? data.data.orders : []
  return rows.find(item => item?.buyer_ref === buyerRef) || null
}

async function reconcileProcessingOrders() {
  if (reconciliationInFlight) return
  reconciliationInFlight = true
  try {
    // Recover Wallet refunds independently of API-key/provider availability. A failed
    // first refund attempt must not leave the client debited indefinitely.
    try {
      const { data: refunds, error: refundQueryError } = await supabase.from('game_recharge_orders')
        .select('id,client_id,payment_amount,updated_at').eq('payment_source', 'WALLET')
        .eq('status', 'REFUND_REQUIRED').is('wallet_refunded_at', null)
        .order('updated_at', { ascending: true }).limit(100)
      if (refundQueryError) throw refundQueryError
      for (const order of refunds || []) {
        try {
          const { data: refundResult, error: refundError } = await supabase.rpc('store_wallet_refund_game_order', { p_order_id: order.id })
          if (refundError) {
            console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_REFUND_RETRY_FAILED', order_id: order.id, code: refundError.code || 'REFUND_FAILED' }))
            // Advance the retry cursor even when the RPC itself fails. Otherwise the
            // oldest 100 rows would be selected forever and later refunds would starve.
            const { error: rotateError } = await supabase.from('game_recharge_orders')
              .update({ updated_at: nowIso() }).eq('id', order.id).eq('status', 'REFUND_REQUIRED')
              .eq('payment_source', 'WALLET').is('wallet_refunded_at', null)
            if (rotateError) console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_REFUND_RETRY_ROTATE_FAILED', order_id: order.id, code: rotateError.code || 'ROTATE_FAILED' }))
          } else if (!refundResult?.already_refunded) {
            console.log(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_REFUND_RETRY_SUCCEEDED', order_id: order.id, currency: String(order.price_basis || 'CUP').toUpperCase(), amount: Number(order.payment_amount) }))
            notifyAdmins(`✅ Devolución recuperada · ${makeTicket(order.id)}\nSe devolvieron ${order.payment_amount} CUP a la Wallet después de reintentar una operación pendiente.`).catch(() => {})
          }
        } catch (refundError) {
          console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_REFUND_RETRY_EXCEPTION', order_id: order.id, code: refundError?.code || 'REFUND_FAILED' }))
          // Same anti-starvation behavior for thrown client/network exceptions.
          await supabase.from('game_recharge_orders').update({ updated_at: nowIso() })
            .eq('id', order.id).eq('status', 'REFUND_REQUIRED').eq('payment_source', 'WALLET')
            .is('wallet_refunded_at', null)
        }
      }
    } catch (refundQueryError) {
      console.error(JSON.stringify({ ts: nowIso(), event: 'GAME_RECHARGE_WALLET_REFUND_SCAN_FAILED', code: refundQueryError?.code || 'REFUND_SCAN_FAILED' }))
    }

    if (!String(process.env.RECHARGEGAMES_API_KEY || '').trim()) return
    const staleBefore = new Date(Date.now() - 45_000).toISOString()
    const stateSets = await Promise.all([
      supabase.from('game_recharge_orders').select('*').eq('status', 'PROCESSING')
        .lt('updated_at', staleBefore).order('updated_at', { ascending: true }).limit(30),
      supabase.from('game_recharge_orders').select('*').eq('status', 'SUBMITTING_TO_PROVIDER')
        .lt('updated_at', staleBefore).order('updated_at', { ascending: true }).limit(30),
      supabase.from('game_recharge_orders').select('*').eq('status', 'FULFILLMENT_REVIEW')
        .lt('updated_at', staleBefore).order('updated_at', { ascending: true }).limit(30),
    ])
    for (const result of stateSets) if (result.error) throw result.error
    const orders = stateSets.flatMap(result => result.data || [])
    for (const order of orders) {
      try {
        let providerOrder = null
        if (order.provider_order_id) {
          const response = await rechargeGamesRequest(`/v1/orders/${encodeURIComponent(order.provider_order_id)}`)
          providerOrder = response.data?.order || response.data
        } else {
          providerOrder = await findProviderOrderByBuyerRef(order.buyer_ref)
        }

        if (providerOrder?.order_id) {
          const providerStatus = String(providerOrder.status || '').toLowerCase()
          if (['pending', 'delivered', 'failed'].includes(providerStatus)) {
            await persistProviderResult(order, providerOrder, providerOrder)
          }
          continue
        }

        // Only retry a stale submission when provider lookup found nothing. The same
        // stable buyer_ref is sent again, so an already accepted order cannot double-charge.
        if (order.status === 'SUBMITTING_TO_PROVIDER') {
          await submitProviderOrder(order.id, { playerId: order.player_id, serverId: order.server_id })
        } else if (order.status === 'FULFILLMENT_REVIEW') {
          // Back off unresolved reviews to one lookup per minute instead of hot-looping them.
          await supabase.from('game_recharge_orders').update({ updated_at: nowIso() }).eq('id', order.id).eq('status', 'FULFILLMENT_REVIEW')
        }
      } catch (error) {
        // A reconciliation failure is intentionally non-destructive; the next pass retries.
        console.warn('[RechargeGames] No se pudo conciliar un pedido pendiente:', JSON.stringify({ order_id: order.id, code: error?.code || 'reconcile_error', status: error?.status || null }))
      }
    }
  } catch (error) {
    console.error('[RechargeGames] Falló la conciliación:', error?.code || error?.message || 'unknown')
  } finally {
    reconciliationInFlight = false
  }
}

function startRechargeGamesOrderWorker() {
  if (workerStarted) return
  workerStarted = true
  setTimeout(() => reconcileProcessingOrders().catch(() => {}), 15_000)
  setInterval(() => reconcileProcessingOrders().catch(() => {}), 60_000)
}

module.exports = {
  getCheckoutConfig,
  createPaymentOrder,
  getRecentOrders,
  getOwnedOrder,
  cancelPaymentOrder,
  submitRecipientDetails,
  processIncomingTransfer,
  createWalletGameOrder,
  verifyWebhookSignature,
  handleProviderWebhook,
  getPlatformStoreId,
  startRechargeGamesOrderWorker,
  reconcileProcessingOrders,
  publicOrder,
}
