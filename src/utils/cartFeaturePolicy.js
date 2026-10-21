'use strict'

const supabase = require('../supabase')

function cartEnabled(env = process.env) {
  return String(env?.SYNTHESIS_CART_ENABLED || '').trim().toLowerCase() === 'true'
}
function rewardsEnabled(env = process.env) {
  return String(env?.SYNTHESIS_REWARDS_ENABLED || '').trim().toLowerCase() === 'true'
}

let state = { ready: false, checkedAt: 0 }
async function cartSchemaReady({ force = false } = {}) {
  if (!cartEnabled() || !rewardsEnabled()) return false
  const now = Date.now()
  const ttl = state.ready ? 60_000 : 5_000
  if (!force && now - state.checkedAt < ttl) return state.ready
  try {
    const checks = await Promise.all([
      supabase.from('store_cart_orders').select('id,client_id,status,payment_source,price_basis,item_count,request_fingerprint', { head: true, count: 'exact' }).limit(1),
      supabase.from('store_cart_schema_status').select('schema_version').eq('id', 'cart-v1').maybeSingle(),
      supabase.from('reward_schema_status').select('schema_version').eq('id', 'rewards-v1').maybeSingle(),
      supabase.from('store_cart_items').select('id,cart_id,line_no,source,child_order_id,status', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_profiles').select('client_id,referral_code,device_id,welcome_started_at', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_coupons').select('id,client_id,status,reserved_order_ref', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_purchase_events').select('id,source,has_game_market,has_etecsa', { head: true, count: 'exact' }).limit(1),
      supabase.from('reward_campaigns').select('id,campaign_key,active', { head: true, count: 'exact' }).limit(1),
      supabase.from('store_payment_transaction_claims').select('transaction_id,source,order_id', { head: true, count: 'exact' }).limit(1),
      supabase.from('game_recharge_orders').select('store_cart_id,reward_base_amount,reward_discount_percent,reward_discount_amount,reward_coupon_id,welcome_discount', { head: true, count: 'exact' }).limit(1),
      supabase.from('etecsa_orders').select('store_cart_id,reward_base_amount,reward_discount_percent,reward_discount_amount,reward_coupon_id,welcome_discount', { head: true, count: 'exact' }).limit(1),
    ])
    const cartSentinel = checks[1]
    const rewardsSentinel = checks[2]
    state = { ready: checks.every(result => !result?.error) && Number(cartSentinel?.data?.schema_version) === 1 && Number(rewardsSentinel?.data?.schema_version) === 1, checkedAt: now }
  } catch (_) {
    state = { ready: false, checkedAt: now }
  }
  if (!state.ready) console.warn(JSON.stringify({ event: 'CART_SCHEMA_NOT_READY', action: 'keep_legacy_checkout_available' }))
  return state.ready
}

async function cartFeatureAvailable() {
  return cartEnabled() && rewardsEnabled() && await cartSchemaReady()
}

/**
 * Legacy single-item checkout paths consult this before creating new tickets.
 * The check is deliberately fail-open when the optional cart feature or schema is
 * disabled, so a partial rollout cannot interrupt current checkout.
 */
async function assertNoWaitingCart(clientId) {
  if (!cartEnabled() || !rewardsEnabled() || !(await cartSchemaReady())) return
  try {
    const { data, error } = await supabase.from('store_cart_orders').select('id,status,payment_deadline_at')
      .eq('client_id', clientId).in('status', ['BUILDING_CART', 'WAITING_PAYMENT'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    if (!data) return
    const now = Date.now()
    if (data.status === 'WAITING_PAYMENT' && data.payment_deadline_at && now > Date.parse(data.payment_deadline_at)) {
      await supabase.from('store_cart_orders').update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
        .eq('id', data.id).eq('status', 'WAITING_PAYMENT')
      return
    }
    // A process termination during transfer-cart construction can leave BUILDING_CART
    // before the normal catch handler marks it canceled. Recover only after a short
    // grace period; never expire a cart while a request is still assembling it.
    const buildStarted = Date.parse(data.updated_at || data.created_at || '')
    if (data.status === 'BUILDING_CART' && Number.isFinite(buildStarted) && now - buildStarted > 5 * 60 * 1000) {
      await supabase.from('store_cart_orders').update({ status: 'CANCELED', failure_reason: 'STALE_CART_BUILD_RECOVERY', updated_at: new Date(now).toISOString() })
        .eq('id', data.id).eq('status', 'BUILDING_CART')
      return
    }
    const e = new Error('Tienes un carrito pendiente de pago. Complétalo o cancélalo antes de iniciar otra compra.')
    e.status = 409; e.code = 'CART_CHECKOUT_ACTIVE'
    throw e
  } catch (error) {
    if (error?.code === 'CART_CHECKOUT_ACTIVE') throw error
    // A missing optional table must never break a legacy purchase. Cart endpoints
    // independently return unavailable until all schemas are confirmed.
    console.warn(JSON.stringify({ event: 'CART_GUARD_SKIPPED', code: error?.code || 'CART_SCHEMA_ERROR' }))
  }
}

module.exports = { cartEnabled, rewardsEnabled, cartSchemaReady, cartFeatureAvailable, assertNoWaitingCart }
