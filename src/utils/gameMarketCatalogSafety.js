'use strict'

const { clientSafePackageData } = require('./clientSafePackageData')

function isConnectedRechargeGamesOffer(row) {
  if (String(row?.provider || '').trim().toLowerCase() !== 'rechargegames') return false
  const key = String(row?.provider_product_key || '')
  return key.length > 0 && key.length <= 300 && key === key.trim() && !/[\u0000-\u001f\u007f]/.test(key)
}

function isLegacyEtecsaGame(game) {
  const name = String(game?.name || '').trim()
  const slug = String(game?.slug || '').trim()
  return /^etecsa(?:$|[\s/_-])/i.test(name) || /^etecsa(?:$|[-_])/i.test(slug)
}

function packageDataForCatalog(row, { admin = false } = {}) {
  const original = row?.package_data && typeof row.package_data === 'object' && !Array.isArray(row.package_data)
    ? row.package_data : {}
  const safe = admin ? { ...original } : clientSafePackageData(original)
  if (!isConnectedRechargeGamesOffer(row)) return safe

  const oldMeta = safe.rechargegames && typeof safe.rechargegames === 'object' ? safe.rechargegames : {}
  const field = (rowValue, oldValue, max = 100) => String(rowValue || oldValue || '').trim().slice(0, max) || null
  safe.rechargegames = {
    ...oldMeta,
    automatic: true,
    game_slug: field(row.provider_game_slug, oldMeta.game_slug, 160),
    region_slug: field(row.provider_region_slug, oldMeta.region_slug, 160),
    region_name: field(row.provider_region_name, oldMeta.region_name, 100),
    delivery: ['player_id', 'code'].includes(String(row.provider_delivery || oldMeta.delivery || ''))
      ? String(row.provider_delivery || oldMeta.delivery) : null,
    out_of_stock: row.provider_out_of_stock === true || oldMeta.out_of_stock === true,
  }
  return safe
}

module.exports = { isConnectedRechargeGamesOffer, isLegacyEtecsaGame, packageDataForCatalog }
