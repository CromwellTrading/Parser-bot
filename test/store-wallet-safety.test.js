'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/017_store_wallet_history_favorites.sql'), 'utf8')
const walletSource = fs.readFileSync(path.join(__dirname, '../src/utils/storeWallet.js'), 'utf8')
const claimsSource = fs.readFileSync(path.join(__dirname, '../src/utils/paymentTransactionClaims.js'), 'utf8')
const reliabilityMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/018_wallet_payment_reliability.sql'), 'utf8')
const storeAccountRoute = fs.readFileSync(path.join(__dirname, '../src/routes/storeAccount.js'), 'utf8')
const reconcilerSource = fs.readFileSync(path.join(__dirname, '../src/utils/paymentSmsReconciler.js'), 'utf8')
const mainActivityPath = path.resolve(__dirname, '../../SMS-relay-main/app/src/main/java/com/synthesisone/app/MainActivity.kt')
const mainActivitySource = fs.existsSync(mainActivityPath) ? fs.readFileSync(mainActivityPath, 'utf8') : null
const etecsaOrdersSource = fs.readFileSync(path.join(__dirname, '../src/utils/etecsaOrders.js'), 'utf8')
const gameOrdersSource = fs.readFileSync(path.join(__dirname, '../src/utils/rechargeGamesOrders.js'), 'utf8')
const refundMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/020_game_wallet_refund_reliability.sql'), 'utf8')

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
  assert.match(walletSource, /row\.kind === 'SPEND' && \['GAME_RECHARGE', 'STORE_CART'\]\.includes\(String\(row\.reference_type \|\| ''\)\.toUpperCase\(\)\)/)
})


test('wallet credit RPC repairs missing wallet rows from the ledger and returns the stored balance', () => {
  assert.match(reliabilityMigration, /INSERT INTO public\.store_wallets \(client_id, balance_cup, total_credited_cup, total_spent_cup\)[\s\S]*?ON CONFLICT \(client_id\) DO NOTHING/)
  assert.match(reliabilityMigration, /RETURN jsonb_build_object\('already_processed', true, 'ledger_repaired', v_ledger_repaired,[\s\S]*?'balance_cup', COALESCE\(v_balance,0\)\)/)
  assert.match(reliabilityMigration, /WALLET_BALANCE_LEDGER_MISMATCH/)
})

test('a stored balance already containing this top-up is never incremented again without matching stored payment evidence', () => {
  assert.match(reliabilityMigration, /v_same_payment_evidence :=[\s\S]*?payment_review_sms_log_id = p_payment_sms_log_id/)
  assert.match(reliabilityMigration, /balance_cup - \(v_ledger_net \+ v_topup\.amount_cup\)\) <= 0\.01 AND v_same_payment_evidence/)
  assert.match(reliabilityMigration, /Balance happens to differ by this amount[\s\S]*?RAISE EXCEPTION 'WALLET_BALANCE_LEDGER_MISMATCH'/)
})

