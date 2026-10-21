'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { getProviderOffer, submitProviderOrder } = require('./rechargeGamesOrders')
const { submitRecipientDetails: submitEtecsaRecipientDetails } = require('./etecsaOrders')
const { getCatalogResponse } = require('./etecsaCatalog')
const { getLicenseConfig } = require('./onboarding')
const { getAutomationAvailability } = require('./systemSettings')
const { evaluateOfficialStorePayment, isConfiguredPaymentReceiver } = require('./walletPaymentMatching')
const { readAllRows } = require('./supabasePagination')
const { calculateDiscount, reserveDiscount, releaseDiscount, finalizePaidOrder } = require('./rewards')
const { cartFeatureAvailable, cartEnabled, rewardsEnabled, assertNoWaitingCart } = require('./cartFeaturePolicy')

const TRANSFER_WINDOW_MS = 30 * 60 * 1000
const OPEN_CART_STATUSES = ['BUILDING_CART', 'WAITING_PAYMENT']
let workerStarted = false

function nowIso() { return new Date().toISOString() }
function clean(value, max = 200) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) }
function err(message, status = 400, code = 'STORE_CART_ERROR') { const e = new Error(message); e.status = status; e.code = code; return e }
function uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function phone(value) { const s = String(value || '').replace(/\D/g, ''); return s.length > 8 ? s.slice(-8) : s }
function ticket(id) { return `SC-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}` }

function publicCart(row, items = []) {
  if (!row) return null
  return {
    id: row.id, ticket: ticket(row.id), status: row.status,
    payment_source: row.payment_source, price_basis: row.price_basis,
    currency: row.price_basis, item_count: Number(row.item_count || items.length || 0),
    base_subtotal: Number(row.base_subtotal || 0), discount_percent: Number(row.discount_percent || 0),
    discount_amount: Number(row.discount_amount || 0), amount: Number(row.payment_amount || 0),
    payment_amount: Number(row.payment_amount || 0), welcome_discount: row.welcome_discount === true,
    payer_phone: row.payer_phone || null, destination_card: row.destination_card || null,
    confirmation_phone: row.confirmation_phone || null,
    payment_deadline_at: row.payment_deadline_at || null, paid_at: row.paid_at || null,
    payment_transaction_at: row.payment_transaction_at || null,
    created_at: row.created_at, updated_at: row.updated_at,
    items: items.map(line => ({ id: line.id, line_no: line.line_no, source: line.source,
      offer_id: line.offer_id, price_id: line.price_id || null, product_title: line.product_title,
      price_basis: line.price_basis, base_amount: Number(line.base_amount),
      discount_amount: Number(line.discount_amount), amount: Number(line.payment_amount),
      status: line.status, player_id: line.player_id || null, server_id: line.server_id || null,
      recipient: line.recipient || null, email: line.email || null,
    })),
  }
}

async function loadCart(clientId, cartId) {
  if (!uuid(cartId)) return null
  const [cartResult, linesResult] = await Promise.all([
    supabase.from('store_cart_orders').select('*').eq('id', cartId).eq('client_id', clientId).maybeSingle(),
    supabase.from('store_cart_items').select('*').eq('cart_id', cartId).eq('client_id', clientId).order('line_no', { ascending: true }),
  ])
  if (cartResult.error) throw cartResult.error
  if (linesResult.error) throw linesResult.error
  return cartResult.data ? publicCart(cartResult.data, linesResult.data || []) : null
}

async function assertNoExistingTicket(clientId) {
  const [etecsa, games, topups] = await Promise.all([
    supabase.from('etecsa_orders').select('id,status,payment_deadline_at').eq('client_id', clientId).in('status', ['WAITING_PAYMENT']).order('created_at', { ascending: false }).limit(3),
    supabase.from('game_recharge_orders').select('id,status,payment_deadline_at').eq('client_id', clientId).in('status', ['WAITING_PAYMENT']).order('created_at', { ascending: false }).limit(3),
    supabase.from('store_wallet_topups').select('id,status,payment_deadline_at').eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').order('created_at', { ascending: false }).limit(3),
  ])
  for (const r of [etecsa, games, topups]) if (r.error) throw r.error
  for (const [source, r] of [['ETECSA', etecsa], ['GAME_MARKET', games], ['WALLET_TOPUP', topups]]) {
    const pending = (r.data || []).find(row => !row.payment_deadline_at || Date.now() <= Date.parse(row.payment_deadline_at))
    if (pending) throw Object.assign(err('Ya tienes un pago pendiente. Complétalo o cancélalo antes de crear un carrito.', 409, 'CHECKOUT_ACTIVE'), { order: { id: pending.id, status: pending.status, source } })
  }
  await assertNoWaitingCart(clientId)
}

