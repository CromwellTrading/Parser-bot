'use strict'

const { normalizeRate } = require('./etecsaPricing')
const ALLOWED_TYPES = new Set(['recharge', 'nauta'])
const VERIFIED_TERMS = /\b(etecsa|cubacel|nauta)\b/i
// Soky's /recharges/offers catalog is specifically for Cuban recharge offers.
// Some current ETECSA top-up promotions are categorized simply as "Promociones"
// and their offer name/description does not contain the operator name. We only
// use that generic category as identity evidence for type=recharge, never for
// other offer types.
const PROMOTION_CATEGORY_TERMS = /\b(promocion(?:es)?|promotion(?:s)?)\b/i
const USD_CODES = new Set(['USD', 'USDT'])

const FOREIGN_CURRENCY_CODES = /\b(?:USD|USDT|USDC|EUR|GBP|CAD|AUD|NZD|MXN|MLC|BTC|ETH|DOP|BRL|COP|CLP|ARS|CNY|JPY|CHF|RUB|TRY|PEN)\b/i
const FOREIGN_AMOUNT = /(?:[$€£¥]\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:USD|USDT|USDC|EUR|GBP|CAD|AUD|NZD|MXN|MLC|BTC|ETH|DOP|BRL|COP|CLP|ARS|CNY|JPY|CHF|RUB|TRY|PEN)\b|\b(?:USD|USDT|USDC|EUR|GBP|CAD|AUD|NZD|MXN|MLC|BTC|ETH|DOP|BRL|COP|CLP|ARS|CNY|JPY|CHF|RUB|TRY|PEN)\s*\d[\d,.]*)/gi

function normalizeText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

function sanitizeCustomerText(value, max = 600) {
  return String(value || '')
    .replace(FOREIGN_AMOUNT, ' ')
    .replace(FOREIGN_CURRENCY_CODES, ' ')
    .replace(/[$€£¥]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function verifiedOperatorIds(operators) {
  const ids = new Set()
  for (const operator of operators) {
    if (!operator || operator.id === undefined || operator.id === null) continue
    const text = `${operator.name || ''} ${operator.code || ''} ${operator.slug || ''}`
    if (VERIFIED_TERMS.test(text)) ids.add(String(operator.id))
  }
  return ids
}

function verifiedCategoryIds(categories) {
  const ids = new Set()
  for (const category of categories) {
    if (!category || category.id === undefined || category.id === null) continue
    if (VERIFIED_TERMS.test(`${category.name || ''} ${category.slug || ''}`)) ids.add(String(category.id))
  }
  return ids
}

function verifiedPromotionCategoryIds(categories) {
  const ids = new Set()
  for (const category of categories) {
    if (!category || category.id === undefined || category.id === null) continue
    const text = normalizeText(`${category.name || ''} ${category.slug || ''}`)
    if (PROMOTION_CATEGORY_TERMS.test(text)) ids.add(String(category.id))
  }
  return ids
}

function offerMatchesEtecsa(
  offer,
  validOperatorIds = new Set(),
  validCategoryIds = new Set(),
  promotionCategoryIds = new Set(),
) {
  const type = normalizeText(offer?.type)
  if (!ALLOWED_TYPES.has(type)) return false
  const explicitText = [
    offer?.name,
    offer?.description,
    offer?.operator?.name,
    offer?.operator?.code,
    offer?.operator_name,
    offer?.operator_code,
    offer?.operator?.slug,
    offer?.slug,
    offer?.category?.name,
    offer?.category_name,
  ].map(normalizeText).join(' ')
  if (VERIFIED_TERMS.test(explicitText)) return true

  const operatorIds = [offer?.operator_id, offer?.operator?.id, offer?.operator?.operator_id]
    .filter(value => value !== undefined && value !== null)
    .map(String)
  if (operatorIds.some(id => validOperatorIds.has(id))) return true
  const categoryIds = [offer?.category_id, offer?.category?.id]
    .filter(value => value !== undefined && value !== null)
    .map(String)
  if (categoryIds.some(id => validCategoryIds.has(id))) return true

  // Current ETECSA promo rows may only identify the generic "Promociones"
  // category. The source endpoint is Soky's Cuban recharge catalog, so accept
  // those rows as ETECSA recharge promotions while keeping other types out.
  if (type === 'recharge') {
    const categoryText = normalizeText([
      offer?.category?.name,
      offer?.category?.slug,
      offer?.category_name,
    ].filter(Boolean).join(' '))
    if (PROMOTION_CATEGORY_TERMS.test(categoryText)) return true
    if (categoryIds.some(id => promotionCategoryIds.has(id))) return true
  }
  return false
}

function readProviderValue(price) {
  const value = price?.value !== undefined && price?.value !== null
    ? String(price.value)
    : (price?.price_display !== undefined && price?.price_display !== null ? String(price.price_display) : '')
  return normalizeRate(value)
}

function normalizeCatalogOffers(rawOffers) {
  const rows = Array.isArray(rawOffers) ? rawOffers : []
  const availableOffers = rows.filter(offer => offer?.available !== false)
  const allowedTypeOffers = availableOffers.filter(offer => ALLOWED_TYPES.has(normalizeText(offer?.type)))

  // Soky's /recharges/offers endpoint already supplies the integration's
  // recharge catalog. Do not require names/operator/category fields to mention
  // ETECSA: promotion rows may omit those identity labels. Include every
  // available recharge/Nauta offer that has a usable provider price.
  const offers = allowedTypeOffers
    .map(normalizeOffer)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return {
    offers,
    diagnostics: {
      unavailable_count: rows.length - availableOffers.length,
      unsupported_type_count: availableOffers.length - allowedTypeOffers.length,
      invalid_currency_or_price_count: allowedTypeOffers.length - offers.length,
    },
  }
}

function normalizeOffer(offer) {
  const currencyCode = String(offer?.currency?.code || offer?.currency_code || '').trim().toUpperCase()
  if (!USD_CODES.has(currencyCode)) return null
  const sourcePrices = Array.isArray(offer?.prices) ? offer.prices : []
  const prices = sourcePrices.map(price => {
    const cost = readProviderValue(price)
    const label = cleanString(price?.label || price?.name, 120)
    if (!cost || !label) return null
    return {
      price_id: cleanString(price?.id, 100),
      label,
      cost_usd: cost,
    }
  }).filter(Boolean)
  if (!prices.length) return null

  const id = offer?.id
  if (id === undefined || id === null || String(id).trim() === '') return null
  const image = cleanString(offer?.image || offer?.image_url, 1000)
  return {
    id: String(id).slice(0, 100),
    name: cleanString(offer?.name, 180) || 'Oferta ETECSA',
    description: cleanString(offer?.description, 600),
    type: normalizeText(offer?.type),
    category_name: cleanString(offer?.category?.name || offer?.category_name, 120),
    image_url: /^https:\/\//i.test(image) ? image : null,
    available: offer?.available !== false,
    currency_code: currencyCode,
    prices,
  }
}

module.exports = {
  normalizeText,
  sanitizeCustomerText,
  verifiedOperatorIds,
  verifiedCategoryIds,
  verifiedPromotionCategoryIds,
  offerMatchesEtecsa,
  normalizeOffer,
  normalizeCatalogOffers,
}
