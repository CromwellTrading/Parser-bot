'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { roundToStep, computePrices } = require('../src/utils/gamePricing')
const normal = { usd_to_cup: 1050, usd_to_saldo: 380, profit_margin_pct: 10, cup_rounding_step: 5, saldo_rounding_step: 1, rounding_mode: 'ceil' }
const reseller = { usd_to_cup: 1050, usd_to_saldo: 380, profit_margin_pct: 5, cup_rounding_step: 5, saldo_rounding_step: 1, rounding_mode: 'ceil' }
test('computes normal prices using the normal rule', () => { assert.deepEqual(computePrices(0.70, normal), { price_cup: 810, price_saldo: 293 }) })
test('computes reseller prices independently', () => { assert.deepEqual(computePrices(0.70, reseller), { price_cup: 775, price_saldo: 280 }) })
test('supports ceil, nearest and floor per currency step', () => { assert.equal(roundToStep(101, 10, 'ceil'), 110); assert.equal(roundToStep(101, 10, 'nearest'), 100); assert.equal(roundToStep(109, 10, 'floor'), 100) })
test('protects against floating point rounding noise', () => { assert.equal(roundToStep(110.00000000000001, 10, 'ceil'), 110) })
test('rejects invalid cost, rates and rounding', () => { assert.throws(() => computePrices(-1, normal)); assert.throws(() => computePrices(1, { ...normal, usd_to_cup: 0 })); assert.throws(() => roundToStep(1, 0, 'ceil')) })
