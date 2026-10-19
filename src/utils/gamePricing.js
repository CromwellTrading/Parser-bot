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

function computePrices(costUsd, rule) {
  const cost = Number(costUsd)
  if (!Number.isFinite(cost) || cost < 0) throw new TypeError('base_cost_usd debe ser mayor o igual a cero')
  if (!rule || !Number.isFinite(Number(rule.usd_to_cup)) || Number(rule.usd_to_cup) <= 0 || !Number.isFinite(Number(rule.usd_to_saldo)) || Number(rule.usd_to_saldo) <= 0) throw new TypeError('tasas de conversión no válidas')
  const marginPct = Number(rule.profit_margin_pct ?? 0)
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 10000) throw new TypeError('margen no válido')
  const margin = 1 + marginPct / 100
  return {
    price_cup: roundToStep(cost * Number(rule.usd_to_cup) * margin, Number(rule.cup_rounding_step ?? 5), rule.rounding_mode || 'ceil'),
    price_saldo: roundToStep(cost * Number(rule.usd_to_saldo) * margin, Number(rule.saldo_rounding_step ?? 1), rule.rounding_mode || 'ceil'),
  }
}

module.exports = { roundToStep, computePrices }
