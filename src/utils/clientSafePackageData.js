'use strict'

function clientSafePackageData(packageData) {
  if (!packageData || typeof packageData !== 'object' || Array.isArray(packageData)) return {}
  const result = { ...packageData }
  const provider = packageData.rechargegames
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    // Keep only customer-relevant fulfillment metadata. Do not expose provider
    // product keys, wholesale cost, provider currency, source slugs or raw payload.
    result.rechargegames = {
      automatic: true,
      delivery: ['player_id', 'code'].includes(String(provider.delivery || '')) ? provider.delivery : null,
      delivery_label: String(provider.delivery_label || '').slice(0, 80),
    }
  }
  return result
}

module.exports = { clientSafePackageData }
