'use strict'

/**
 * Lightweight per-game summary used by the "summary" catalogue view. The full catalogue holds about
 * 11,000 products; shipping all of them to a phone in one response exhausted the device's memory while
 * the server log still showed a successful request. Phones now load this summary first and request
 * the offers of a single game only when the customer opens it.
 */
function summarizeGameOffers(offers) {
  const list = Array.isArray(offers) ? offers : []
  let available = 0
  let minCup = null
  let minSaldo = null
  for (const offer of list) {
    const outOfStock = offer?.package_data?.rechargegames?.out_of_stock === true
    if (!offer?.published || !offer?.available || outOfStock) continue
    available += 1
    const cup = Number(offer.price_cup)
    const saldo = Number(offer.price_saldo)
    if (Number.isFinite(cup) && cup > 0 && (minCup === null || cup < minCup)) minCup = cup
    if (Number.isFinite(saldo) && saldo > 0 && (minSaldo === null || saldo < minSaldo)) minSaldo = saldo
  }
  return {
    offer_count: list.length,
    available_offer_count: available,
    min_price_cup: minCup,
    min_price_saldo: minSaldo,
  }
}

const GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

module.exports = { summarizeGameOffers, GAME_ID_PATTERN }