test('wallet status refresh endpoint reconciles saved SMS and returns ticket plus current balance', () => {
  assert.match(walletSource, /async function refreshTopupStatus\(clientId, topupId\)/)
  assert.match(walletSource, /readAllRows\(\(\) => supabase\.from\('sms_logs'\)/)
  assert.match(walletSource, /getWalletSummary\(clientId\)/)
  assert.match(storeAccountRoute, /router\.post\('\/wallet\/topups\/:id\/refresh'/)
  assert.match(storeAccountRoute, /wallet: result\.wallet, refreshed: result\.refreshed/)
})

test('automatic SMS reconciliation skips empty workloads and scans paged records rather than only the newest 300', () => {
  assert.match(reconcilerSource, /NO_RECONCILABLE_TICKETS/)
  assert.match(reconcilerSource, /boundedIntegerEnv\('PAYMENT_SMS_RECONCILE_MAX_ROWS', 10_000, 500, 20_000\)/)
  assert.match(reconcilerSource, /\.range\(offset, Math\.min\(offset \+ PAGE_SIZE - 1, MAX_SMS_ROWS - 1\)\)/)
})

test('Android shows a manual refresh button and requests the reconciliation endpoint', (t) => {
  if (!mainActivitySource) return t.skip('Android app se comprueba en el repositorio SMS-relay')
  assert.match(mainActivitySource, /setNeutralButton\("🔄 ACTUALIZAR", null\)/)
  assert.match(mainActivitySource, /wallet\/topups\/\$id\/refresh/)
  assert.match(mainActivitySource, /Saldos actuales independientes:/)
})


test('completed wallet topups do not clear review when stored balance differs from the ledger', () => {
  assert.match(reliabilityMigration, /IF v_topup\.status = 'COMPLETED' THEN[\s\S]*?WALLET_BALANCE_LEDGER_MISMATCH[\s\S]*?payment_review_at = NULL/)
})

test('refresh retries the idempotent repair RPC for completed topups under review', () => {
  assert.match(walletSource, /if \(topup\.status === 'COMPLETED'\)[\s\S]*?store_wallet_credit_topup/)
  assert.match(reconcilerSource, /PAYMENT_RECONCILE_COMPLETED_WALLET_REPAIR_OK/)
})

test('ETECSA and Game Market payment matching page through recent tickets rather than truncating to 12 or 500', () => {
  for (const source of [etecsaOrdersSource, gameOrdersSource, walletSource]) {
    assert.match(source, /readAllRows/)
    assert.match(source, /maxRows: 100_000/)
  }
  assert.doesNotMatch(etecsaOrdersSource, /limit\(isDestinationReceipt \? 500 : 12\)/)
  assert.doesNotMatch(gameOrdersSource, /limit\(isDestinationReceipt \? 500 : 12\)/)
})

test('Wallet UI never silently substitutes zero when balance_cup is absent and shows integrity warnings', (t) => {
  if (!mainActivitySource) return t.skip('Android app se comprueba en el repositorio SMS-relay')
  assert.match(mainActivitySource, /!wallet\.has\("balance_cup"\)/)
  assert.match(mainActivitySource, /walletIntegrity.*healthy/)
  assert.match(mainActivitySource, /render\(next, fetchBalance = false\)/)
})

test('refund recovery migration marks refunded orders atomically and preserves a unique refund movement', () => {
  assert.match(refundMigration, /ADD COLUMN IF NOT EXISTS wallet_refunded_at timestamptz/)
  assert.match(refundMigration, /status = 'REFUNDED',[\s\S]*?wallet_refunded_at = now\(\)/)
  assert.match(refundMigration, /reference_type = 'GAME_RECHARGE_REFUND'/)
  assert.match(refundMigration, /WALLET_REFUND_AMOUNT_MISMATCH/)
  assert.match(refundMigration, /WALLET_REFUND_LEDGER_MISSING/)
  assert.match(refundMigration, /GRANT EXECUTE ON FUNCTION public\.store_wallet_refund_game_order\(uuid\) TO service_role/)
})


test('a wrong destination card is not treated as a possible Wallet payment needing soft review', () => {
  const matching = require('../src/utils/walletPaymentMatching')
  const parsed = { direction: 'RECIBIDO', network: 'PAGOMOVIL', currency: 'CUP', type: 'TARJETA_TARJETA', amount: 1580, receiver_account: '00000000000000000000', sender_phone: '59123456', transaction_at: '2026-10-18T02:10:00.000Z' }
  const ticket = { amount_cup: 1580, payer_phone: '59123456', destination_card: '99999999999999999999', confirmation_phone: '59111111', created_at: '2026-10-18T02:00:00.000Z', payment_deadline_at: '2026-10-18T02:30:00.000Z' }
  const result = matching.isPotentialWalletTopupPayment(parsed, ticket, '2026-10-18T02:10:00.000Z')
  assert.equal(result, false)
})


test('invalid wallet/reconciler environment values fall back safely rather than disabling max or causing a tight loop', () => {
  assert.match(walletSource, /Number\.isSafeInteger\(value\) && value > 0 \? value : fallback/)
  assert.match(reconcilerSource, /Number\.isSafeInteger\(value\)/)
  assert.match(reconcilerSource, /boundedIntegerEnv\('PAYMENT_SMS_RECONCILE_INTERVAL_MS', 90_000, 60_000/)
})

test('completed top-up without a ledger movement is repaired only with the exact stored payment evidence', () => {
  assert.match(reliabilityMigration, /IF abs\(v_wallet\.balance_cup - \(v_ledger_net \+ v_topup\.amount_cup\)\) <= 0\.01 AND v_same_payment_evidence THEN[\s\S]*?TOPUP_COMPLETED_LEDGER_MISSING_REVIEW_REQUIRED/)
  assert.match(reliabilityMigration, /v_same_payment_evidence :=[\s\S]*?payment_review_sms_log_id = p_payment_sms_log_id/)
})

test('Wallet-funded game orders refuse to spend when the balance and ledger are inconsistent', () => {
  assert.match(reliabilityMigration, /CREATE OR REPLACE FUNCTION public\.store_wallet_create_game_order[\s\S]*?WALLET_BALANCE_LEDGER_MISMATCH/)
  assert.match(reliabilityMigration, /WALLET_TOPUP_LEDGER_MISSING/)
})

test('wallet refund reconciliation retries pending refunds even if provider configuration is unavailable', () => {
  assert.match(gameOrdersSource, /async function refundFailedWalletOrder\(orderId\)[\s\S]*?store_wallet_refund_cart_item[\s\S]*?store_wallet_refund_game_order/)
  assert.match(gameOrdersSource, /GAME_RECHARGE_WALLET_REFUND_RETRY_SUCCEEDED/)
  assert.match(gameOrdersSource, /wallet_refunded_at', null[\s\S]*?refundFailedWalletOrder\(order\.id\)/)
  const reconcile = gameOrdersSource.indexOf('async function reconcileProcessingOrders()')
  const retrySuccess = gameOrdersSource.indexOf('GAME_RECHARGE_WALLET_REFUND_RETRY_SUCCEEDED', reconcile)
  const providerGate = gameOrdersSource.indexOf("if (!String(process.env.RECHARGEGAMES_API_KEY", reconcile)
  assert.ok(retrySuccess >= reconcile && providerGate > retrySuccess, 'refund recovery must run before provider API configuration is checked')
})

test('expired ticket reads re-fetch the authoritative status if the expiry update loses a race', () => {
  assert.match(walletSource, /if \(expired\) return publicTopup\(expired\)[\s\S]*?const \{ data: latest, error: latestError \}[\s\S]*?return publicTopup\(latest \|\| data\)/)
})

test('potential payment with exact amount and destination but a delayed bank timestamp is flagged for review', () => {
  const matching = require('../src/utils/walletPaymentMatching')
  const parsed = { direction: 'RECIBIDO', network: 'PAGOMOVIL', currency: 'CUP', type: 'TARJETA_TARJETA', amount: 1580, receiver_account: '99999999999999999999', sender_phone: '59123456', transaction_at: '2026-10-18T03:30:00.000Z' }
  const ticket = { amount_cup: 1580, payer_phone: '59123456', destination_card: '99999999999999999999', confirmation_phone: '59111111', created_at: '2026-10-18T02:00:00.000Z', payment_deadline_at: '2026-10-18T02:30:00.000Z' }
  assert.equal(matching.isPotentialWalletTopupPayment(parsed, ticket, '2026-10-18T03:30:02.000Z'), true)
})

test('Android never interprets a missing Wallet balance as zero at checkout', (t) => {
  if (!mainActivitySource) return t.skip('Android app se comprueba en el repositorio SMS-relay')
  assert.match(mainActivitySource, /Saldo no confirmado[\s\S]*?val balanceCup = wallet\.optDouble\("balance_cup", Double\.NaN\)/)
  assert.doesNotMatch(mainActivitySource, /optDouble\("balance_cup", 0\.0\)/)
})

test('Wallet payment ambiguity or a receipt claimed by another ticket becomes a visible review state', () => {
  assert.match(walletSource, /PAYMENT_MATCH_OVERLAPS_OTHER_STORE/)
  assert.match(walletSource, /PAYMENT_ALREADY_ATTACHED_TO_ANOTHER_ORDER/)
  assert.match(walletSource, /PAYMENT_TRANSACTION_ALREADY_CLAIMED[\s\S]*?markPotentialTopupsForReview/)
})

test('refunds are idempotent and are blocked when the Wallet ledger is inconsistent', () => {
  assert.match(reliabilityMigration, /CREATE OR REPLACE FUNCTION public\.store_wallet_refund_game_order[\s\S]*?WALLET_BALANCE_LEDGER_MISMATCH/)
  assert.match(reliabilityMigration, /WALLET_TOPUP_LEDGER_MISSING/)
  assert.match(reliabilityMigration, /already_refunded', true, 'balance_cup', v_wallet\.balance_cup/)
})

test('idempotent wallet game purchase responses return the current locked balance, not an old movement snapshot', () => {
  assert.match(reliabilityMigration, /already_processed', true, 'order', to_jsonb\(v_order\), 'balance_cup', v_wallet\.balance_cup/)
  assert.match(reliabilityMigration, /FROM public\.store_wallets WHERE client_id = p_client_id FOR UPDATE/)
})

test('periodic repair scans all reviewed completed Wallet top-ups rather than silently stopping at 100', () => {
  assert.match(reconcilerSource, /const reviewedCompletedWallet = await readAllRows[\s\S]*?maxRows: 100_000/)
  assert.doesNotMatch(reconcilerSource, /payment_review_at', 'is', null\)[\s\S]*?limit\(100\)/)
})


test('Wallet-funded purchases do not depend on personal SMS automation settings', () => {
  const start = gameOrdersSource.indexOf('async function createWalletGameOrder(')
  const end = gameOrdersSource.indexOf('async function getRecentOrders(', start)
  assert.ok(start >= 0 && end > start)
  const walletPurchase = gameOrdersSource.slice(start, end)
  assert.doesNotMatch(walletPurchase, /getAutomationAvailability\(/)
  assert.match(walletPurchase, /store_wallet_create_game_order/)
})

test('an immediate Wallet refund returns the final server state instead of stale REFUND_REQUIRED', () => {
  const start = gameOrdersSource.indexOf('async function createWalletGameOrder(')
  const end = gameOrdersSource.indexOf('async function getRecentOrders(', start)
  const walletPurchase = gameOrdersSource.slice(start, end)
  assert.match(walletPurchase, /const submitted = await submitProviderOrder|submitted = await submitProviderOrder/)
  assert.match(walletPurchase, /GAME_RECHARGE_WALLET_SUBMISSION_DEFERRED/)
  assert.match(walletPurchase, /let finalSubmitted = submitted/)
  assert.match(walletPurchase, /refundFailedWalletOrder\(orderId\)/)
  assert.match(walletPurchase, /select\('\*'\)\.eq\('id', orderId\)\.maybeSingle\(\)/)
  assert.match(walletPurchase, /if \(refreshed\) finalSubmitted = publicOrder\(refreshed\)/)
})

test('refund retries happen before provider API-key gating and refunded orders are terminal', () => {
  const reconcile = gameOrdersSource.indexOf('async function reconcileProcessingOrders()')
  const retrySuccess = gameOrdersSource.indexOf('GAME_RECHARGE_WALLET_REFUND_RETRY_SUCCEEDED', reconcile)
  const providerGate = gameOrdersSource.indexOf("if (!String(process.env.RECHARGEGAMES_API_KEY", reconcile)
  assert.ok(retrySuccess >= reconcile && providerGate > retrySuccess)
  assert.match(refundMigration, /status = 'REFUNDED',[\s\S]*?wallet_refunded_at = now\(\)/)
  assert.match(gameOrdersSource, /order\.status === 'REFUNDED'[\s\S]*?GAME_RECHARGE_PROVIDER_TERMINAL_CONFLICT/)
})
