'use strict'

const crypto = require('crypto')
const supabase = require('../supabase')
const { bot, ADMINS } = require('../telegram')
const { getLicenseConfig, cardMatches } = require('./onboarding')
const { normalizePhone } = require('./parser')
const { getAutomationAvailability } = require('./systemSettings')
const { getCatalogResponse } = require('./etecsaCatalog')
const { normalizePayerPhone, evaluateEtecsaPayment } = require('./etecsaPaymentMatching')

const SOKY_API_BASE = 'https://api.sokyrecargas.com/api/v1'
const PAYMENT_WINDOW_MS = 30 * 60 * 1000
const CHECKOUT_LOCK_STATUSES = ['WAITING_PAYMENT']
let workerStarted = false

function nowIso() { return new Date().toISOString() }
function normalizeText(value, max = 300) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
function normalizeDestPhone(value) {
  const normalized = normalizePhone(String(value || '')) || ''
  return normalized.replace(/\D/g, '')
}
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')) }
function cleanProviderStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  return ['pending', 'completed', 'canceled'].includes(status) ? status : null
}
function orderIsBlocking(order) { return Boolean(order && CHECKOUT_LOCK_STATUSES.includes(order.status)) }

function publicOrder(order) {
  if (!order) return null
  const result = {
    id: order.id,
    ticket: `ET-${String(order.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    status: order.status,
    offer_id: order.offer_id,
    offer_name: order.offer_name,
    offer_type: order.offer_type,
    price_id: order.price_id,
    price_label: order.price_label,
    price_basis: order.price_basis,
    amount: Number(order.payment_amount),
    currency: 'CUP',
    payer_phone: order.payer_phone,
    created_at: order.created_at,
    payment_deadline_at: order.payment_deadline_at,
    paid_at: order.paid_at || null,
    updated_at: order.updated_at,
    provider_status: order.provider_status || null,
    provider_reference: order.provider_reference || null,
    recipient: order.recipient || null,
    email: order.email || null,
    requirements: {
      required_inputs: Array.isArray(order.required_inputs) ? order.required_inputs : ['recipient'],
      has_email: order.has_email === true,
      offer_type: order.offer_type,
    },
  }
  if (order.status === 'WAITING_PAYMENT') {
    result.payment = {
      card: order.destination_card,
      confirmation_phone: order.confirmation_phone,
    }
  }
  return result
}

async function notifyAdmins(text) {
  await Promise.all(ADMINS.map(id => bot.sendMessage(id, text).catch(error => {
    console.error('No se pudo notificar ticket ETECSA al administrador:', error.message)
  })))
}

async function expireOrderIfNeeded(order) {
  if (!order || order.status !== 'WAITING_PAYMENT' || !order.payment_deadline_at) return order
  if (Date.now() <= Date.parse(order.payment_deadline_at)) return order
  const { data, error } = await supabase.from('etecsa_orders')
    .update({ status: 'EXPIRED', updated_at: nowIso(), failure_reason: 'PAYMENT_WINDOW_EXPIRED' })
    .eq('id', order.id).eq('status', 'WAITING_PAYMENT')
    .select('*').maybeSingle()
  if (error) throw error
  return data || order
}

async function getCurrentOrder(clientId) {
  const { data: latest, error } = await supabase.from('etecsa_orders')
    .select('*').eq('client_id', clientId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const checked = await expireOrderIfNeeded(latest)
  return publicOrder(checked)
}

async function getRecentOrders(clientId) {
  const { data, error } = await supabase.from('etecsa_orders').select('*')
    .eq('client_id', clientId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  const orders = []
  for (const item of data || []) orders.push(publicOrder(await expireOrderIfNeeded(item)))
  return orders
}

async function getOwnedOrderPublic(clientId, orderId) {
  const order = await getOwnedOrder(clientId, orderId)
  if (!order) return null
  return publicOrder(await expireOrderIfNeeded(order))
}

async function findBlockingOrder(clientId) {
  const { data: orders, error } = await supabase.from('etecsa_orders')
    .select('*').eq('client_id', clientId)
    .in('status', CHECKOUT_LOCK_STATUSES)
    .order('created_at', { ascending: false }).limit(5)
  if (error) throw error
  for (const candidate of orders || []) {
    const checked = await expireOrderIfNeeded(candidate)
    if (orderIsBlocking(checked)) return checked
  }
  return null
}

async function getCheckoutConfig() {
  const licenseConfig = getLicenseConfig()
  const automation = await getAutomationAvailability()
  return {
    automation_enabled: automation.enabled,
    automation_message: automation.message,
    payment_configured: Boolean(licenseConfig.configured && licenseConfig.currency === 'CUP'),
    payment: licenseConfig.configured ? {
      card: licenseConfig.paymentCard,
      confirmation_phone: licenseConfig.paymentPhone,
      currency: 'CUP',
    } : null,
  }
}

async function createPaymentOrder(client, body) {
  const automation = await getAutomationAvailability()
  if (!automation.enabled) {
    const error = new Error(automation.message || 'Las automatizaciones están temporalmente desactivadas.')
    error.code = 'AUTOMATION_UNAVAILABLE'; error.status = 503; throw error
  }
  const paymentConfig = getLicenseConfig()
  if (!paymentConfig.configured || paymentConfig.currency !== 'CUP') {
    const error = new Error('El pago automático no está configurado. Inténtalo más tarde.')
    error.code = 'ETECSA_PAYMENT_CONFIG_MISSING'; error.status = 503; throw error
  }

  const active = await findBlockingOrder(client.id)
  if (active) {
    const error = new Error('Ya tienes una operación ETECSA en curso. Complétala o cancélala antes de empezar otra.')
    error.code = 'ETECSA_ORDER_ACTIVE'; error.status = 409; error.order = publicOrder(active); throw error
  }

  const offerId = normalizeText(body?.offer_id, 100)
  const priceId = normalizeText(body?.price_id, 100)
  const basis = String(body?.price_basis || '').trim().toUpperCase()
  const payerPhone = normalizePayerPhone(body?.payer_phone)
  if (!offerId || !priceId || !['CUP', 'SALDO'].includes(basis)) {
    const error = new Error('Selecciona una oferta y un precio válidos.')
    error.code = 'INVALID_OFFER_SELECTION'; error.status = 400; throw error
  }
  if (!/^5\d{7}$/.test(payerPhone)) {
    const error = new Error('Introduce el número móvil cubano desde el que realizarás la transferencia.')
    error.code = 'INVALID_PAYER_PHONE'; error.status = 400; throw error
  }

  const catalog = await getCatalogResponse()
  const offer = catalog.offers.find(item => String(item.id) === offerId)
  const price = offer?.prices?.find(item => String(item.price_id || '') === priceId)
  if (!offer || !price || !['recharge', 'nauta'].includes(String(offer.type || '').toLowerCase())) {
    const error = new Error('La oferta ya no está disponible. Actualiza el catálogo y vuelve a seleccionarla.')
    error.code = 'ETECSA_OFFER_UNAVAILABLE'; error.status = 409; throw error
  }
  const amount = basis === 'CUP' ? Number(price.price_cup) : Number(price.price_saldo)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    const error = new Error('El precio seleccionado no es válido. Vuelve a cargar el catálogo.')
    error.code = 'ETECSA_INVALID_PRICE'; error.status = 409; throw error
  }

  const createdAt = new Date()
  const deadline = new Date(createdAt.getTime() + PAYMENT_WINDOW_MS)
  const payload = {
    client_id: client.id,
    offer_id: offerId,
    price_id: priceId,
    offer_name: normalizeText(offer.name, 180) || 'Oferta ETECSA',
    offer_type: String(offer.type).toLowerCase(),
    price_label: normalizeText(price.label, 120),
    price_basis: basis,
    payment_amount: amount,
    payer_phone: payerPhone,
    destination_card: paymentConfig.paymentCard,
    confirmation_phone: paymentConfig.paymentPhone,
    status: 'WAITING_PAYMENT',
    required_inputs: Array.isArray(offer.required_inputs) ? offer.required_inputs : ['recipient'],
    has_email: offer.has_email === true,
    is_preorder: offer.is_preorder === true,
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    payment_deadline_at: deadline.toISOString(),
  }
  const { data: order, error } = await supabase.from('etecsa_orders').insert(payload).select('*').single()
  if (error) {
    if (error.code === '23505') {
      const blocking = await findBlockingOrder(client.id)
      const conflict = new Error('Ya tienes una operación ETECSA en curso. Complétala o cancélala antes de empezar otra.')
      conflict.code = 'ETECSA_ORDER_ACTIVE'; conflict.status = 409; conflict.order = publicOrder(blocking); throw conflict
    }
    throw error
  }
  notifyAdmins(`🧾 Ticket ETECSA creado · ${publicOrder(order).ticket}\nProducto: ${order.offer_name} · ${order.price_label}\nImporte: ${amount} CUP\nTarjeta destino: ${order.destination_card}\nTeléfono a confirmar: ${order.confirmation_phone}\nPagador: ${payerPhone}\nEstado: esperando pago`).catch(() => {})
  console.log(JSON.stringify({ ts: nowIso(), event: 'ETECSA_ORDER_CREATED', order_id: order.id, client_id: client.id, status: order.status, amount }))
  return publicOrder(order)
}

async function cancelPaymentOrder(clientId, orderId) {
  const { data: order, error } = await supabase.from('etecsa_orders')
    .select('*').eq('id', orderId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  if (!order) {
    const e = new Error('No se encontró esta operación.'); e.status = 404; e.code = 'ETECSA_ORDER_NOT_FOUND'; throw e
  }
  const checked = await expireOrderIfNeeded(order)
  if (checked.status !== 'WAITING_PAYMENT') {
    const e = new Error('Solo puedes cancelar una operación que todavía espera el pago.'); e.status = 409; e.code = 'ETECSA_ORDER_CANNOT_CANCEL'; throw e
  }
  const { data: updated, error: updateError } = await supabase.from('etecsa_orders')
    .update({ status: 'CANCELED', canceled_at: nowIso(), updated_at: nowIso() })
    .eq('id', orderId).eq('client_id', clientId).eq('status', 'WAITING_PAYMENT')
    .select('*').maybeSingle()
  if (updateError) throw updateError
  if (!updated) {
    const e = new Error('La operación cambió de estado y no se pudo cancelar.'); e.status = 409; e.code = 'ETECSA_ORDER_STATE_CHANGED'; throw e
  }
  return publicOrder(updated)
}

async function getOwnedOrder(clientId, orderId) {
  const { data, error } = await supabase.from('etecsa_orders').select('*')
    .eq('id', orderId).eq('client_id', clientId).maybeSingle()
  if (error) throw error
  return data || null
}

async function processIncomingTransfer({ client, parsed, receivedAt, smsLogId }) {
  const { data: candidates, error: candidateError } = await supabase.from('etecsa_orders')
    .select('*').eq('client_id', client.id)
    .in('status', ['WAITING_PAYMENT', 'EXPIRED'])
    .order('created_at', { ascending: false }).limit(12)
  if (candidateError) throw candidateError

  let order = null
  let evaluation = null
  for (const candidate of candidates || []) {
    // Once the UI ticket expired, auto-confirm only when Transfermóvil includes
    // its own transaction timestamp and it proves the transfer occurred within
    // the 30-minute window. Never infer an old payment from SMS arrival time.
    if (candidate.status === 'EXPIRED' && !parsed?.transaction_at) continue
    const candidateEvaluation = evaluateEtecsaPayment(parsed, candidate, receivedAt)
    if (candidateEvaluation.matched) {
      order = candidate
      evaluation = candidateEvaluation
      break
    }
    const potentiallyRelevant = ['AMOUNT_MISMATCH', 'DESTINATION_CARD_MISMATCH', 'PAYER_PHONE_MISMATCH', 'PAYER_PHONE_NOT_IN_SMS', 'PAYMENT_OUTSIDE_WINDOW']
    if (candidate.status === 'WAITING_PAYMENT' && Date.now() > Date.parse(candidate.payment_deadline_at || '') &&
        String(parsed?.direction).toUpperCase() === 'ENVIADO' &&
        Number(parsed?.amount) === Number(candidate.payment_amount) &&
        parsed?.receiver_account && cardMatches(parsed.receiver_account, candidate.destination_card) &&
        candidateEvaluation.reasons.every(reason => potentiallyRelevant.includes(reason))) {
      await expireOrderIfNeeded(candidate)
    }
  }
  if (!order || !evaluation) return null

  if (parsed?.transaction_id) {
    const { data: duplicate, error } = await supabase.from('etecsa_orders')
      .select('id').eq('payment_transaction_id', String(parsed.transaction_id)).maybeSingle()
    if (error) throw error
    if (duplicate) return null
  }
  const { data: updated, error } = await supabase.from('etecsa_orders')
    .update({
      status: 'PAYMENT_RECEIVED_WAITING_DETAILS',
      paid_at: nowIso(),
      payment_transaction_id: parsed.transaction_id ? String(parsed.transaction_id).slice(0, 120) : null,
      payment_sms_log_id: smsLogId ? String(smsLogId) : null,
      payment_transaction_at: evaluation.transaction_at,
      updated_at: nowIso(),
    })
    .eq('id', order.id).eq('status', order.status)
    .select('*').maybeSingle()
  if (error) {
    // A competing active ticket may have been created after this ticket expired.
    // Do not attach the payment to a different operation.
    if (error.code === '23505') return null
    throw error
  }
  if (!updated) return null
  console.log(JSON.stringify({ ts: nowIso(), event: 'ETECSA_PAYMENT_MATCHED', order_id: updated.id, client_id: client.id, transaction_id: updated.payment_transaction_id || null }))
  await notifyAdmins(`✅ Pago ETECSA detectado · ${publicOrder(updated).ticket}\nProducto: ${updated.offer_name} · ${updated.price_label}\nImporte: ${updated.payment_amount} CUP\nPagador: ${updated.payer_phone}\nEl cliente debe completar los datos del destinatario.`)
  return { order_id: updated.id, status: updated.status, ticket: publicOrder(updated).ticket }
}

function providerWebhookUrl() {
  const base = String(process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '')
  if (!base.startsWith('https://') || !String(process.env.SOKY_WEBHOOK_SECRET || '').trim()) return null
  return `${base}/api/etecsa/webhook`
}

async function fetchSoky(path, { method = 'GET', body = null, idempotencyKey = null } = {}) {
  const token = String(process.env.SOKY_APP_TOKEN || '').trim()
  if (!token) throw new Error('Falta SOKY_APP_TOKEN en el servidor.')
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` }
  if (body) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  if (body && providerWebhookUrl()) body.callback_url = providerWebhookUrl()
  let response
  try {
    response = await fetch(`${SOKY_API_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(method === 'POST' ? 60_000 : 15_000),
    })
  } catch (cause) {
    const error = new Error('No se pudo confirmar la respuesta de SokyRecargas.')
    error.code = 'SOKY_NETWORK_ERROR'; error.cause = cause; throw error
  }
  const text = await response.text()
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch (_) {}
  if (!response.ok) {
    const message = normalizeText(payload?.message || payload?.error?.message || payload?.error || `Soky respondió HTTP ${response.status}.`, 300)
    const error = new Error(message)
    error.code = 'SOKY_PURCHASE_REJECTED'; error.status = response.status
    error.provider_code = normalizeText(payload?.error?.code || payload?.code, 100) || null
    throw error
  }
  return payload
}

async function syncProviderStatusForOrder(order) {
  if (!order?.provider_recharge_id) return order
  const payload = await fetchSoky(`/recharges/${encodeURIComponent(order.provider_recharge_id)}?format=simple`)
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const providerStatus = cleanProviderStatus(data?.status)
  if (!providerStatus) return order
  return updateFromProviderStatus(order, data, providerStatus)
}

async function updateFromProviderStatus(order, data, providerStatus) {
  const nextStatus = providerStatus === 'completed' ? 'COMPLETED' : providerStatus === 'canceled' ? 'REFUND_REQUIRED' : 'PROCESSING'
  if (order.status === nextStatus && order.provider_status === providerStatus && String(order.provider_reference || '') === String(data?.operator_reference || '')) return order
  const patch = {
    status: nextStatus,
    provider_status: providerStatus,
    provider_reference: normalizeText(data?.operator_reference, 120) || null,
    provider_payload: {
      id: data?.id ?? order.provider_recharge_id,
      status: providerStatus,
      is_paid: data?.is_paid === true,
      provider_delivery_queued: data?.provider_delivery_queued === true,
      available_at: data?.available_at || null,
      completed_at: data?.completed_at || null,
    },
    updated_at: nowIso(),
  }
  if (nextStatus === 'COMPLETED') patch.completed_at = data?.completed_at || nowIso()
  if (nextStatus === 'REFUND_REQUIRED') patch.failure_reason = 'SOKY_RECHARGE_CANCELED'
  const { data: updated, error } = await supabase.from('etecsa_orders').update(patch).eq('id', order.id).select('*').single()
  if (error) throw error
  if (updated.status !== order.status) {
    const msg = nextStatus === 'COMPLETED'
      ? `🎉 Pedido ETECSA completado · ${publicOrder(updated).ticket}\n${updated.offer_name} · ${updated.price_label}\nImporte: ${updated.payment_amount} CUP\nDestinatario: ${updated.recipient || updated.email || '—'}`
      : nextStatus === 'REFUND_REQUIRED'
        ? `⚠️ Soky canceló la recarga ETECSA · ${publicOrder(updated).ticket}\nRequiere revisión y resolución del pago del cliente.`
        : `⏳ Recarga ETECSA en proceso · ${publicOrder(updated).ticket}`
    await notifyAdmins(msg)
    console.log(JSON.stringify({ ts: nowIso(), event: 'ETECSA_ORDER_PROVIDER_STATUS', order_id: updated.id, status: updated.status, provider_status: providerStatus }))
  }
  return updated
}

async function submitRecipientDetails(clientId, orderId, body) {
  const order = await getOwnedOrder(clientId, orderId)
  if (!order) { const e = new Error('No se encontró esta operación.'); e.status = 404; e.code = 'ETECSA_ORDER_NOT_FOUND'; throw e }
  if (order.status !== 'PAYMENT_RECEIVED_WAITING_DETAILS' && order.status !== 'FULFILLMENT_REVIEW') {
    const e = new Error('La operación todavía no está lista para procesar esos datos.'); e.status = 409; e.code = 'ETECSA_ORDER_WRONG_STATE'; throw e
  }
  const requiredInputs = Array.isArray(order.required_inputs) ? order.required_inputs : ['recipient']
  const recipient = normalizeText(body?.recipient, 191)
  const recipientName = normalizeText(body?.recipient_name, 255)
  const email = normalizeText(body?.email, 254).toLowerCase()
  if (requiredInputs.includes('recipient') && !recipient) {
    const e = new Error(order.offer_type === 'nauta' ? 'Introduce el dato o cuenta del destinatario.' : 'Introduce el número que recibirá la recarga.')
    e.status = 400; e.code = 'RECIPIENT_REQUIRED'; throw e
  }
  if (requiredInputs.includes('recipient_name') && !recipientName) {
    const e = new Error('Introduce el nombre del destinatario.')
    e.status = 400; e.code = 'RECIPIENT_NAME_REQUIRED'; throw e
  }
  if (order.offer_type === 'recharge' && recipient && !/^5\d{7}$/.test(normalizeDestPhone(recipient))) {
    const e = new Error('El número de destino debe tener 8 dígitos y comenzar por 5.')
    e.status = 400; e.code = 'INVALID_RECIPIENT_PHONE'; throw e
  }
  const emailRequired = order.has_email || requiredInputs.includes('email')
  if (emailRequired && !isEmail(email)) {
    const e = new Error('Introduce una dirección de correo válida.')
    e.status = 400; e.code = 'INVALID_EMAIL'; throw e
  }
  if (order.offer_type === 'nauta' && emailRequired && !email.endsWith('@nauta.com.cu')) {
    const e = new Error('Introduce una cuenta de correo terminada en @nauta.com.cu.')
    e.status = 400; e.code = 'INVALID_NAUTA_EMAIL'; throw e
  }
  if (email && !isEmail(email)) { const e = new Error('El correo electrónico no es válido.'); e.status = 400; e.code = 'INVALID_EMAIL'; throw e }

  const { data: claimed, error: claimError } = await supabase.from('etecsa_orders')
    .update({
      status: 'SUBMITTING_TO_SOKY', recipient: recipient || null, recipient_name: recipientName || null,
      email: email || null, updated_at: nowIso(), failure_reason: null,
    })
    .eq('id', order.id).eq('client_id', clientId).eq('status', order.status)
    .select('*').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) { const e = new Error('La operación cambió de estado. Actualiza y vuelve a intentarlo.'); e.status = 409; e.code = 'ETECSA_ORDER_STATE_CHANGED'; throw e }

  await notifyAdmins(`📨 Datos de destinatario recibidos · ${publicOrder(claimed).ticket}\nProducto: ${claimed.offer_name} · ${claimed.price_label}\nImporte pagado: ${claimed.payment_amount} CUP\nDestinatario: ${recipient || '—'}${email ? `\nCorreo Nauta: ${email}` : ''}\nEnviando a SokyRecargas.`)
  try {
    const payloadBody = {
      price_id: claimed.price_id,
      recipient: recipient || email,
      external_id: claimed.id,
    }
    if (recipientName) payloadBody.recipient_name = recipientName
    if (email) payloadBody.email = email
    const response = await fetchSoky(`/recharges/offers/${encodeURIComponent(claimed.offer_id)}/recharge?format=simple`, {
      method: 'POST', body: payloadBody, idempotencyKey: `synthesisone-etecsa-${claimed.id}`,
    })
    const data = response?.data && typeof response.data === 'object' ? response.data : response
    if (data?.id === undefined || data?.id === null) throw new Error('Soky no devolvió el identificador de la recarga.')
    const update = {
      provider_recharge_id: String(data.id),
      provider_status: cleanProviderStatus(data.status) || 'pending',
      provider_reference: normalizeText(data.operator_reference, 120) || null,
      status: 'PROCESSING',
      provider_payload: { id: data.id, status: cleanProviderStatus(data.status), is_paid: data.is_paid === true, provider_delivery_queued: data.provider_delivery_queued === true },
      submitted_at: nowIso(), updated_at: nowIso(), failure_reason: null,
    }
    const { data: saved, error } = await supabase.from('etecsa_orders').update(update).eq('id', claimed.id).select('*').single()
    if (error) throw error
    // Poll the authoritative detail endpoint immediately; app_token POST responses
    // may present queued deliveries as completed before the final provider state.
    let finalOrder = saved
    try { finalOrder = await syncProviderStatusForOrder(saved) } catch (error) {
      console.warn(JSON.stringify({ ts: nowIso(), event: 'ETECSA_INITIAL_STATUS_CHECK_FAILED', order_id: saved.id, code: error.code || 'STATUS_CHECK_FAILED' }))
    }
    return publicOrder(finalOrder)
  } catch (error) {
    const reason = normalizeText(error.message, 300) || 'No se pudo completar la solicitud al proveedor.'
    const { data: failed, error: updateError } = await supabase.from('etecsa_orders')
      .update({ status: 'FULFILLMENT_REVIEW', failure_reason: reason, updated_at: nowIso() })
      .eq('id', claimed.id).select('*').single()
    if (updateError) console.error('No se pudo registrar el error del pedido ETECSA:', updateError.message)
    await notifyAdmins(`🚨 Pedido ETECSA necesita revisión · ${publicOrder(claimed).ticket}\nProducto: ${claimed.offer_name} · ${claimed.price_label}\nPagado: ${claimed.payment_amount} CUP\nError: ${reason.slice(0, 300)}\nRevisa la cuenta de Soky y el estado antes de reintentar; usa siempre la misma Idempotency-Key.`)
    console.error(JSON.stringify({ ts: nowIso(), event: 'ETECSA_PROVIDER_SUBMISSION_FAILED', order_id: claimed.id, code: error.code || 'SUBMIT_FAILED', status: error.status || null }))
    // The customer's payment was already matched. Keep the order open for admin review.
    const output = failed || { ...claimed, status: 'FULFILLMENT_REVIEW' }
    output.client_message = 'Pago recibido, pero el pedido necesita una revisión. No vuelvas a pagar; contacta con soporte.'
    return publicOrder(output)
  }
}

function verifySokyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const left = Buffer.from(expected)
  const right = Buffer.from(String(signature))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function handleSokyWebhook(payload) {
  const eventId = normalizeText(payload?.event_id, 200)
  const eventType = normalizeText(payload?.event, 100)
  const sentAt = Date.parse(payload?.sent_at || '')
  if (!eventId || !Number.isFinite(sentAt) || Date.now() - sentAt > 60 * 60 * 1000 || sentAt > Date.now() + 5 * 60 * 1000) {
    const e = new Error('Aviso de proveedor inválido o demasiado antiguo.'); e.status = 400; e.code = 'INVALID_SOKY_WEBHOOK'; throw e
  }
  const data = payload?.data
  if (eventType !== 'recharge.updated' || !data || !data.external_id || !data.id) {
    const { error } = await supabase.from('etecsa_webhook_events').insert({ event_id: eventId, event_type: eventType || 'unknown', received_at: nowIso() })
    if (error?.code === '23505') return { duplicate: true }
    if (error) throw error
    return { ignored: true }
  }

  const { data: order, error } = await supabase.from('etecsa_orders').select('*').eq('id', String(data.external_id)).maybeSingle()
  if (error) throw error
  if (!order || !order.provider_recharge_id || String(order.provider_recharge_id) !== String(data.id)) {
    // A callback can race the POST response. Do not consume its event before
    // the provider ID is persisted; the regular status poll will also recover it.
    if (!order || (order.provider_recharge_id && String(order.provider_recharge_id) !== String(data.id))) {
      const { error: eventError } = await supabase.from('etecsa_webhook_events').insert({ event_id: eventId, event_type: eventType, received_at: nowIso() })
      if (eventError?.code === '23505') return { duplicate: true }
      if (eventError) throw eventError
    }
    return { ignored: true }
  }

  const status = cleanProviderStatus(data.status)
  if (!status || status === 'pending') {
    const { error: eventError } = await supabase.from('etecsa_webhook_events').insert({ event_id: eventId, event_type: eventType, received_at: nowIso() })
    if (eventError?.code === '23505') return { duplicate: true }
    if (eventError) throw eventError
    return { ignored: true }
  }

  // Confirm final completion/cancellation using Soky's authoritative endpoint.
  // If this request fails, return 500 without recording the event so Soky may retry.
  const updated = await syncProviderStatusForOrder(order)
  const { error: eventError } = await supabase.from('etecsa_webhook_events').insert({ event_id: eventId, event_type: eventType, received_at: nowIso() })
  if (eventError?.code === '23505') return { duplicate: true }
  if (eventError) throw eventError
  return { received: true, status: updated?.status || order.status }
}

async function processProviderOrder(order) {
  try { await syncProviderStatusForOrder(order) } catch (error) {
    console.warn(JSON.stringify({ ts: nowIso(), event: 'ETECSA_ORDER_STATUS_POLL_FAILED', order_id: order.id, code: error.code || 'POLL_FAILED' }))
  }
}

async function workerTick() {
  const now = nowIso()
  const { error: expiryError } = await supabase.from('etecsa_orders')
    .update({ status: 'EXPIRED', updated_at: now, failure_reason: 'PAYMENT_WINDOW_EXPIRED' })
    .eq('status', 'WAITING_PAYMENT').lt('payment_deadline_at', now)
  if (expiryError) console.error('No se pudieron expirar tickets ETECSA:', expiryError.message)
  const { data: orders, error } = await supabase.from('etecsa_orders')
    .select('*').eq('status', 'PROCESSING').not('provider_recharge_id', 'is', null)
    .order('updated_at', { ascending: true }).limit(30)
  if (error) { console.error('No se pudieron consultar pedidos ETECSA en curso:', error.message); return }
  for (const order of orders || []) await processProviderOrder(order)
}

function startEtecsaOrderWorker() {
  if (workerStarted) return
  workerStarted = true
  setTimeout(() => workerTick().catch(error => console.error('Error en worker ETECSA:', error.message)), 20_000)
  setInterval(() => workerTick().catch(error => console.error('Error en worker ETECSA:', error.message)), 60_000)
}

async function listAdminOrders() {
  const { data, error } = await supabase.from('etecsa_orders').select('*')
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data || []).map(order => ({
    ...publicOrder(order), client_id: order.client_id,
    destination_card: order.destination_card, confirmation_phone: order.confirmation_phone,
    failure_reason: order.failure_reason || null,
    payment_transaction_id: order.payment_transaction_id || null,
    provider_recharge_id: order.provider_recharge_id || null,
  }))
}

module.exports = {
  PAYMENT_WINDOW_MS,
  publicOrder,
  getCheckoutConfig,
  getCurrentOrder,
  getRecentOrders,
  getOwnedOrderPublic,
  createPaymentOrder,
  cancelPaymentOrder,
  submitRecipientDetails,
  processIncomingTransfer,
  verifySokyWebhookSignature,
  handleSokyWebhook,
  startEtecsaOrderWorker,
  listAdminOrders,
}
