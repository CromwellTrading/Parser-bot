'use strict'

/** CUP-only welcome discount brackets. Boundaries intentionally match the campaign rules. */
function welcomePercent(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('amount must be a positive finite number')
  if (value < 3000) return 3
  if (value <= 7000) return 7
  return 10
}

/** Rounds a percentage discount to the nearest whole CUP without exceeding the subtotal. */
function roundedDiscount(amount, percent) {
  const value = Number(amount)
  const rate = Number(percent)
  if (!Number.isFinite(value) || value < 0) throw new TypeError('amount must be a non-negative finite number')
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new TypeError('percent must be between 0 and 100')
  return Math.min(value, Math.max(0, Math.round(value * rate / 100)))
}

module.exports = { welcomePercent, roundedDiscount }
