'use strict'

const { readConfiguredRows, normalizeCard, normalizePaymentPhone, CARD_RE, PHONE_RE } = require('./paymentDestinations')

/**
 * A payment ticket stores the card/phone that was active when it was created. If the administrator who
 * owns that account later switches it off, customers who still have the ticket open must not be shown
 * (and must not pay) a receiver that no longer takes payments. This keeps a small in-memory snapshot of
 * the receivers that are active right now so the synchronous order serializers can mask retired ones.
 *
 * Fail-safe direction: when the snapshot cannot be read, receivers are reported as "unknown" and are NOT
 * hidden, so a database hiccup never breaks a legitimate ticket.
 */
const REFRESH_MS = 8_000
const RETIRED_MESSAGE = 'Esta cuenta de pago ya no está disponible. No transfieras a ella. Cancela este ticket y crea uno nuevo; si ya enviaste el dinero, contacta con soporte con tu comprobante.'

let snapshot = { loaded: false, at: 0, cards: new Set(), phones: new Set(), pairs: new Set() }
let inflight = null

async function refreshActiveReceivers({ force = false } = {}) {
  if (!force && snapshot.loaded && Date.now() - snapshot.at < REFRESH_MS) return snapshot
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const rows = await readConfiguredRows()
      const cards = new Set(); const phones = new Set(); const pairs = new Set()
      for (const row of rows) {
        const card = normalizeCard(row.card_number)
        const phone = normalizePaymentPhone(row.confirmation_phone)
        if (row.enabled !== true || !CARD_RE.test(card) || !PHONE_RE.test(phone)) continue
        cards.add(card); phones.add(phone); pairs.add(`${card}:${phone}`)
      }
      snapshot = { loaded: true, at: Date.now(), cards, phones, pairs }
    } catch (_) {
      // Keep the previous snapshot (or stay "unknown" if there never was one).
    }
    return snapshot
  })().finally(() => { inflight = null })
  return inflight
}

/** 'active' | 'retired' | 'unknown' */
function receiverState({ card, phone } = {}) {
  if (!snapshot.loaded) return 'unknown'
  const c = normalizeCard(card)
  const p = normalizePaymentPhone(phone)
  if (!c && !p) return 'unknown'
  if (c) {
    const ok = p ? snapshot.pairs.has(`${c}:${p}`) : snapshot.cards.has(c)
    return ok ? 'active' : 'retired'
  }
  return snapshot.phones.has(p) ? 'active' : 'retired'
}

/** Removes the receiver from a customer-facing object when its account has been switched off. */
function maskRetiredPayment(result, order) {
  if (!result || !order) return result
  if (String(order.status || '').toUpperCase() !== 'WAITING_PAYMENT') return result
  if (receiverState({ card: order.destination_card, phone: order.confirmation_phone }) !== 'retired') return result
  for (const key of ['destination_card', 'confirmation_phone', 'receiver_phone']) if (key in result) result[key] = null
  if (result.payment && typeof result.payment === 'object') {
    result.payment = { method: result.payment.method || null, currency: result.payment.currency || null, unavailable: true }
  }
  result.payment_unavailable = true
  result.payment_unavailable_message = RETIRED_MESSAGE
  return result
}

async function receiverGuardMiddleware(_req, _res, next) {
  try { await refreshActiveReceivers() } catch (_) { /* never block a request */ }
  next()
}

function _resetForTests() { snapshot = { loaded: false, at: 0, cards: new Set(), phones: new Set(), pairs: new Set() }; inflight = null }
function _setSnapshotForTests(rows) {
  const cards = new Set(); const phones = new Set(); const pairs = new Set()
  for (const r of rows) { cards.add(r.card); phones.add(r.phone); pairs.add(`${r.card}:${r.phone}`) }
  snapshot = { loaded: true, at: Date.now(), cards, phones, pairs }
}

module.exports = {
  RETIRED_MESSAGE, refreshActiveReceivers, receiverState, maskRetiredPayment,
  receiverGuardMiddleware, _resetForTests, _setSnapshotForTests,
}
