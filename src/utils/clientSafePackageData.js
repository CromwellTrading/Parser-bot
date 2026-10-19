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
      game_slug: String(provider.game_slug || provider.source_game_slug || '').trim().slice(0, 160) || null,
      region_name: String(provider.region_name || '').slice(0, 100) || null,
      region_slug: String(provider.region_slug || '').slice(0, 100) || null,
      provider_kind: ['topup', 'giftcard'].includes(String(provider.provider_kind || '')) ? String(provider.provider_kind) : null,
      out_of_stock: provider.out_of_stock === true,
    }
  }
  return result
}

module.exports = { clientSafePackageData }
