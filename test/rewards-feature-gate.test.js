'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { rewardsEnabled, emptyDiscountQuote, isRewardsSchemaUnavailable } = require('../src/utils/rewardFeaturePolicy')

test('rewards remain disabled unless explicitly enabled in the production environment', () => {
  assert.equal(rewardsEnabled({}), false)
  assert.equal(rewardsEnabled({ SYNTHESIS_REWARDS_ENABLED: 'false' }), false)
  assert.equal(rewardsEnabled({ SYNTHESIS_REWARDS_ENABLED: 'TRUE' }), true)
})

test('disabled rewards preserve original checkout totals and do not apply any currency conversion', () => {
  const cup = emptyDiscountQuote(3000, 'CUP')
  assert.equal(cup.kind, 'NONE')
  assert.equal(cup.finalAmount, 3000)
  assert.equal(cup.discountAmount, 0)
  assert.equal(cup.featureEnabled, false)
  const saldo = emptyDiscountQuote(4000, 'SALDO')
  assert.equal(saldo.finalAmount, 4000)
  assert.equal(saldo.currency, 'SALDO')
})

test('missing optional rewards schema is detected without confusing unrelated errors', () => {
  assert.equal(isRewardsSchemaUnavailable({ code: '42P01', message: 'relation does not exist' }), true)
  assert.equal(isRewardsSchemaUnavailable({ code: 'PGRST205', message: 'schema cache' }), true)
  assert.equal(isRewardsSchemaUnavailable({ code: 'ECONNRESET', message: 'connection reset' }), false)
})
