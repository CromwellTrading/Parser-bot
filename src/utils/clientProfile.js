function cleanText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length ? text : null
}

function cleanBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return null
}

function pickFirst(...values) {
  for (const value of values) {
    const cleaned = cleanText(value)
    if (cleaned) return cleaned
  }
  return null
}

function normalizeClientProfile(body = {}) {
  const profile = {
    phone_number: pickFirst(body.phone_number, body.wallet, body.phoneNumber),
    card1: pickFirst(body.card1, body.card_1),
    card2: pickFirst(body.card2, body.card_2),
    card3: pickFirst(body.card3, body.card_3),
    wallet: pickFirst(body.wallet, body.wallet_number, body.walletNumber),
    device_id: pickFirst(body.deviceId, body.device_id, body.deviceID),
    device_model: pickFirst(body.deviceModel, body.device_model),
    app_version: pickFirst(body.appVersion, body.app_version),
  }

  if (body.cards && typeof body.cards === 'object') {
    const cards = Array.isArray(body.cards) ? body.cards : [body.cards.card1, body.cards.card2, body.cards.card3]
    if (cards[0]) profile.card1 = cleanText(cards[0])
    if (cards[1]) profile.card2 = cleanText(cards[1])
    if (cards[2]) profile.card3 = cleanText(cards[2])
  }

  for (const key of Object.keys(profile)) {
    if (profile[key] === null) delete profile[key]
  }

  return profile
}

function normalizeClientInsert(body = {}) {
  const payload = {
    name: cleanText(body.name),
    token: cleanText(body.token),
    active: cleanBoolean(body.active),
    token_used: cleanBoolean(body.token_used),
    webhook_url: cleanText(body.webhook_url),
    webhook_url_2: cleanText(body.webhook_url_2),
    webhook_url_3: cleanText(body.webhook_url_3),
    phone_number: cleanText(body.phone_number),
    card1: cleanText(body.card1),
    card2: cleanText(body.card2),
    card3: cleanText(body.card3),
    wallet: cleanText(body.wallet),
    device_id: cleanText(body.device_id),
    created_at: cleanText(body.created_at),
    expires_at: cleanText(body.expires_at),
  }

  Object.keys(payload).forEach(key => payload[key] === null && delete payload[key])
  return payload
}

function clientStatus(client, now = new Date()) {
  if (!client) return 'missing'
  if (client.active === false) return 'inactive'
  if (client.expires_at) {
    const exp = new Date(client.expires_at)
    if (!Number.isNaN(exp.getTime()) && exp < now) return 'expired'
  }
  return client.token_used ? 'active' : 'pending'
}

function publicClient(client) {
  if (!client) return null
  const { token, ...rest } = client
  return {
    ...rest,
    license_status: clientStatus(client),
  }
}

module.exports = {
  cleanText,
  normalizeClientProfile,
  normalizeClientInsert,
  publicClient,
  clientStatus,
}
