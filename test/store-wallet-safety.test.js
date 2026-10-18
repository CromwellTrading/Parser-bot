'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/017_store_wallet_history_favorites.sql'), 'utf8')
const walletSource = fs.readFileSync(path.join(__dirname, '../src/utils/storeWallet.js'), 'utf8')
const claimsSource = fs.readFileSync(path.join(__dirname, '../src/utils/paymentTransactionClaims.js'), 'utf8')

test('wallet balance cannot become negative and debits lock the wallet row', () => {
  assert.match(migration, /balance_cup numeric\(18,2\) NOT NULL DEFAULT 0 CHECK \(balance_cup >= 0\)/)
  assert.match(migration, /SELECT \* INTO v_wallet FROM public\.store_wallets WHERE client_id = p_client_id FOR UPDATE/)
  assert.match(migration, /IF v_wallet\.balance_cup < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_WALLET_BALANCE'/)
})

test('wallet top-up credits are idempotent and ledger references are unique', () => {
  assert.match(migration, /CONSTRAINT store_wallet_transactions_reference_unique UNIQUE \(client_id, reference_type, reference_id\)/)
  assert.match(migration, /IF v_topup\.status = 'COMPLETED' THEN[\s\S]*?already_processed/)
  assert.match(migration, /store_wallet_credit_topup/)
})

test('each Transfermóvil transaction ID can be claimed for only one official store ticket', () => {
  assert.match(migration, /transaction_id text PRIMARY KEY/)
  assert.match(migration, /store_claim_payment_transaction/)
  assert.match(claimsSource, /'ETECSA', 'GAMEMARKET', 'WALLET_TOPUP'/)
  assert.match(walletSource, /source: 'WALLET_TOPUP'/)
})

test('automatic wallet refunds are restricted to failed wallet-funded orders and are idempotent', () => {
  assert.match(migration, /v_order\.payment_source <> 'WALLET' OR v_order\.status <> 'REFUND_REQUIRED'/)
  assert.match(migration, /reference_type = 'GAME_RECHARGE_REFUND'/)
  assert.match(walletSource, /row\.kind === 'SPEND' && row\.reference_type === 'GAME_RECHARGE'/)
})
