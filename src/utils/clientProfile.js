function cleanValue(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return String(value).trim() || null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildClientProfilePatch(body = {}) {
  const patch = {}
  const phone_number = cleanValue(body.phone_number)
  const card1 = cleanValue(body.card1)
  const card2 = cleanValue(body.card2)
  const card3 = cleanValue(body.card3)
  const wallet = cleanValue(body.wallet)

  if (phone_number !== null) patch.phone_number = phone_number
  if (card1 !== null) patch.card1 = card1
  if (card2 !== null) patch.card2 = card2
  if (card3 !== null) patch.card3 = card3
  if (wallet !== null) patch.wallet = wallet

  return patch
}

function hasAnyProfileField(body = {}) {
  return ['phone_number', 'card1', 'card2', 'card3', 'wallet']
    .some(key => cleanValue(body[key]) !== null)
}

module.exports = { buildClientProfilePatch, hasAnyProfileField, cleanValue }
