'use strict'

/** CUP-only welcome tiers. Shared with the dashboard so the client explains the same rules it validates. */
const WELCOME_DISCOUNT_TIERS = Object.freeze([
  Object.freeze({ min: 0, max: 3000, min_inclusive: true, max_inclusive: false, percent: 3 }),
  Object.freeze({ min: 3000, max: 7000, min_inclusive: true, max_inclusive: true, percent: 7 }),
  Object.freeze({ min: 7000, max: null, min_inclusive: false, max_inclusive: false, percent: 10 }),
])
function welcomePercent(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('amount must be a positive finite number')
  if (value < 3000) return WELCOME_DISCOUNT_TIERS[0].percent
  if (value <= 7000) return WELCOME_DISCOUNT_TIERS[1].percent
  return WELCOME_DISCOUNT_TIERS[2].percent
}

/** Rounds a percentage discount to the nearest whole CUP without exceeding the subtotal. */
function roundedDiscount(amount, percent) {
  const value = Number(amount)
  const rate = Number(percent)
  if (!Number.isFinite(value) || value < 0) throw new TypeError('amount must be a non-negative finite number')
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new TypeError('percent must be between 0 and 100')
  return Math.min(value, Math.max(0, Math.round(value * rate / 100)))
}

module.exports = { WELCOME_DISCOUNT_TIERS, welcomePercent, roundedDiscount }
