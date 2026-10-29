'use strict'

const REFERRAL_CODE_BATCH_SIZE = 15
const REFERRAL_CODE_ENTRY_COUPON_PERCENT = 2
const REFERRAL_CODE_BATCH_COUPON_PERCENT = 3

function isReciprocalReferral({ codeOwnerPrimaryReferrerId, codeOwnerHasEnteredEntrantCode, entrantClientId }) {
  const entrant = String(entrantClientId ?? '')
  if (!entrant) return false
  const primary = String(codeOwnerPrimaryReferrerId ?? '')
  return primary === entrant || codeOwnerHasEnteredEntrantCode === true
}

function referralCodeEntryRewardPlan(entryCount) {
  const count = Math.max(0, Math.trunc(Number(entryCount) || 0))
  const completedBatches = Math.floor(count / REFERRAL_CODE_BATCH_SIZE)
  return {
    entryCount: count,
    firstCodeCouponEligible: count > 0,
    batchThresholds: Array.from({ length: completedBatches }, (_, index) => (index + 1) * REFERRAL_CODE_BATCH_SIZE),
    progressToNextBatch: count % REFERRAL_CODE_BATCH_SIZE,
    entriesUntilNextBatch: REFERRAL_CODE_BATCH_SIZE - (count % REFERRAL_CODE_BATCH_SIZE),
  }
}

module.exports = {
  REFERRAL_CODE_BATCH_SIZE,
  REFERRAL_CODE_ENTRY_COUPON_PERCENT,
  REFERRAL_CODE_BATCH_COUPON_PERCENT,
  isReciprocalReferral,
  referralCodeEntryRewardPlan,
}
