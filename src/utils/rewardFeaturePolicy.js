'use strict'

function rewardsEnabled(env = process.env) {
  return String(env?.SYNTHESIS_REWARDS_ENABLED || '').trim().toLowerCase() === 'true'
}

function emptyDiscountQuote(amount, currency = 'CUP') {
  const baseAmount = Number(amount)
  return {
    baseAmount,
    finalAmount: baseAmount,
    discountPercent: 0,
    discountAmount: 0,
    couponId: null,
    couponCode: null,
    welcomeDiscount: false,
    kind: 'NONE',
    featureEnabled: false,
    currency: String(currency || 'CUP').toUpperCase(),
  }
}

function isRewardsSchemaUnavailable(error) {
  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '').toLowerCase()
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) ||
    (message.includes('reward_') && (message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find')))
}

module.exports = { rewardsEnabled, emptyDiscountQuote, isRewardsSchemaUnavailable }
