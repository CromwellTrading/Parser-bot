'use strict'

function roundToStep(value, step, mode = 'ceil') {
  const v = Number(value)
  const s = Number(step)
  if (!Number.isFinite(v) || v < 0) throw new TypeError('value debe ser un número finito mayor o igual a cero')
  if (!Number.isFinite(s) || s <= 0) throw new TypeError('step debe ser mayor que cero')
  const units = v / s
  const rounded = mode === 'floor' ? Math.floor(units + 1e-10) : mode === 'nearest' ? Math.round(units) : mode === 'ceil' ? Math.ceil(units - 1e-10) : NaN
  if (!Number.isFinite(rounded)) throw new TypeError('rounding mode no válido')
  return Math.max(0, rounded * s)
}

function normalizeMarketPricing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const error = new Error('No hay configuración de precios en synthesisone_settings')
    error.code = 'PRICING_NOT_CONFIGURED'
    throw error
  }
  const positive = (value, field, fallback = undefined) => {
    const v = value === undefined ? fallback : value
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) {
      const error = new Error(`Configuración de precios inválida: ${field}`)
      error.code = 'PRICING_NOT_CONFIGURED'
      throw error
    }
    return n
  }
  const margin = Number(raw.profit_margin_pct ?? 0)
  if (!Number.isFinite(margin) || margin < 0 || margin > 10000) {
    const error = new Error('Configuración de precios inválida: profit_margin_pct')
    error.code = 'PRICING_NOT_CONFIGURED'
    throw error
  }
  const mode = ['ceil', 'nearest', 'floor'].includes(raw.rounding_mode) ? raw.rounding_mode : 'ceil'
  return {
    usd_to_cup: positive(raw.usd_to_cup, 'usd_to_cup'),
    usd_to_saldo: positive(raw.usd_to_saldo, 'usd_to_saldo'),
    profit_margin_pct: margin,
    cup_rounding_step: positive(raw.cup_rounding_step, 'cup_rounding_step', 5),
    saldo_rounding_step: positive(raw.saldo_rounding_step, 'saldo_rounding_step', 1),
    rounding_mode: mode,
  }
}

function computePrices(costUsd, rule) {
  const cost = Number(costUsd)
  if (!Number.isFinite(cost) || cost < 0) throw new TypeError('base_cost_usd debe ser mayor o igual a cero')
  const normalized = normalizeMarketPricing(rule)
  const margin = 1 + normalized.profit_margin_pct / 100
  return {
    price_cup: roundToStep(cost * normalized.usd_to_cup * margin, normalized.cup_rounding_step, normalized.rounding_mode),
    price_saldo: roundToStep(cost * normalized.usd_to_saldo * margin, normalized.saldo_rounding_step, normalized.rounding_mode),
  }
}

function calculateOfferPrices(costUsd, rule) {
  return computePrices(costUsd, rule)
}

module.exports = { roundToStep, normalizeMarketPricing, computePrices, calculateOfferPrices }
