'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { buildRechargeGamesOrderPayload } = require('../src/utils/rechargeGamesOrderPayload')

const sourcePath = path.join(__dirname, '..', 'src', 'utils', 'rechargeGamesOrders.js')
const source = fs.readFileSync(sourcePath, 'utf8')
const start = source.indexOf('function makeTicket(id)')
const end = source.indexOf('\nasync function notifyAdmins', start)
assert.ok(start >= 0 && end > start, 'the public-order serializer source must remain available')
const serializers = vm.runInNewContext(`(() => { ${source.slice(start, end)}; return { publicOrder }; })()`)


test('transfer payment response includes destination card and confirmation phone', () => {
  const order = serializers.publicOrder({
    id: '12345678-1234-1234-1234-123456789abc',
    status: 'WAITING_PAYMENT',
    payment_source: 'TRANSFERMOVIL',
    destination_card: '1234567890123456',
    confirmation_phone: '51234567',
    payment_amount: 2500,
    price_basis: 'CUP',
    provider_delivery: 'code',
  })
  assert.equal(order.destination_card, '1234567890123456')
  assert.equal(order.confirmation_phone, '51234567')
  assert.equal(order.payment.card, '1234567890123456')
  assert.equal(order.payment.confirmation_phone, '51234567')
})

test('missing transfer details are explicit nulls instead of a misleading empty payment object', () => {
  const order = serializers.publicOrder({
    id: '12345678-1234-1234-1234-123456789abc',
    status: 'WAITING_PAYMENT',
    payment_source: 'TRANSFERMOVIL',
    payment_amount: 2500,
    price_basis: 'CUP',
  })
  assert.equal(order.destination_card, null)
  assert.equal(order.confirmation_phone, null)
  assert.equal(order.payment.card, null)
  assert.equal(order.payment.confirmation_phone, null)
})

test('delivered redeem-code order preserves delivery note for purchase history', () => {
  const order = serializers.publicOrder({
    id: '12345678-1234-1234-1234-123456789abc',
    status: 'COMPLETED',
    provider_status: 'delivered',
    provider_delivery: 'code',
    provider_delivery_note: 'HK-REDEEM-EXAMPLE-123',
    payment_amount: 9200,
    price_basis: 'CUP',
  })
  assert.equal(order.provider_delivery, 'code')
  assert.equal(order.provider_status, 'delivered')
  assert.equal(order.delivery_note, 'HK-REDEEM-EXAMPLE-123')
})

test('redeem-code provider payload can be sent without a player ID and keeps the original buyer reference', () => {
  const payload = buildRechargeGamesOrderPayload({
    provider_product_key: 'honor-of-kings/global/token-redeem/sku123',
    provider_product_name: 'Honor of Kings Token Redeem',
    buyer_ref: 'SO-order-123',
    provider_delivery: 'code',
  })
  assert.equal(payload.product_key, 'honor-of-kings/global/token-redeem/sku123')
  assert.equal(payload.buyer_ref, 'SO-order-123')
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'player_id'), false)
})

test('manual payment and code recovery endpoints are behind the existing admin guard', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'gameRecharges.js'), 'utf8')
  assert.match(routeSource, /router\.get\('\/admin\/payment-review', requireAdmin/)
  assert.match(routeSource, /router\.post\('\/admin\/orders\/:id\/confirm-payment', requireAdmin/)
  assert.match(routeSource, /router\.post\('\/admin\/orders\/:id\/recover-delivery', requireAdmin/)
})

test('Android receipt displays a redeem code and supports copying it from the ticket/history', (t) => {
  const androidPath = path.join(__dirname, '..', '..', 'SMS-relay-main', 'app', 'src', 'main', 'java', 'com', 'synthesisone', 'app', 'MainActivity.kt')
  if (!fs.existsSync(androidPath)) return t.skip('Android source is validated in the SMS-relay repository')
  const androidSource = fs.readFileSync(androidPath, 'utf8')
  assert.match(androidSource, /providerDelivery == "code"/)
  assert.match(androidSource, /CÓDIGO DE CANJE/)
  assert.match(androidSource, /COPIAR CÓDIGO/)
  assert.match(androidSource, /ClipData\.newPlainText\("Código de canje", deliveryNote\)/)
})
