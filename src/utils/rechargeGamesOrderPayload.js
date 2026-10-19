'use strict'

function safeText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function buildRechargeGamesOrderPayload(order, { playerId = null, serverId = null, note = '' } = {}) {
  const effectivePlayerId = safeText(playerId, 200)
  const effectiveServerId = safeText(serverId, 200)
  // RechargeGames documents product_key <= 300 characters. Preserve it byte-for-byte
  // as returned by the normalized provider catalog; never truncate a paid SKU or fall
  // back to a free-text order if its exact key is invalid.
  const productKey = String(order?.provider_product_key ?? '')
  if (!productKey.trim() || productKey.length > 300 || /[\u0000-\u001f\u007f]/.test(productKey)) {
    const error = new Error('La clave exacta del paquete del proveedor no es válida; actualiza el catálogo antes de cobrar.')
    error.status = 409
    error.code = 'INVALID_PROVIDER_PRODUCT_KEY'
    throw error
  }
  // The canonical region is already the third path component in product_key.
  // Send that exact provider slug rather than a display label such as "Europe (EU)".
  const keyParts = productKey.split('/')
  const regionFromKey = keyParts.length >= 4 ? keyParts[2] : ''
  const region = safeText(regionFromKey || order?.provider_region_slug || order?.provider_region_name, 100)
  return {
    product_key: productKey,
    product: safeText(order?.provider_product_name || order?.offer_title, 500),
    buyer_ref: safeText(order?.buyer_ref, 200),
    quantity: 1,
    ...(region ? { region } : {}),
    ...(effectivePlayerId ? { player_id: effectivePlayerId } : {}),
    ...(effectiveServerId ? { server_id: effectiveServerId } : {}),
    note: safeText(note, 1000),
  }
}

module.exports = { buildRechargeGamesOrderPayload }
