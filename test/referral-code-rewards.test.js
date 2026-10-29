'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { referralCodeEntryRewardPlan, REFERRAL_CODE_ENTRY_COUPON_PERCENT, REFERRAL_CODE_BATCH_COUPON_PERCENT, isReciprocalReferral } = require('../src/utils/referralCodeRewards')

test('first accepted referral code qualifies for one 2% coupon', () => {
  assert.equal(REFERRAL_CODE_ENTRY_COUPON_PERCENT, 2)
  assert.equal(referralCodeEntryRewardPlan(0).firstCodeCouponEligible, false)
  assert.equal(referralCodeEntryRewardPlan(1).firstCodeCouponEligible, true)
})

test('3% code-entry milestone is earned at each completed group of 15', () => {
  assert.equal(REFERRAL_CODE_BATCH_COUPON_PERCENT, 3)
  assert.deepEqual(referralCodeEntryRewardPlan(14).batchThresholds, [])
  assert.deepEqual(referralCodeEntryRewardPlan(15).batchThresholds, [15])
  assert.deepEqual(referralCodeEntryRewardPlan(29).batchThresholds, [15])
  assert.deepEqual(referralCodeEntryRewardPlan(30).batchThresholds, [15, 30])
  assert.equal(referralCodeEntryRewardPlan(16).progressToNextBatch, 1)
  assert.equal(referralCodeEntryRewardPlan(16).entriesUntilNextBatch, 14)
})

test('negative, fractional and invalid counts are normalized safely', () => {
  assert.equal(referralCodeEntryRewardPlan(-1).entryCount, 0)
  assert.equal(referralCodeEntryRewardPlan(14.9).entryCount, 14)
  assert.equal(referralCodeEntryRewardPlan('invalid').entryCount, 0)
})


test('reciprocal referral code entry is rejected in either stored attribution path', () => {
  assert.equal(isReciprocalReferral({ codeOwnerPrimaryReferrerId: 'client-b', entrantClientId: 'client-b' }), true)
  assert.equal(isReciprocalReferral({ codeOwnerPrimaryReferrerId: null, codeOwnerHasEnteredEntrantCode: true, entrantClientId: 'client-b' }), true)
  assert.equal(isReciprocalReferral({ codeOwnerPrimaryReferrerId: 'client-c', codeOwnerHasEnteredEntrantCode: false, entrantClientId: 'client-b' }), false)
  assert.equal(isReciprocalReferral({ codeOwnerPrimaryReferrerId: null, codeOwnerHasEnteredEntrantCode: false, entrantClientId: 'client-b' }), false)
})
