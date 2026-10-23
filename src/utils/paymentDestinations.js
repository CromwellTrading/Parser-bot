'use strict'

const supabase = require('../supabase')
const { normalizePhone } = require('./parser')

const TABLE = 'admin_payment_destinations'
const FALLBACK_ID = 'legacy-env'
const CARD_RE = /^\d{8,24}$/
const PHONE_RE = /^5\d{7}$/

function normalizeCard(value) {
  return String(value || '').trim().replace(/[\s-]/g, '')
}

function normalizePaymentPhone(value) {
  return (normalizePhone(String(value || '')) || '').replace(/\D/g, '')
}

function cleanName(value, fallback = 'Cuenta de transferencia') {
  const cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || fallback
}

function legacyDestination() {
  const card = normalizeCard(process.env.LICENSE_PAYMENT_CARD || '')
  const confirmationPhone = normalizePaymentPhone(process.env.LICENSE_PAYMENT_PHONE || '')
  if (!CARD_RE.test(card) || !PHONE_RE.test(confirmationPhone)) return null
  return {
    id: FALLBACK_ID,
    label: 'Cuenta de transferencia',
    card_number: card,
    confirmation_phone: confirmationPhone,
    enabled: true,
    source: 'legacy',
  }
}

function safeDestination(row, index = 0) {
  const card = normalizeCard(row?.card_number)
  const confirmationPhone = normalizePaymentPhone(row?.confirmation_phone)
  if (!row?.id || !CARD_RE.test(card) || !PHONE_RE.test(confirmationPhone) || row.enabled !== true) return null
  return {
    id: String(row.id),
    label: cleanName(row.label, `Cuenta de transferencia ${index + 1}`),
    card_number: card,
    confirmation_phone: confirmationPhone,
    enabled: true,
    source: 'admin',
  }
}

async function readConfiguredRows() {
  const result = await supabase.from(TABLE)
    .select('id, admin_client_id, label, card_number, confirmation_phone, enabled, updated_at')
    .order('created_at', { ascending: true })
  if (result.error) {
    const error = new Error(result.error.message || 'No se pudieron consultar las cuentas de transferencia')
    error.code = result.error.code || 'PAYMENT_DESTINATIONS_READ_FAILED'
    throw error
  }
  return result.data || []
}

async function getPaymentDestinations({ includeDisabled = false } = {}) {
  let rows
  try {
    rows = await readConfiguredRows()
  } catch (error) {
    // Compatibility during staged deployment: existing installations can keep using
    // the already-configured environment pair until the migration is applied.
    console.warn(JSON.stringify({ event: 'PAYMENT_DESTINATIONS_TABLE_UNAVAILABLE', code: error.code || null }))
    const legacy = legacyDestination()
    return legacy ? [legacy] : []
  }

  // Once the destination table exists, an empty table means no administrator has
  // explicitly enabled a receiver. Never resurrect the legacy .env receiver just
  // because every administrator disabled their own account.
  if (rows.length === 0) return []

  const mapped = rows.map((row, index) => ({
    id: String(row.id),
    admin_client_id: String(row.admin_client_id || ''),
    label: `Cuenta • ${normalizeCard(row.card_number).slice(-4)}`,
    card_number: normalizeCard(row.card_number),
    confirmation_phone: normalizePaymentPhone(row.confirmation_phone),
    enabled: row.enabled === true,
    updated_at: row.updated_at || null,
  })).filter(row => CARD_RE.test(row.card_number) && PHONE_RE.test(row.confirmation_phone))

  return includeDisabled ? mapped : mapped.filter(row => row.enabled).map((row) => ({
    id: row.id,
    label: row.label,
    card_number: row.card_number,
    confirmation_phone: row.confirmation_phone,
    enabled: true,
    source: 'admin',
  }))
}

