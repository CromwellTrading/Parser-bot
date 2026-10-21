'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { welcomePercent, roundedDiscount } = require('../src/utils/rewardPricing')

test('welcome promotion applies the agreed CUP brackets at every boundary', () => {
  assert.equal(welcomePercent(1), 3)
  assert.equal(welcomePercent(2999), 3)
  assert.equal(welcomePercent(3000), 7)
  assert.equal(welcomePercent(7000), 7)
  assert.equal(welcomePercent(7001), 10)
})

test('discount amount rounds to whole CUP and never exceeds subtotal', () => {
  assert.equal(roundedDiscount(2999, 3), 90)
  assert.equal(roundedDiscount(3000, 7), 210)
  assert.equal(roundedDiscount(7001, 10), 700)
  assert.equal(roundedDiscount(1, 100), 1)
})

test('reward pricing rejects invalid amounts and discount percentages', () => {
  assert.throws(() => welcomePercent(0), /positive finite number/)
  assert.throws(() => roundedDiscount(-1, 5), /non-negative finite number/)
  assert.throws(() => roundedDiscount(100, 101), /between 0 and 100/)
})
