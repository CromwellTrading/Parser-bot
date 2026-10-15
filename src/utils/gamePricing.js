'use strict'

const DEFAULT_MARKET_PRICING = Object.freeze({
  usd_to_cup: 1050,
  usd_to_saldo: 380,
  profit_margin_pct: 0,
  cup_rounding_step: 5,
  saldo_rounding_step: 1,
  rounding_mode: 'ceil',
})

function positiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function normalizeMarketPricing(input = {}) {
  const mode = String(input.rounding_mode || DEFAULT_MARKET_PRICING.rounding_mode).toLowerCase()
  const margin = Number(input.profit_margin_pct ?? DEFAULT_MARKET_PRICING.profit_margin_pct)
  return {
    usd_to_cup: positiveNumber(input.usd_to_cup, DEFAULT_MARKET_PRICING.usd_to_cup),
    usd_to_saldo: positiveNumber(input.usd_to_saldo, DEFAULT_MARKET_PRICING.usd_to_saldo),
    profit_margin_pct: Number.isFinite(margin) && margin >= 0 && margin <= 10000 ? margin : DEFAULT_MARKET_PRICING.profit_margin_pct,
    cup_rounding_step: positiveNumber(input.cup_rounding_step, DEFAULT_MARKET_PRICING.cup_rounding_step),
    saldo_rounding_step: positiveNumber(input.saldo_rounding_step, DEFAULT_MARKET_PRICING.saldo_rounding_step),
    rounding_mode: ['ceil', 'nearest', 'floor'].includes(mode) ? mode : DEFAULT_MARKET_PRICING.rounding_mode,
  }
}

function roundToStep(value, step, mode) {
  const safeStep = positiveNumber(step, 1)
  const units = value / safeStep
  let roundedUnits
  // Avoid floating-point noise (e.g. 1.1 * 100 producing 110.00000000000001).
  if (mode === 'floor') roundedUnits = Math.floor(units + 1e-10)
  else if (mode === 'nearest') roundedUnits = Math.round(units)
  else roundedUnits = Math.ceil(units - 1e-10)
  return Math.max(0, roundedUnits * safeStep)
}

function calculateOfferPrices(baseCostUsd, pricingInput = {}) {
  const cost = Number(baseCostUsd)
  if (!Number.isFinite(cost) || cost < 0) throw new TypeError('base_cost_usd debe ser un número mayor o igual a cero')
  const pricing = normalizeMarketPricing(pricingInput)
  const multiplier = 1 + pricing.profit_margin_pct / 100
  const cupRaw = cost * pricing.usd_to_cup * multiplier
  const saldoRaw = cost * pricing.usd_to_saldo * multiplier
  return {
    price_cup: roundToStep(cupRaw, pricing.cup_rounding_step, pricing.rounding_mode),
    price_saldo: roundToStep(saldoRaw, pricing.saldo_rounding_step, pricing.rounding_mode),
  }
}

module.exports = {
  DEFAULT_MARKET_PRICING,
  normalizeMarketPricing,
  calculateOfferPrices,
  roundToStep,
}
