'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeRate,
  calculateRetailPrice,
  calculateOfferPrices,
  isPricingConfigured,
} = require('../src/utils/etecsaPricing')
const {
  offerMatchesEtecsa,
  verifiedOperatorIds,
  verifiedCategoryIds,
  verifiedPromotionCategoryIds,
  normalizeOffer,
  sanitizeCustomerText,
} = require('../src/utils/etecsaOfferFilter')

test('ETECSA retail prices always round UP to a multiple of five', () => {
  assert.equal(calculateRetailPrice('7', '1'), 10)
  assert.equal(calculateRetailPrice('5', '1'), 5)
  assert.equal(calculateRetailPrice('5.01', '1'), 10)
  assert.equal(calculateRetailPrice('4.20', '450'), 1890)
  assert.equal(calculateRetailPrice('4.20', '350'), 1470)
})

test('ETECSA pricing computes CUP and Saldo Móvil independently', () => {
  assert.deepEqual(calculateOfferPrices('7', {
    usd_to_cup_rate: '1',
    usd_to_saldo_rate: '2',
  }), { cup: 10, saldo: 15 })
  assert.equal(isPricingConfigured({ usd_to_cup_rate: '450', usd_to_saldo_rate: '350' }), true)
  assert.equal(isPricingConfigured({ usd_to_cup_rate: '450', usd_to_saldo_rate: null }), false)
})

test('rates are normalized as decimal strings and invalid values rejected', () => {
  assert.equal(normalizeRate('450.500000'), '450.5')
  assert.equal(normalizeRate('0'), null)
  assert.equal(normalizeRate('-1'), null)
  assert.equal(normalizeRate('1e6'), null)
  assert.equal(normalizeRate('1.1234567'), null)
})

test('ETECSA filter includes verified named offers or linked verified operators only', () => {
  const ids = verifiedOperatorIds([{ id: 9, name: 'Cubacel' }, { id: 10, name: 'Another operator' }])
  const categoryIds = verifiedCategoryIds([{ id: 2, name: 'Nauta' }, { id: 3, name: 'Recargas' }])
  const promotionCategoryIds = verifiedPromotionCategoryIds([{ id: 7, name: 'Promociones' }])
  assert.equal(offerMatchesEtecsa({ id: 1, type: 'recharge', name: 'Cubacel 500 CUP' }, ids), true)
  assert.equal(offerMatchesEtecsa({ id: 2, type: 'nauta', name: 'Cuenta Nauta' }, ids), true)
  assert.equal(offerMatchesEtecsa({ id: 3, type: 'recharge', name: 'Generic Mobile Credit', operator_id: 9 }, ids), true)
  assert.equal(offerMatchesEtecsa({ id: 4, type: 'recharge', name: 'Generic Mobile Credit', operator_id: 10 }, ids), false)
  assert.equal(offerMatchesEtecsa({ id: 5, type: 'other', name: 'Cubacel 500 CUP' }, ids), false)
  assert.equal(offerMatchesEtecsa({ id: 8, type: 'sim', name: 'Cubacel SIM' }, ids), false)
  assert.equal(offerMatchesEtecsa({ id: 9, type: 'subscription', name: 'Cubacel Subscription' }, ids), false)
  assert.equal(offerMatchesEtecsa({ id: 6, type: 'nauta', name: 'Unknown offer', category_id: 2 }, ids, categoryIds), true)
  assert.equal(offerMatchesEtecsa({ id: 7, type: 'recharge', name: 'Generic top-up', category_id: 3 }, ids, categoryIds), false)
  assert.equal(offerMatchesEtecsa({ id: 10, type: 'recharge', name: 'Bono 25 GB', category_id: 7 }, ids, categoryIds, promotionCategoryIds), true)
  assert.equal(offerMatchesEtecsa({ id: 11, type: 'recharge', name: 'Bono 25 GB', category: { name: 'Promociones' } }, ids), true)
  assert.equal(offerMatchesEtecsa({ id: 12, type: 'nauta', name: 'Cuenta Nauta', category: { name: 'Promociones' } }, ids), true)
  assert.equal(offerMatchesEtecsa({ id: 13, type: 'sim', name: 'SIM promocional', category: { name: 'Promociones' } }, ids), false)
})

test('offers with an unverified currency or no valid priced line are excluded', () => {
  assert.equal(normalizeOffer({ id: 1, type: 'recharge', name: 'Cubacel', currency: { code: 'USD' }, prices: [{ id: 'a', label: '500 CUP', value: '4.2' }] }).prices.length, 1)
  assert.equal(normalizeOffer({ id: 2, type: 'recharge', name: 'Cubacel', currency: { code: 'EUR' }, prices: [{ id: 'a', label: '500 CUP', value: '4.2' }] }), null)
  assert.equal(normalizeOffer({ id: 3, type: 'recharge', name: 'Cubacel', currency: { code: 'USD' }, prices: [{ id: 'a', label: '500 CUP', value: '0' }] }), null)
})

test('client-facing catalog text never exposes non-CUP currencies or foreign currency symbols', () => {
  assert.equal(sanitizeCustomerText('Cubacel 500 CUP · coste 4.20 USD'), 'Cubacel 500 CUP · coste')
  assert.equal(sanitizeCustomerText('Oferta USDT 9.20 EUR'), 'Oferta')
  assert.equal(sanitizeCustomerText('Recarga $4.20'), 'Recarga')
})
