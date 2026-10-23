'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { safeCustomerText, safeAutomationMessage } = require('../src/utils/customerMessages')

test('customer-facing automation status hides backend and supplier names', () => {
  assert.equal(safeAutomationMessage('Problema en Supabase y Render'), 'El servicio está temporalmente fuera de línea. Inténtalo más tarde.')
  assert.equal(safeAutomationMessage('Soky no responde'), 'El servicio está temporalmente fuera de línea. Inténtalo más tarde.')
})

test('customer-facing sanitization preserves helpful text without internal references', () => {
  assert.equal(safeCustomerText('El pedido sigue en proceso.', 'Mensaje genérico'), 'El pedido sigue en proceso.')
  assert.equal(safeCustomerText('Error de RechargeGames', 'Contacta con soporte.'), 'Contacta con soporte.')
  assert.equal(safeCustomerText('', 'Contacta con soporte.'), 'Contacta con soporte.')
})
