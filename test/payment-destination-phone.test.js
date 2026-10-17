const test = require('node:test')
const assert = require('node:assert/strict')
const { isConfiguredPaymentReceiver } = require('../src/utils/etecsaPaymentMatching')

test('a received payment SMS can only confirm orders for its configured receiver phone', () => {
  assert.equal(isConfiguredPaymentReceiver({ phone_number: '5359190241' }, { confirmation_phone: '+53 5919 0241' }), true)
  assert.equal(isConfiguredPaymentReceiver({ phone_number: '+53 5263 2617' }, { confirmation_phone: '59190241' }), false)
  assert.equal(isConfiguredPaymentReceiver({ phone_number: '' }, { confirmation_phone: '59190241' }), false)
  assert.equal(isConfiguredPaymentReceiver(null, { confirmation_phone: '59190241' }), false)
})
