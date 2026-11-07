'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { extractAssistantPayload, sanitizeAssistantActions, buildSystemPrompt } = require('../src/utils/assistantService')

const wrap = obj => ({ choices: [{ message: { content: JSON.stringify(obj) } }] })

test('valid actions and suggestions pass through the whitelist', () => {
  const out = extractAssistantPayload(wrap({
    reply: 'Te dejo la tarjeta.', emotion: 'confident', gesture: 'nod', mood_text: 'x',
    actions: [
      { type: 'reseller_calc', unit_cost: 900, unit_price: '1200', quantity: 10, currency: 'cup', label: 'Diamantes' },
      { type: 'open_game', query: 'Mobile Legends', label: 'Ver ofertas' },
      { type: 'navigate', target: 'wallet', label: 'Wallet' },
    ],
    suggestions: ['¿Y si vendo a 1500?', 'ok'],
  }))
  assert.equal(out.actions.length, 3)
  assert.equal(out.actions[0].currency, 'CUP')
  assert.equal(out.actions[0].unit_price, 1200)
  assert.deepEqual(out.suggestions, ['¿Y si vendo a 1500?', 'ok'])
})

test('unknown, financial or malformed actions are dropped', () => {
  const actions = sanitizeAssistantActions([
    { type: 'pay', amount: 5000 },
    { type: 'navigate', target: 'admin' },
    { type: 'open_game', query: '<script>x</script>' },
    { type: 'reseller_calc', unit_cost: -4, unit_price: 10, quantity: 2 },
    { type: 'reseller_calc', unit_cost: 'abc', unit_price: 10, quantity: 2 },
    { type: 'refund' },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'open_game')
  assert.ok(!/[<>]/.test(actions[0].query))
})

test('at most three actions and plain text fallback has none', () => {
  const many = Array.from({ length: 8 }, () => ({ type: 'navigate', target: 'home' }))
  assert.equal(sanitizeAssistantActions(many).length, 3)
  const plain = extractAssistantPayload({ choices: [{ message: { content: 'hola' } }] })
  assert.deepEqual(plain.actions, [])
  assert.deepEqual(plain.suggestions, [])
})

test('system prompt documents actions and keeps the no-payment rule', () => {
  const prompt = buildSystemPrompt()
  assert.match(prompt, /reseller_calc/)
  assert.match(prompt, /nunca pongas acciones de ese tipo/)
  assert.match(prompt, /seis campos/)
})
