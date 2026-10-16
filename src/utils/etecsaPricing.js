'use strict'

const SCALE = 1_000_000n
const STEP = 5n

function normalizeDecimalInput(value, { maxIntegerDigits = 8, maxFractionDigits = 6 } = {}) {
  if (value === null || value === undefined) return null
  const raw = String(value).trim().replace(',', '.')
  const match = raw.match(new RegExp(`^(\\d{1,${maxIntegerDigits}})(?:\\.(\\d{1,${maxFractionDigits}}))?$`))
  if (!match) return null
  const fraction = (match[2] || '').padEnd(maxFractionDigits, '0')
  const scaled = BigInt(match[1]) * (10n ** BigInt(maxFractionDigits)) + BigInt(fraction || '0')
  if (scaled <= 0n) return null
  return {
    normalized: `${match[1]}${match[2] ? `.${match[2].replace(/0+$/, '')}` : ''}`.replace(/\.$/, ''),
    scaled,
  }
}

function normalizeRate(value) {
  const parsed = normalizeDecimalInput(value)
  return parsed ? parsed.normalized : null
}

// Convert a provider cost and one independently managed rate using fixed-point
// BigInt math, then always round UP to the next multiple of five.
function calculateRetailPrice(cost, rate) {
  const parsedCost = normalizeDecimalInput(cost)
  const parsedRate = normalizeDecimalInput(rate)
  if (!parsedCost || !parsedRate) return null

  const numerator = parsedCost.scaled * parsedRate.scaled
  const denominator = SCALE * SCALE * STEP
  const blocks = (numerator + denominator - 1n) / denominator
  const rounded = blocks * STEP
  if (rounded <= 0n || rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(rounded)
}

function calculateOfferPrices(cost, settings) {
  const cup = calculateRetailPrice(cost, settings?.usd_to_cup_rate)
  const saldo = calculateRetailPrice(cost, settings?.usd_to_saldo_rate)
  if (cup === null || saldo === null) return null
  return { cup, saldo }
}

function isPricingConfigured(settings) {
  return normalizeRate(settings?.usd_to_cup_rate) !== null &&
    normalizeRate(settings?.usd_to_saldo_rate) !== null
}

module.exports = {
  normalizeDecimalInput,
  normalizeRate,
  calculateRetailPrice,
  calculateOfferPrices,
  isPricingConfigured,
  ROUNDING_STEP: 5,
  ROUNDING_MODE: 'up',
}
