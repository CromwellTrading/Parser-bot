'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('cart and rewards are opt-in and fail closed until all readiness sentinels match', () => {
  const policy = read('src/utils/cartFeaturePolicy.js')
  assert.match(policy, /SYNTHESIS_CART_ENABLED[\s\S]*=== 'true'/)
  assert.match(policy, /SYNTHESIS_REWARDS_ENABLED[\s\S]*=== 'true'/)
  assert.match(policy, /Number\(cartSentinel\?\.data\?\.schema_version\) === 1/)
  assert.match(policy, /Number\(rewardsSentinel\?\.data\?\.schema_version\) === 1/)
  assert.match(policy, /keep_legacy_checkout_available/)
  assert.match(policy, /STALE_CART_BUILD_RECOVERY/)
  assert.match(policy, /now - buildStarted > 5 \* 60 \* 1000/)
})

test('service readiness does not depend on optional reward/cart tables', () => {
  const entry = read('src/index.js')
  const ready = entry.slice(entry.indexOf("app.get('/readyz'"), entry.indexOf("app.get('/',"))
  assert.match(ready, /store_wallets/)
  assert.match(ready, /store_wallet_transactions/)
  assert.doesNotMatch(ready, /reward_profiles|store_cart_orders|reward_schema_status/)
})

test('duplicate and new SMS paths try cart reconciliation before legacy tickets and stop on ambiguity', () => {
  const sms = read('src/routes/sms.js')
  assert.match(sms, /if \(!cartOrderUpdate && !ambiguousCartPayment\)/)
  assert.match(sms, /if \(cartFeature\.enabled\) cartOrderUpdate = await processCartTransfer/)
  assert.ok((sms.match(/if \(!cartOrderUpdate && !ambiguousCartPayment\)/g) || []).length >= 2)
})

test('wallet cart uses atomic debit and line-level idempotent refunds; legacy refund blocks cart children', () => {
  const sql = read('supabase/migrations/027_store_cart_orders.sql')
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.store_wallet_create_cart_order/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.store_wallet_refund_cart_item/)
  assert.match(sql, /CART_ORDER_REQUIRES_CART_REFUND_RPC/)
  assert.match(sql, /WHERE client_id=p_client_id AND idempotency_key=p_idempotency_key/)
  assert.match(sql, /ON CONFLICT \(transaction_id\) DO NOTHING/)
})

test('cart reward progress is finalized only after all lines have reached a terminal state', () => {
  const cartOrders = read('src/utils/storeCartOrders.js')
  assert.match(cartOrders, /const terminalLines = next\.every\(line => \['COMPLETED', 'REFUNDED'\]/)
  assert.match(cartOrders, /if \(!walletRefundPending && terminalLines\)/)
  assert.match(cartOrders, /const retainedLines = next\.filter\(line => String\(line\.status \|\| ''\)\.toUpperCase\(\) === 'COMPLETED'\)/)
  assert.match(cartOrders, /reward_item_count: new Set\(retainedLines\.map\(line => `\$\{String\(line\.source \|\| ''\)\.toUpperCase\(\)\}:\$\{String\(line\.offer_id \|\| ''\)\}:\$\{String\(line\.price_id \|\| ''\)\}`\)\)\.size/)
})

test('readiness migration backfills existing paid purchase history before marking rewards ready', () => {
  const sql = read('supabase/migrations/028_rewards_schema_readiness.sql')
  assert.match(sql, /SYNTHESIS_REWARDS_MIGRATIONS_INCOMPLETE/)
  assert.match(sql, /first_paid_purchase_at=COALESCE/)
  assert.match(sql, /purchase_history_checked_at=now\(\)/)
  assert.match(sql, /FROM public\.store_cart_orders[\s\S]*?status <> 'REFUNDED'/)
  assert.match(read('src/utils/rewards.js'), /from\('store_cart_orders'\)[\s\S]*?cupCart/)
  assert.ok(sql.indexOf('UPDATE public.reward_profiles') < sql.indexOf("VALUES ('rewards-v1', 1, now())"))
})

test('flash missions are exposed through the authenticated admin panel, not public client routes', () => {
  const panel = read('src/routes/panel.js')
  assert.match(panel, /router\.use\('\/api', \(req, res, next\)/)
  assert.match(panel, /router\.get\('\/api\/rewards\/campaigns'/)
  assert.match(panel, /router\.post\('\/api\/rewards\/campaigns'/)
  assert.match(panel, /Misiones flash/)
})