async function validateCartItems(rawItems, paymentMethod, basis) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 25) throw err('Añade entre 1 y 25 ofertas al carrito.', 400, 'CART_ITEM_COUNT_INVALID')
  const lines = []
  const etecsaCatalog = rawItems.some(item => String(item?.source || '').toUpperCase() === 'ETECSA') ? await getCatalogResponse() : null
  for (let index = 0; index < rawItems.length; index++) {
    const input = rawItems[index] || {}
    const source = String(input.source || '').trim().toUpperCase()
    const offerId = clean(input.offer_id, 100)
    if (!offerId || !['GAME_MARKET', 'ETECSA'].includes(source)) throw err('Una oferta del carrito no es válida. Actualiza el catálogo.', 400, 'CART_ITEM_INVALID')
    if (paymentMethod === 'WALLET' && source !== 'GAME_MARKET') throw err('Las compras ETECSA no admiten pago con Wallet en este momento. Usa transferencia CUP.', 400, 'CART_WALLET_UNSUPPORTED_ITEM')
    if (paymentMethod === 'TRANSFERMOVIL' && basis !== 'CUP') throw err('Las transferencias del carrito se liquidan únicamente en CUP.', 400, 'CART_TRANSFER_CUP_ONLY')
    if (source === 'GAME_MARKET') {
      const offer = await getProviderOffer(offerId)
      const amount = Number(basis === 'SALDO' ? offer.price_saldo : offer.price_cup)
      if (!Number.isSafeInteger(amount) || amount <= 0) throw err('El precio de una oferta ya no está disponible. Actualiza el catálogo.', 409, 'CART_PRICE_UNAVAILABLE')
      const playerId = clean(input.player_id, 200) || null
      const serverId = clean(input.server_id, 200) || null
      if (offer.provider_delivery === 'player_id' && !playerId) throw err(`Introduce el ID de jugador para ${clean(offer.title, 100)}.`, 400, 'PLAYER_ID_REQUIRED')
      if (offer.provider_delivery === 'player_id' && /mobile[-_ ]?legends/i.test(String(offer.provider_game_slug || '')) && !serverId) throw err(`Introduce el ID de servidor para ${clean(offer.title, 100)}.`, 400, 'SERVER_ID_REQUIRED')
      const providerMeta = offer.package_data?.rechargegames || {}
      const providerCost = Number(providerMeta.provider_price_usdt ?? offer.base_cost_usd)
      if (!Number.isFinite(providerCost) || providerCost <= 0) throw err('El precio de una oferta se está actualizando. Inténtalo más tarde.', 409, 'PROVIDER_PRICE_UNAVAILABLE')
      lines.push({ id: crypto.randomUUID(), child_order_id: crypto.randomUUID(), line_no: index + 1, source,
        offer_id: offer.id, price_id: null, product_title: clean(offer.title, 120) || clean(offer.game_name, 100), price_basis: basis,
        base_amount: amount, discount_amount: 0, payment_amount: amount,
        player_id: playerId, server_id: serverId, recipient: null, recipient_name: null, email: null,
        product_snapshot: { game_name: offer.game_name, offer_title: offer.title, provider_product_key: offer.provider_product_key,
          provider_product_name: providerMeta.product_name || offer.title, provider_game_slug: offer.provider_game_slug || providerMeta.game_slug,
          provider_region_slug: offer.provider_region_slug || providerMeta.region_slug || null,
          provider_region_name: offer.provider_region_name || providerMeta.region_name || null,
          provider_delivery: offer.provider_delivery || providerMeta.delivery, provider_kind: providerMeta.provider_kind || 'topup',
          provider_cost_usdt: providerCost, package_data: providerMeta },
      })
    } else {
      if (basis !== 'CUP') throw err('Las ofertas ETECSA de este carrito deben pagarse en CUP.', 400, 'CART_ETECSA_CUP_ONLY')
      const offer = (etecsaCatalog?.offers || []).find(item => String(item.id) === offerId)
      const priceId = clean(input.price_id, 100)
      const price = offer?.prices?.find(item => String(item.price_id || '') === priceId)
      if (!offer || !price || !['recharge', 'nauta'].includes(String(offer.type || '').toLowerCase())) throw err('Una oferta ETECSA ya no está disponible. Actualiza el catálogo.', 409, 'ETECSA_OFFER_UNAVAILABLE')
      const amount = Number(price.price_cup)
      if (!Number.isSafeInteger(amount) || amount <= 0) throw err('El precio ETECSA seleccionado no es válido.', 409, 'ETECSA_INVALID_PRICE')
      const required = Array.isArray(offer.required_inputs) ? offer.required_inputs : ['recipient']
      const recipient = clean(input.recipient, 191) || null
      const recipientName = clean(input.recipient_name, 255) || null
      const email = clean(input.email, 254).toLowerCase() || null
      if (required.includes('recipient') && !recipient) throw err('Introduce el número o la cuenta que recibirá la recarga.', 400, 'RECIPIENT_REQUIRED')
      if (String(offer.type).toLowerCase() === 'recharge' && recipient && !/^5\d{7}$/.test(phone(recipient))) throw err('El número de destino debe tener 8 dígitos y comenzar por 5.', 400, 'INVALID_RECIPIENT_PHONE')
      if (required.includes('recipient_name') && !recipientName) throw err('Introduce el nombre del destinatario.', 400, 'RECIPIENT_NAME_REQUIRED')
      if ((offer.has_email === true || required.includes('email')) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw err('Introduce un correo electrónico válido.', 400, 'INVALID_EMAIL')
      if (String(offer.type).toLowerCase() === 'nauta' && (offer.has_email === true || required.includes('email')) && !String(email || '').endsWith('@nauta.com.cu')) throw err('Introduce una cuenta terminada en @nauta.com.cu.', 400, 'INVALID_NAUTA_EMAIL')
      if (recipient && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('El correo electrónico no es válido.', 400, 'INVALID_EMAIL')
      lines.push({ id: crypto.randomUUID(), child_order_id: crypto.randomUUID(), line_no: index + 1, source,
        offer_id: offerId, price_id: priceId, product_title: clean(offer.name, 180) || 'Oferta ETECSA', price_basis: 'CUP',
        base_amount: amount, discount_amount: 0, payment_amount: amount, player_id: null, server_id: null,
        recipient, recipient_name: recipientName, email,
        product_snapshot: { offer_name: offer.name, offer_type: String(offer.type).toLowerCase(), price_label: price.label,
          required_inputs: required, has_email: offer.has_email === true, is_preorder: offer.is_preorder === true },
      })
    }
  }
  return lines
}

function allocateDiscount(lines, quote) {
  const total = lines.reduce((sum, line) => sum + line.base_amount, 0)
  const discount = Number(quote.discountAmount || 0)
  if (discount <= 0) return lines.map(line => ({ ...line, discount_amount: 0, payment_amount: line.base_amount }))
  // Largest-remainder allocation ensures per-line integer CUP values sum exactly to the authoritative parent total.
  const parts = lines.map(line => {
    const exact = discount * line.base_amount / total
    return { ...line, discount_amount: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let leftover = discount - parts.reduce((sum, line) => sum + line.discount_amount, 0)
  parts.slice().sort((a, b) => b.remainder - a.remainder || a.line_no - b.line_no).forEach(line => {
    if (leftover > 0) { const target = parts.find(p => p.id === line.id); target.discount_amount += 1; leftover -= 1 }
  })
  const allocated = parts.map(({ remainder, ...line }) => ({ ...line, payment_amount: line.base_amount - line.discount_amount }))
  if (allocated.some(line => line.payment_amount <= 0)) throw err('El descuento dejaría una oferta con importe cero. Elige un cupón menor.', 400, 'CART_DISCOUNT_TOO_LARGE')
  return allocated
}

async function releaseCartQuote(clientId, cartId, quote) {
  await releaseDiscount(clientId, { couponId: quote?.couponId || null, welcomeDiscount: quote?.welcomeDiscount === true }, `CART:${cartId}`).catch(() => {})
}

async function createCartOrder(client, body) {
  if (!(await cartFeatureAvailable())) throw err('El carrito está temporalmente no disponible.', 503, 'CART_NOT_ENABLED')
  const paymentMethod = String(body?.payment_method || '').trim().toUpperCase()
  const basis = String(body?.price_basis || 'CUP').trim().toUpperCase()
  const idem = clean(body?.idempotency_key, 128)
  const couponCode = clean(body?.coupon_code, 64)
  if (!['WALLET', 'TRANSFERMOVIL'].includes(paymentMethod)) throw err('Selecciona un método de pago válido.', 400, 'CART_PAYMENT_METHOD_INVALID')
  if (!['CUP', 'SALDO'].includes(basis)) throw err('Selecciona CUP o Saldo Móvil.', 400, 'CART_CURRENCY_INVALID')
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idem)) throw err('No se pudo verificar el intento de compra. Vuelve a intentarlo.', 400, 'INVALID_IDEMPOTENCY_KEY')
  if (paymentMethod === 'TRANSFERMOVIL' && basis !== 'CUP') throw err('Las transferencias del carrito se liquidan únicamente en CUP.', 400, 'CART_TRANSFER_CUP_ONLY')
  const items = await validateCartItems(body?.items, paymentMethod, basis)
  const payerCandidate = paymentMethod === 'TRANSFERMOVIL' ? phone(body?.payer_phone) : null
  if (paymentMethod === 'TRANSFERMOVIL' && !/^5\d{7}$/.test(payerCandidate || '')) throw err('Introduce el móvil cubano desde el que realizarás la transferencia.', 400, 'INVALID_PAYER_PHONE')
  const requestShape = { payment_method: paymentMethod, price_basis: basis, coupon_code: couponCode.toUpperCase(), payer_phone: payerCandidate, items: items.map(x => ({ source: x.source, offer_id: x.offer_id, price_id: x.price_id, player_id: x.player_id, server_id: x.server_id, recipient: x.recipient, recipient_name: x.recipient_name, email: x.email })) }
  const fingerprint = hash(requestShape)
  // For both transfer and Wallet, a lost HTTP response may be retried with the same key.
  // Return the original cart instead of opening a second ticket or reserving twice.
  const { data: priorCartRow, error: priorCartError } = await supabase.from('store_cart_orders').select('id,request_fingerprint')
    .eq('client_id', client.id).eq('idempotency_key', idem).maybeSingle()
  if (priorCartError) throw priorCartError
  if (priorCartRow) {
    if (priorCartRow.request_fingerprint !== fingerprint) throw err('Este intento ya está vinculado a otro carrito.', 409, 'IDEMPOTENCY_KEY_REUSED')
    const prior = await loadCart(client.id, priorCartRow.id)
    if (!prior) throw err('No se pudo recuperar el carrito anterior. No vuelvas a pagar; contacta con soporte.', 409, 'IDEMPOTENT_CART_UNAVAILABLE')
    return prior
  }
  // Wallet retries also cross-check its ledger reference in case an old order exists without its cart row.
  if (paymentMethod === 'WALLET') {
    const { data: priorTx, error: priorError } = await supabase.from('store_wallet_transactions').select('reference_type,reference_id,currency')
      .eq('client_id', client.id).eq('idempotency_key', idem).maybeSingle()
    if (priorError) throw priorError
    if (priorTx) {
      if (priorTx.reference_type !== 'STORE_CART' || priorTx.currency !== basis) throw err('Este intento ya se utilizó. Inicia una nueva compra.', 409, 'IDEMPOTENCY_KEY_REUSED')
      const prior = await loadCart(client.id, priorTx.reference_id)
      if (!prior) throw err('La compra anterior requiere revisión. No se volvió a cobrar.', 409, 'IDEMPOTENT_CART_UNAVAILABLE')
      const { data: rawCart, error: rawError } = await supabase.from('store_cart_orders').select('request_fingerprint').eq('id', priorTx.reference_id).maybeSingle()
      if (rawError) throw rawError
      if (rawCart?.request_fingerprint !== fingerprint) throw err('Este intento ya está vinculado a otro carrito.', 409, 'IDEMPOTENCY_KEY_REUSED')
      return prior
    }
  }
  await assertNoExistingTicket(client.id)
  const subtotal = items.reduce((sum, line) => sum + line.base_amount, 0)
  const quote = await calculateDiscount(client, { amount: subtotal, currency: basis, couponCode, source: 'CART' })
  const lines = allocateDiscount(items, quote)
  if (lines.some(line => line.payment_amount <= 0)) throw err('El descuento deja una oferta sin importe positivo.', 400, 'CART_DISCOUNT_TOO_LARGE')
  const id = crypto.randomUUID()
  const orderRef = `CART:${id}`
  let walletDebitCommitted = false
  let walletOutcomeUnknown = false
  let walletRpcAttempted = false
  const createdAt = new Date()
  const deadline = new Date(createdAt.getTime() + TRANSFER_WINDOW_MS)
  let payerPhone = null
  let paymentConfig = null
  if (paymentMethod === 'TRANSFERMOVIL') {
    const automation = await getAutomationAvailability()
    if (!automation.enabled) throw err(automation.message || 'Los pagos automáticos están temporalmente desactivados.', 503, 'AUTOMATION_UNAVAILABLE')
    paymentConfig = getLicenseConfig()
    if (!paymentConfig.configured || paymentConfig.currency !== 'CUP') throw err('El pago automático no está configurado. Inténtalo más tarde.', 503, 'PAYMENT_CONFIG_MISSING')
    payerPhone = payerCandidate
  } else if (basis === 'SALDO' && couponCode) {
    throw err('Los cupones y descuentos solo se aplican a precios en CUP.', 400, 'COUPON_CUP_ONLY')
  }

  const reserved = await reserveDiscount(client.id, quote, orderRef)
  if (!reserved) throw err('El cupón acaba de utilizarse en otra compra. Actualiza tus cupones e inténtalo de nuevo.', 409, 'COUPON_RESERVATION_FAILED')

  const parent = {
    id, client_id: client.id, idempotency_key: idem, request_fingerprint: fingerprint,
    payment_source: paymentMethod, price_basis: basis, item_count: lines.length,
    base_subtotal: subtotal, discount_percent: Number(quote.discountPercent || 0), discount_amount: Number(quote.discountAmount || 0),
    payment_amount: Number(quote.finalAmount), reward_coupon_id: quote.couponId || null, welcome_discount: quote.welcomeDiscount === true,
    updated_at: createdAt.toISOString(), created_at: createdAt.toISOString(),
  }
  if (paymentMethod === 'TRANSFERMOVIL') Object.assign(parent, {
    status: 'BUILDING_CART', payer_phone: payerPhone, destination_card: paymentConfig.paymentCard,
    confirmation_phone: paymentConfig.paymentPhone, payment_deadline_at: deadline.toISOString(),
  })

  try {
    if (paymentMethod === 'TRANSFERMOVIL') {
      const { error: insertError } = await supabase.from('store_cart_orders').insert(parent)
      if (insertError) throw insertError
      const itemPayload = lines.map(line => ({
        id: line.id, cart_id: id, client_id: client.id, line_no: line.line_no, source: line.source, offer_id: line.offer_id,
        price_id: line.price_id, product_title: line.product_title, price_basis: line.price_basis,
        base_amount: line.base_amount, discount_amount: line.discount_amount, payment_amount: line.payment_amount,
        product_snapshot: line.product_snapshot, player_id: line.player_id, server_id: line.server_id,
        recipient: line.recipient, recipient_name: line.recipient_name, email: line.email, child_order_id: line.child_order_id,
      }))
      const { error: linesError } = await supabase.from('store_cart_items').insert(itemPayload)
      if (linesError) throw linesError
      const { data: ready, error: readyError } = await supabase.from('store_cart_orders').update({ status: 'WAITING_PAYMENT', updated_at: nowIso() })
        .eq('id', id).eq('client_id', client.id).eq('status', 'BUILDING_CART').select('*').single()
      if (readyError) throw readyError
      return await loadCart(client.id, ready.id)
    }

    const walletItems = lines.map(line => ({
      id: line.id, child_order_id: line.child_order_id, line_no: line.line_no, source: line.source, offer_id: line.offer_id,
      price_id: line.price_id, product_title: line.product_title, price_basis: line.price_basis,
      base_amount: line.base_amount, discount_amount: line.discount_amount, payment_amount: line.payment_amount,
      product_snapshot: line.product_snapshot, player_id: line.player_id, server_id: line.server_id,
      recipient: line.recipient, recipient_name: line.recipient_name, email: line.email,
    }))
    const rpcCart = { id, request_fingerprint: fingerprint, payment_source: 'WALLET', price_basis: basis, item_count: lines.length,
      base_subtotal: subtotal, discount_percent: Number(quote.discountPercent || 0), discount_amount: Number(quote.discountAmount || 0),
      payment_amount: Number(quote.finalAmount), reward_coupon_id: quote.couponId || '', welcome_discount: quote.welcomeDiscount === true }
    walletRpcAttempted = true
    const { data: rpcData, error: rpcError } = await supabase.rpc('store_wallet_create_cart_order', {
      p_client_id: client.id, p_amount: Number(quote.finalAmount), p_currency: basis, p_cart: rpcCart, p_items: walletItems, p_idempotency_key: idem,
    })
    let walletResult = rpcData
    if (rpcError) {
      // A network/proxy timeout can obscure a successful database commit. Consult the
      // idempotency records before telling a production customer the debit failed.
      const [persistedCart, persistedTx] = await Promise.all([
        supabase.from('store_cart_orders').select('id,request_fingerprint').eq('client_id', client.id).eq('idempotency_key', idem).maybeSingle(),
        supabase.from('store_wallet_transactions').select('reference_type,reference_id,currency').eq('client_id', client.id).eq('idempotency_key', idem).maybeSingle(),
      ])
      if (persistedCart.error || persistedTx.error) {
        walletOutcomeUnknown = true
        throw err('No pudimos confirmar el resultado del pago. No vuelvas a pagar ni generes otro pedido; conserva este intento y consulta el estado de la Wallet.', 503, 'CART_PAYMENT_STATUS_UNKNOWN')
      }
      if (persistedCart.data || persistedTx.data) {
        if (!persistedCart.data || !persistedTx.data || persistedTx.data.reference_type !== 'STORE_CART' ||
            persistedTx.data.currency !== basis || persistedTx.data.reference_id !== persistedCart.data.id ||
            persistedCart.data.request_fingerprint !== fingerprint) {
          walletOutcomeUnknown = true
          throw err('El pago necesita una comprobación de seguridad. No vuelvas a pagar; contacta con soporte.', 503, 'CART_PAYMENT_STATUS_REVIEW')
        }
        walletResult = { cart: persistedCart.data, already_processed: true }
      } else {
        if (String(rpcError.message || '').includes('INSUFFICIENT_WALLET_BALANCE')) throw err(`No tienes suficiente saldo ${basis === 'SALDO' ? 'móvil' : 'CUP'} en Wallet.`, 409, 'INSUFFICIENT_WALLET_BALANCE')
        throw rpcError
      }
    }
    const created = walletResult?.cart || walletResult
    // The RPC commits the debit and parent/line records atomically. From this point on,
    // an operational delivery error must never release the coupon or pretend the debit rolled back.
    walletDebitCommitted = true
    try { await fulfillCartOrder(id) } catch (fulfillError) {
      console.error(JSON.stringify({ event: 'CART_WALLET_FULFILLMENT_DEFERRED', cart_id: id, code: fulfillError?.code || 'FULFILLMENT_ERROR' }))
    }
    const final = await loadCart(client.id, created.id || id)
    return final
  } catch (error) {
    if (walletDebitCommitted) {
      // The debit already committed. Never report a checkout rollback or release its reward.
      console.error(JSON.stringify({ event: 'CART_WALLET_POST_DEBIT_ERROR', cart_id: id, code: error?.code || 'POST_DEBIT_ERROR' }))
      const persisted = await loadCart(client.id, id).catch(() => null)
      if (persisted) return persisted
      throw err('El pago se registró, pero estamos recuperando el estado de las entregas. No vuelvas a pagar; consulta el ticket de compra.', 503, 'CART_PAYMENT_ACCEPTED_RECOVERY_PENDING')
    }
    if (walletOutcomeUnknown || (walletRpcAttempted && !walletDebitCommitted && error?.code === 'CART_PAYMENT_STATUS_UNKNOWN')) {
      // Keep the reservation temporarily to avoid reissuing a coupon if SQL actually committed.
      throw error
    }
    if (paymentMethod === 'TRANSFERMOVIL') {
      await supabase.from('store_cart_orders').update({ status: 'CANCELED', failure_reason: 'CART_CREATE_FAILED', updated_at: nowIso() }).eq('id', id).in('status', ['BUILDING_CART', 'WAITING_PAYMENT']).catch(() => {})
    }
    await releaseCartQuote(client.id, id, quote)
    throw error
  }
}

async function getCartOrder(clientId, cartId) { return loadCart(clientId, cartId) }

async function cancelCartOrder(clientId, cartId) {
  const { data: existing, error } = await supabase.from('store_cart_orders').select('*').eq('id', cartId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!existing) throw err('No se encontró este carrito.', 404, 'CART_NOT_FOUND')
  if (existing.status !== 'WAITING_PAYMENT') throw err('Solo puedes cancelar un carrito que todavía espera el pago.', 409, 'CART_CANNOT_CANCEL')
  const { data, error: updateError } = await supabase.from('store_cart_orders').update({ status: 'CANCELED', updated_at: nowIso() })
    .eq('id', cartId).eq('client_id', clientId).eq('status', 'WAITING_PAYMENT').select('*').maybeSingle()
  if (updateError) throw updateError
  if (!data) throw err('El carrito cambió de estado y no se pudo cancelar.', 409, 'CART_STATE_CHANGED')
  await releaseCartQuote(clientId, cartId, { couponId: data.reward_coupon_id, welcomeDiscount: data.welcome_discount })
  return await loadCart(clientId, cartId)
}

async function getMatchedLegacyTickets({ client, parsed, receivedAt, isDestinationReceipt, cutoff }) {
  const [etecsa, games, topups] = await Promise.all([
    readAllRows(() => supabase.from('etecsa_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }), { pageSize: 500, maxRows: 100_000 }),
    readAllRows(() => supabase.from('game_recharge_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }), { pageSize: 500, maxRows: 100_000 }),
    readAllRows(() => supabase.from('store_wallet_topups').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false }), { pageSize: 500, maxRows: 100_000 }),
  ])
  for (const result of [etecsa, games, topups]) if (result?.error) throw result.error
  const matches = []
  for (const row of etecsa.data || []) if ((!isDestinationReceipt || isConfiguredPaymentReceiver(client, row)) && (isDestinationReceipt || row.client_id === client.id) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, row, receivedAt).matched) matches.push('ETECSA')
  for (const row of games.data || []) if ((!isDestinationReceipt || isConfiguredPaymentReceiver(client, row)) && (isDestinationReceipt || row.client_id === client.id) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, row, receivedAt).matched) matches.push('GAMEMARKET')
  for (const row of topups.data || []) if ((!isDestinationReceipt || isConfiguredPaymentReceiver(client, row)) && (isDestinationReceipt || row.client_id === client.id) && !(row.status === 'EXPIRED' && !parsed?.transaction_at) && evaluateOfficialStorePayment(parsed, { ...row, payment_amount: row.amount_cup, destination_card: row.destination_card || row.card_number }, receivedAt).matched) matches.push('WALLET_TOPUP')
  return matches
}

async function processIncomingTransfer({ client, parsed, receivedAt, smsLogId }) {
  if (!(await cartFeatureAvailable())) return null
  const direction = String(parsed?.direction || '').toUpperCase()
  const network = String(parsed?.network || '').toUpperCase()
  const type = String(parsed?.type || '').toUpperCase()
  if (!['RECIBIDO', 'ENVIADO'].includes(direction) || network !== 'PAGOMOVIL' || String(parsed?.currency || '').toUpperCase() !== 'CUP' || !['TARJETA_TARJETA', 'MONEDERO_TARJETA'].includes(type)) return null
  const isDestinationReceipt = direction === 'RECIBIDO'
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  const buildQuery = () => {
    let q = supabase.from('store_cart_orders').select('*').in('status', ['WAITING_PAYMENT', 'EXPIRED']).gte('created_at', cutoff).order('created_at', { ascending: false })
    if (!isDestinationReceipt) q = q.eq('client_id', client.id)
    return q
  }
  const candidates = await readAllRows(buildQuery, { pageSize: 500, maxRows: 100_000 })
  const matches = []
  for (const row of candidates || []) {
    if (isDestinationReceipt && !isConfiguredPaymentReceiver(client, row)) continue
    if (row.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const evaluation = evaluateOfficialStorePayment(parsed, row, receivedAt)
    if (evaluation.matched) matches.push({ row, evaluation })
  }
  if (!matches.length) return null
  if (matches.length !== 1) {
    console.warn(JSON.stringify({ event: 'CART_PAYMENT_MATCH_AMBIGUOUS', count: matches.length }))
    return { ambiguous: true, reason: 'MULTIPLE_CARTS' }
  }
  const { row, evaluation } = matches[0]
  // Before claiming a transaction, ensure it cannot also pay a legacy ticket. If the
  // database cannot answer the cross-check, leave all tickets pending for manual review.
  let legacyMatches
  try { legacyMatches = await getMatchedLegacyTickets({ client, parsed, receivedAt, isDestinationReceipt, cutoff }) }
  catch (error) {
    console.error(JSON.stringify({ event: 'CART_CROSSCHECK_FAILED', code: error?.code || 'DB_ERROR' }))
    return { ambiguous: true, reason: 'LEGACY_CROSSCHECK_UNAVAILABLE' }
  }
  if (legacyMatches.length) {
    console.warn(JSON.stringify({ event: 'CART_PAYMENT_MATCH_AMBIGUOUS', legacy_sources: legacyMatches }))
    return { ambiguous: true, reason: 'LEGACY_TICKET_MATCH' }
  }
  const transactionId = String(parsed?.transaction_id || '').slice(0, 120)
  if (transactionId) {
    const [oldCart, oldEtecsa, oldGame, oldTopup] = await Promise.all([
      supabase.from('store_cart_orders').select('id').eq('payment_transaction_id', transactionId).maybeSingle(),
      supabase.from('etecsa_orders').select('id').eq('payment_transaction_id', transactionId).maybeSingle(),
      supabase.from('game_recharge_orders').select('id').eq('payment_transaction_id', transactionId).maybeSingle(),
      supabase.from('store_wallet_topups').select('id').eq('payment_transaction_id', transactionId).maybeSingle(),
    ])
    for (const r of [oldCart, oldEtecsa, oldGame, oldTopup]) if (r.error) return { ambiguous: true, reason: 'TRANSACTION_LOOKUP_FAILED' }
    if (oldCart.data || oldEtecsa.data || oldGame.data || oldTopup.data) return { ambiguous: true, reason: 'TRANSACTION_ALREADY_USED' }
  }
  const { data: settlement, error: settlementError } = await supabase.rpc('store_claim_cart_payment', {
    p_cart_id: row.id, p_transaction_id: transactionId || null,
    p_sms_log_id: smsLogId ? String(smsLogId).slice(0, 120) : null,
    p_transaction_at: evaluation.transaction_at || null,
  })
  if (settlementError) throw settlementError
  if (settlement?.claimed !== true) {
    console.warn(JSON.stringify({ event: 'CART_PAYMENT_SETTLEMENT_REJECTED', cart_id: row.id, reason: settlement?.reason || 'UNKNOWN' }))
    return { ambiguous: true, reason: settlement?.reason || 'CART_SETTLEMENT_REJECTED' }
  }
  if (settlement?.already_paid === true) {
    try { await fulfillCartOrder(row.id) } catch (error) {
      console.error(JSON.stringify({ event: 'CART_POST_PAYMENT_RECOVERY_PENDING', cart_id: row.id, code: error?.code || 'FULFILLMENT_ERROR' }))
    }
    return { cart_id: row.id, order_id: row.id, ticket: ticket(row.id), status: settlement.cart?.status || 'PROCESSING', already_processed: true }
  }
  // Payment acceptance is authoritative. Reward bookkeeping and fulfilment recovery are
  // handled independently after the parent is committed; neither may reverse a valid payment.
  try { await fulfillCartOrder(row.id) } catch (fulfillmentError) {
    console.error(JSON.stringify({ event: 'CART_POST_PAYMENT_RECOVERY_PENDING', cart_id: row.id, code: fulfillmentError?.code || 'FULFILLMENT_ERROR' }))
  }
  return { cart_id: row.id, order_id: row.id, ticket: ticket(row.id), status: 'PROCESSING' }
}

async function tryRefundWalletCartLine(cart, line, childOrder) {
  if (String(cart?.payment_source || '').toUpperCase() !== 'WALLET' || String(line?.source || '').toUpperCase() !== 'GAME_MARKET') return false
  const status = String(childOrder?.status || '').toUpperCase()
  if (!['REFUND_REQUIRED', 'FAILED'].includes(status)) return false
  try {
    const { data, error } = await supabase.rpc('store_wallet_refund_cart_item', { p_cart_item_id: line.id })
    if (error) {
      console.error(JSON.stringify({ event: 'CART_WALLET_LINE_REFUND_DEFERRED', cart_id: cart.id, line_id: line.id, code: error.code || 'REFUND_FAILED' }))
      return false
    }
    return String(data?.status || '').toUpperCase() === 'REFUNDED'
  } catch (error) {
    console.error(JSON.stringify({ event: 'CART_WALLET_LINE_REFUND_DEFERRED', cart_id: cart.id, line_id: line.id, code: error?.code || 'REFUND_FAILED' }))
    return false
  }
}

async function fulfillCartOrder(cartId) {
  const { data: cart, error: cartError } = await supabase.from('store_cart_orders').select('*').eq('id', cartId).maybeSingle()
  if (cartError) throw cartError
  if (!cart || !['PROCESSING', 'FULFILLMENT_REVIEW'].includes(cart.status)) return cart
  const { data: lines, error: linesError } = await supabase.from('store_cart_items').select('*').eq('cart_id', cartId).order('line_no', { ascending: true })
  if (linesError) throw linesError
  // Do not record mission progress yet: Wallet-funded child lines may still require an
  // idempotent per-line refund. Reward events are finalized after line states are known.
  const next = []
  for (const line of lines || []) {
    try {
      if (['COMPLETED', 'REFUNDED'].includes(line.status)) { next.push(line); continue }
      if (line.source === 'GAME_MARKET') {
        let child = await supabase.from('game_recharge_orders').select('*').eq('id', line.child_order_id).maybeSingle()
        if (child.error) throw child.error
        const snapshot = line.product_snapshot || {}
        if (child.data) {
          const existingStatus = String(child.data.status || '').toUpperCase()
          if (existingStatus === 'COMPLETED') {
            await supabase.from('store_cart_items').update({ status: 'COMPLETED', failure_reason: null, updated_at: nowIso() }).eq('id', line.id)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (!refreshed.error && refreshed.data) next.push(refreshed.data)
            continue
          }
          if (existingStatus === 'REFUNDED') {
            await supabase.from('store_cart_items').update({ status: 'REFUNDED', failure_reason: child.data.failure_reason || null, updated_at: nowIso() }).eq('id', line.id)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (!refreshed.error && refreshed.data) next.push(refreshed.data)
            continue
          }
          if (existingStatus === 'REFUND_REQUIRED' || existingStatus === 'FAILED') {
            const marked = await supabase.from('store_cart_items').update({ status: 'REFUND_REQUIRED', failure_reason: child.data.failure_reason || 'DELIVERY_FAILED', updated_at: nowIso() }).eq('id', line.id)
            if (marked.error) throw marked.error
            await tryRefundWalletCartLine(cart, line, child.data)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (refreshed.error) throw refreshed.error
            if (refreshed.data) next.push(refreshed.data)
            continue
          }
        }
        if (!child.data) {
          const payload = {
            id: line.child_order_id, client_id: cart.client_id, store_cart_id: cart.id, offer_id: line.offer_id,
            game_name: clean(snapshot.game_name, 100), offer_title: clean(snapshot.offer_title || line.product_title, 120),
            provider_product_key: snapshot.provider_product_key, provider_product_name: clean(snapshot.provider_product_name || line.product_title, 120),
            provider_game_slug: clean(snapshot.provider_game_slug, 160), provider_region_slug: snapshot.provider_region_slug || null,
            provider_region_name: snapshot.provider_region_name || null, provider_delivery: snapshot.provider_delivery,
            provider_kind: snapshot.provider_kind || 'topup', provider_cost_usdt: Number(snapshot.provider_cost_usdt),
            price_basis: cart.price_basis, payment_amount: line.payment_amount,
            payment_source: cart.payment_source === 'WALLET' ? 'WALLET' : 'TRANSFERMOVIL',
            payer_phone: cart.payer_phone || null, player_id: line.player_id || null, server_id: line.server_id || null,
            destination_card: cart.destination_card || null, confirmation_phone: cart.confirmation_phone || null,
            status: 'PAYMENT_RECEIVED_WAITING_DETAILS', buyer_ref: `SO-CART-${cart.id}-${line.line_no}`,
            paid_at: cart.paid_at || nowIso(), created_at: cart.created_at, updated_at: nowIso(),
          }
          const inserted = await supabase.from('game_recharge_orders').insert(payload).select('*').single()
          if (inserted.error && inserted.error.code !== '23505') throw inserted.error
          child = inserted.error ? await supabase.from('game_recharge_orders').select('*').eq('id', line.child_order_id).single() : inserted
          if (child.error) throw child.error
        }
        await submitProviderOrder(line.child_order_id, { playerId: line.player_id || null, serverId: line.server_id || null })
        child = await supabase.from('game_recharge_orders').select('*').eq('id', line.child_order_id).single()
        if (child.error) throw child.error
        const st = String(child.data.status || '').toUpperCase()
        const lineStatus = st === 'COMPLETED' ? 'COMPLETED' : st === 'REFUNDED' ? 'REFUNDED' : ['REFUND_REQUIRED', 'FAILED'].includes(st) ? 'REFUND_REQUIRED' : 'PROCESSING'
        const marked = await supabase.from('store_cart_items').update({ status: lineStatus, failure_reason: child.data.failure_reason || null, updated_at: nowIso() }).eq('id', line.id)
        if (marked.error) throw marked.error
        if (lineStatus === 'REFUND_REQUIRED') await tryRefundWalletCartLine(cart, { ...line, status: lineStatus }, child.data)
      } else if (line.source === 'ETECSA') {
        let child = await supabase.from('etecsa_orders').select('*').eq('id', line.child_order_id).maybeSingle()
        if (child.error) throw child.error
        const snapshot = line.product_snapshot || {}
        if (child.data) {
          const existingStatus = String(child.data.status || '').toUpperCase()
          if (existingStatus === 'COMPLETED') {
            await supabase.from('store_cart_items').update({ status: 'COMPLETED', failure_reason: null, updated_at: nowIso() }).eq('id', line.id)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (!refreshed.error && refreshed.data) next.push(refreshed.data)
            continue
          }
          if (existingStatus === 'REFUNDED') {
            await supabase.from('store_cart_items').update({ status: 'REFUNDED', failure_reason: child.data.failure_reason || null, updated_at: nowIso() }).eq('id', line.id)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (!refreshed.error && refreshed.data) next.push(refreshed.data)
            continue
          }
          if (existingStatus === 'REFUND_REQUIRED' || existingStatus === 'FAILED') {
            await supabase.from('store_cart_items').update({ status: 'REFUND_REQUIRED', failure_reason: child.data.failure_reason || 'DELIVERY_FAILED', updated_at: nowIso() }).eq('id', line.id)
            const refreshed = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
            if (!refreshed.error && refreshed.data) next.push(refreshed.data)
            continue
          }
        }
        if (!child.data) {
          const payload = {
            id: line.child_order_id, client_id: cart.client_id, store_cart_id: cart.id,
            offer_id: line.offer_id, price_id: line.price_id, offer_name: clean(snapshot.offer_name || line.product_title, 180),
            offer_type: snapshot.offer_type || 'recharge', price_label: clean(snapshot.price_label, 120),
            price_basis: 'CUP', payment_amount: line.payment_amount, payer_phone: cart.payer_phone,
            destination_card: cart.destination_card, confirmation_phone: cart.confirmation_phone,
            status: 'PAYMENT_RECEIVED_WAITING_DETAILS', required_inputs: snapshot.required_inputs || ['recipient'],
            has_email: snapshot.has_email === true, is_preorder: snapshot.is_preorder === true,
            recipient: line.recipient || null, recipient_name: line.recipient_name || null, email: line.email || null,
            paid_at: cart.paid_at || nowIso(), payment_transaction_at: cart.payment_transaction_at || null,
            created_at: cart.created_at, updated_at: nowIso(), payment_deadline_at: cart.payment_deadline_at || nowIso(),
          }
          const inserted = await supabase.from('etecsa_orders').insert(payload).select('*').single()
          if (inserted.error && inserted.error.code !== '23505') throw inserted.error
          child = inserted.error ? await supabase.from('etecsa_orders').select('*').eq('id', line.child_order_id).single() : inserted
          if (child.error) throw child.error
        }
        if (['PAYMENT_RECEIVED_WAITING_DETAILS', 'FULFILLMENT_REVIEW'].includes(String(child.data.status || '').toUpperCase())) {
          await submitEtecsaRecipientDetails(cart.client_id, line.child_order_id, { recipient: line.recipient, recipient_name: line.recipient_name, email: line.email })
        }
        child = await supabase.from('etecsa_orders').select('*').eq('id', line.child_order_id).single()
        if (child.error) throw child.error
        const st = String(child.data.status || '').toUpperCase()
        await supabase.from('store_cart_items').update({ status: st === 'COMPLETED' ? 'COMPLETED' : st === 'REFUNDED' ? 'REFUNDED' : ['FAILED', 'CANCELED', 'REFUND_REQUIRED'].includes(st) ? 'REFUND_REQUIRED' : 'PROCESSING', failure_reason: child.data.failure_reason || null, updated_at: nowIso() }).eq('id', line.id)
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'CART_LINE_FULFILLMENT_FAILED', cart_id: cartId, line_id: line.id, source: line.source, code: error?.code || 'FULFILLMENT_ERROR' }))
      await supabase.from('store_cart_items').update({ status: 'FULFILLMENT_REVIEW', failure_reason: String(error?.code || error?.message || 'FULFILLMENT_ERROR').slice(0, 180), updated_at: nowIso() }).eq('id', line.id)
    }
    const { data: refreshedLine, error: refreshedError } = await supabase.from('store_cart_items').select('*').eq('id', line.id).single()
    if (!refreshedError && refreshedLine) next.push(refreshedLine)
  }
  await updateCartAggregate(cartId, next)
  const walletRefundPending = String(cart.payment_source || '').toUpperCase() === 'WALLET' && next.some(line => String(line.status || '').toUpperCase() === 'REFUND_REQUIRED')
  const terminalLines = next.every(line => ['COMPLETED', 'REFUNDED'].includes(String(line.status || '').toUpperCase()))
  if (!walletRefundPending && terminalLines) {
    const retainedLines = next.filter(line => String(line.status || '').toUpperCase() === 'COMPLETED')
    if (!retainedLines.length) {
      // A completely refunded Wallet cart must not consume a welcome discount/coupon
      // or count as a purchase for referral/mission rewards.
      await releaseDiscount(cart.client_id, { couponId: cart.reward_coupon_id, welcomeDiscount: cart.welcome_discount }, `CART:${cart.id}`).catch(() => {})
    } else {
      try {
        const { data: owner, error: ownerError } = await supabase.from('clients')
          .select('id,device_id,phone_number,active,role,expires_at,store_only').eq('id', cart.client_id).maybeSingle()
        if (ownerError) throw ownerError
        if (!owner) throw err('CART_OWNER_UNAVAILABLE', 503, 'CART_OWNER_UNAVAILABLE')
        const netSubtotal = retainedLines.reduce((sum, line) => sum + Number(line.base_amount || 0), 0)
        const netDiscount = retainedLines.reduce((sum, line) => sum + Number(line.discount_amount || 0), 0)
        const netPaid = retainedLines.reduce((sum, line) => sum + Number(line.payment_amount || 0), 0)
        await finalizePaidOrder(owner, { source: 'CART', order: {
          ...cart, payment_amount: netPaid, reward_base_amount: netSubtotal,
          reward_discount_amount: netDiscount, reward_discount_percent: netSubtotal > 0 ? Math.round(netDiscount / netSubtotal * 10000) / 100 : 0,
          // Collector task is about distinct offers, not duplicates of one offer.
          // Keep the parent order's item_count unchanged for receipts/accounting.
          reward_item_count: new Set(retainedLines.map(line => `${String(line.source || '').toUpperCase()}:${String(line.offer_id || '')}:${String(line.price_id || '')}`)).size,
          has_game_market: retainedLines.some(line => line.source === 'GAME_MARKET'),
          has_etecsa: retainedLines.some(line => line.source === 'ETECSA'),
        } })
      } catch (rewardError) {
        // Payment and delivery remain authoritative. The worker retries reward finalization.
        console.error(JSON.stringify({ event: 'CART_REWARD_RETRY_FAILED', cart_id: cartId, code: rewardError?.code || 'REWARD_ERROR' }))
      }
    }
  }
  const { data: finalCart, error: finalError } = await supabase.from('store_cart_orders').select('*').eq('id', cartId).single()
  if (finalError) throw finalError
  return finalCart
}

async function updateCartAggregate(cartId, lines = null) {
  let list = lines
  if (!list) {
    const r = await supabase.from('store_cart_items').select('status').eq('cart_id', cartId)
    if (r.error) throw r.error
    list = r.data || []
  }
  const statuses = list.map(row => String(row.status || '').toUpperCase())
  let status = 'PROCESSING'
  if (statuses.length && statuses.every(s => s === 'COMPLETED')) status = 'COMPLETED'
  else if (statuses.length && statuses.every(s => s === 'REFUNDED')) status = 'REFUNDED'
  else if (statuses.some(s => ['FULFILLMENT_REVIEW', 'REFUND_REQUIRED', 'REFUNDED'].includes(s))) status = 'FULFILLMENT_REVIEW'
  const { error } = await supabase.from('store_cart_orders').update({ status, updated_at: nowIso() }).eq('id', cartId).in('status', ['PROCESSING', 'FULFILLMENT_REVIEW'])
  if (error) throw error
}

async function cartWorkerTick() {
  if (!(await cartFeatureAvailable())) return
  const { data, error } = await supabase.from('store_cart_orders').select('id,status').in('status', ['PROCESSING', 'FULFILLMENT_REVIEW']).order('updated_at', { ascending: true }).limit(50)
  if (error) throw error
  for (const cart of data || []) {
    // Recovery is idempotent because child IDs are fixed at cart creation and provider
    // submission uses the existing child order's buyer_ref / idempotency semantics.
    await fulfillCartOrder(cart.id).catch(error => console.error(JSON.stringify({ event: 'CART_WORKER_FAILED', cart_id: cart.id, code: error?.code || 'WORKER_ERROR' })))
  }
}
function startStoreCartWorker() {
  if (workerStarted) return
  workerStarted = true
  setTimeout(() => cartWorkerTick().catch(() => {}), 20_000)
  setInterval(() => cartWorkerTick().catch(() => {}), 60_000)
}

async function getCartFeatureStatus() {
  const enabled = await cartFeatureAvailable()
  return { enabled: Boolean(enabled), status: enabled ? 'AVAILABLE' : 'UNAVAILABLE' }
}

module.exports = { createCartOrder, getCartOrder, cancelCartOrder, processIncomingTransfer, startStoreCartWorker, getCartFeatureStatus, ticket, publicCart }
