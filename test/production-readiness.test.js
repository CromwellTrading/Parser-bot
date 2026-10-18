'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('Wallet refund retry rotates failed tickets to avoid permanently starving later refunds', () => {
  const source = read('src/utils/rechargeGamesOrders.js')
  assert.match(source, /GAME_RECHARGE_WALLET_REFUND_RETRY_FAILED[\s\S]*?GAME_RECHARGE_WALLET_REFUND_RETRY_ROTATE_FAILED/)
  assert.match(source, /update\(\{ updated_at: nowIso\(\) \}\)\.eq\('id', order\.id\)\.eq\('status', 'REFUND_REQUIRED'\)/)
  assert.match(source, /if \(!String\(process\.env\.RECHARGEGAMES_API_KEY/)
})

test('Wallet-funded order route stays independent from owner automation toggle', () => {
  const source = read('src/utils/rechargeGamesOrders.js')
  const start = source.indexOf('async function createWalletGameOrder(')
  const end = source.indexOf('async function getRecentOrders(', start)
  assert.ok(start >= 0 && end > start)
  const segment = source.slice(start, end)
  assert.doesNotMatch(segment, /getAutomationAvailability\(/)
  assert.match(segment, /store_wallet_create_game_order/)
})


test('wallet purchase actually submits provider order after atomic debit and safely returns persisted order on transient submission errors', () => {
  const source = read('src/utils/rechargeGamesOrders.js')
  const start = source.indexOf('async function createWalletGameOrder(')
  const end = source.indexOf('async function getRecentOrders(', start)
  const segment = source.slice(start, end)
  assert.match(segment, /submitted = await submitProviderOrder\(orderId, \{ playerId, serverId \}\)/)
  assert.match(segment, /GAME_RECHARGE_WALLET_SUBMISSION_DEFERRED/)
  assert.match(segment, /if \(rpcData\?\.already_processed\) return createdOrder \|\| publicOrder\(rawOrder\)/)
})


test('Wallet Android purchase persists idempotency key across lost HTTP responses', {
  skip: !fs.existsSync(path.resolve(root, '../SMS-relay-main/app/src/main/java/com/synthesisone/app/MainActivity.kt'))
}, () => {
  const android = fs.readFileSync(path.resolve(root, '../SMS-relay-main/app/src/main/java/com/synthesisone/app/MainActivity.kt'), 'utf8')
  const start = android.indexOf('private fun beginGameRechargeWalletCheckout(')
  const end = android.indexOf('private fun beginGameRechargeCheckout(', start)
  const segment = android.slice(start, end)
  assert.match(segment, /wallet_game_order_idempotency_/)
  assert.match(segment, /prefs\.getString\(idempotencyScope, null\)/)
  assert.match(segment, /put\("idempotency_key", idempotencyKey\)/)
  assert.match(segment, /Keep the same key on transport\/5xx errors/)
  assert.match(segment, /remove\(idempotencyScope\)/)
})

test('public session creation and admin login have bounded attempt rates', () => {
  const rateLimit = read('src/utils/ipRateLimit.js')
  const storeSession = read('src/routes/storeSession.js')
  const panel = read('src/routes/panel.js')
  assert.match(rateLimit, /maxKeys = 10000/)
  assert.match(storeSession, /max: 30/)
  assert.match(storeSession, /router\.post\('\/register', registrationRateLimit/)
  assert.match(panel, /max: 8/)
  assert.match(panel, /router\.post\('\/login', adminLoginRateLimit/)
})

test('migration 020 makes Wallet refund and order state atomic and identifies contradictory historical refunds', () => {
  const sql = read('supabase/migrations/020_game_wallet_refund_reliability.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS wallet_refunded_at timestamptz/)
  assert.match(sql, /status = 'REFUNDED',[\s\S]*?wallet_refunded_at = now\(\)/)
  assert.match(sql, /wallet-refund-delivery-conflict:/)
  assert.match(sql, /WALLET_REFUND_AMOUNT_MISMATCH/)
  assert.match(sql, /WALLET_REFUND_LEDGER_MISSING/)
})

test('IP rate limiter returns 429 after the configured attempt budget and resets after expiry', () => {
  const { createIpRateLimiter } = require('../src/utils/ipRateLimit')
  let now = 1000
  const middleware = createIpRateLimiter({ windowMs: 10000, max: 1, now: () => now, maxKeys: 10 })
  const request = { ip: '203.0.113.9', socket: { remoteAddress: '127.0.0.1' } }
  const results = []
  const response = () => ({
    headers: {}, statusCode: 200, body: null,
    setHeader(k, v) { this.headers[k] = v; return this },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  })
  const first = response()
  let nextCalls = 0
  middleware(request, first, () => { nextCalls++ })
  assert.equal(first.statusCode, 200)
  const second = response()
  middleware(request, second, () => { nextCalls++ })
  assert.equal(second.statusCode, 429)
  assert.ok(Number(second.headers['Retry-After']) > 0)
  assert.equal(nextCalls, 1)
  now += 10001
  const third = response()
  middleware(request, third, () => { nextCalls++ })
  assert.equal(third.statusCode, 200)
  assert.equal(nextCalls, 2)
})