async function getMyPaymentDestination(adminClientId) {
  const { data, error } = await supabase.from(TABLE)
    .select('id, label, card_number, confirmation_phone, enabled, updated_at')
    .eq('admin_client_id', String(adminClientId)).maybeSingle()
  if (error) {
    const wrapped = new Error(error.message || 'No se pudo cargar tu cuenta de transferencia')
    wrapped.code = error.code || 'PAYMENT_DESTINATIONS_READ_FAILED'
    throw wrapped
  }
  return data ? {
    id: String(data.id), label: String(data.label || ''),
    card_number: String(data.card_number || ''), confirmation_phone: String(data.confirmation_phone || ''),
    enabled: data.enabled === true, updated_at: data.updated_at || null,
  } : { id: null, label: '', card_number: '', confirmation_phone: '', enabled: false, updated_at: null }
}

async function saveMyPaymentDestination(admin, input = {}) {
  const card = normalizeCard(input.card_number ?? input.card ?? '')
  const phone = normalizePaymentPhone(input.confirmation_phone ?? input.phone ?? '')
  const enabled = input.enabled === true
  const label = card ? `Cuenta • ${card.slice(-4)}` : 'Cuenta de transferencia'
  if ((card && !CARD_RE.test(card)) || (!card && enabled)) {
    const error = new Error('Introduce una tarjeta válida de entre 8 y 24 dígitos.')
    error.status = 400; error.code = 'INVALID_PAYMENT_CARD'; throw error
  }
  if ((phone && !PHONE_RE.test(phone)) || (!phone && enabled)) {
    const error = new Error('Introduce un número cubano válido de 8 dígitos que comience por 5.')
    error.status = 400; error.code = 'INVALID_CONFIRMATION_PHONE'; throw error
  }
  if (Boolean(card) !== Boolean(phone)) {
    const error = new Error('La tarjeta y el número de confirmación deben guardarse juntos. Completa ambos campos o deja ambos vacíos.')
    error.status = 400; error.code = 'PAYMENT_DESTINATION_PAIR_REQUIRED'; throw error
  }
  if (enabled && (!card || !phone)) {
    const error = new Error('Para activar la cuenta debes guardar juntos la tarjeta y su número de confirmación.')
    error.status = 400; error.code = 'PAYMENT_DESTINATION_PAIR_REQUIRED'; throw error
  }
  const payload = {
    admin_client_id: String(admin.id),
    label,
    card_number: card,
    confirmation_phone: phone,
    enabled,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'admin_client_id' })
    .select('id, label, card_number, confirmation_phone, enabled, updated_at').single()
  if (error) {
    const wrapped = new Error(error.message || 'No se pudo guardar la cuenta de transferencia')
    wrapped.code = error.code || 'PAYMENT_DESTINATIONS_SAVE_FAILED'
    throw wrapped
  }
  return { id: String(data.id), label: data.label, card_number: data.card_number, confirmation_phone: data.confirmation_phone, enabled: data.enabled === true, updated_at: data.updated_at || null }
}

async function resolvePaymentDestination(destinationId = '') {
  const destinations = await getPaymentDestinations()
  const requested = String(destinationId || '').trim()
  let destination
  if (requested) {
    destination = destinations.find(item => item.id === requested)
    if (!destination) {
      const error = new Error('La cuenta de transferencia seleccionada ya no está disponible. Actualiza la lista y vuelve a intentarlo.')
      error.status = 409; error.code = 'PAYMENT_DESTINATION_UNAVAILABLE'; throw error
    }
  } else {
    destination = destinations[0]
  }
  if (!destination) {
    const error = new Error('No hay cuentas de transferencia activas. Inténtalo más tarde.')
    error.status = 503; error.code = 'PAYMENT_CONFIG_MISSING'; throw error
  }
  return { ...destination, card: destination.card_number, paymentCard: destination.card_number, paymentPhone: destination.confirmation_phone }
}

async function getPaymentConfig(baseConfig, destinationId = '') {
  const destination = await resolvePaymentDestination(destinationId)
  return {
    ...baseConfig,
    paymentCard: destination.card_number,
    paymentPhone: destination.confirmation_phone,
    destinationId: destination.id,
    destinationLabel: destination.label,
    configured: Boolean(baseConfig && baseConfig.amount != null && destination.card_number && destination.confirmation_phone),
  }
}

module.exports = {
  TABLE, CARD_RE, PHONE_RE, getPaymentDestinations, getMyPaymentDestination,
  saveMyPaymentDestination, resolvePaymentDestination, getPaymentConfig,
  normalizeCard, normalizePaymentPhone,
}
