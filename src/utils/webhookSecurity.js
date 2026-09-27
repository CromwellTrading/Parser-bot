const crypto = require('crypto')
const net = require('net')

function hashEventSeed(parts) {
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex')
}

function createEventId({ clientId, sender, body, receivedAt }) {
  return hashEventSeed([clientId || '', sender || '', body || '', receivedAt || ''])
}

function hmacHex(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

function isPrivateOrReservedIp(ip) {
  const family = net.isIP(ip)
  if (family === 4) {
    const p = ip.split('.').map(Number)
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = p
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }

  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (/^fe[89ab]/.test(lower)) return true

  // IPv4-mapped IPv6 address, e.g. ::ffff:192.168.1.10
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateOrReservedIp(mapped[1])

  return false
}

function validateWebhookUrl(urlValue) {
  if (urlValue === null || urlValue === undefined || String(urlValue).trim() === '') {
    return { ok: true, url: null }
  }

  if (String(urlValue).length > 2048) {
    return { ok: false, error: 'Webhook URL demasiado larga' }
  }

  let url
  try {
    url = new URL(String(urlValue).trim())
  } catch {
    return { ok: false, error: 'Webhook URL inválida' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Los webhooks deben usar HTTPS' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'La URL del webhook no puede contener usuario o contraseña' }
  }
  if (url.hash) {
    return { ok: false, error: 'La URL del webhook no puede contener fragmento (#)' }
  }
  if (!url.hostname) {
    return { ok: false, error: 'Webhook sin hostname' }
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname === '0.0.0.0'
  ) {
    return { ok: false, error: 'Destino de webhook no permitido' }
  }

  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    return { ok: false, error: 'Destino de webhook no permitido' }
  }

  url.hostname = hostname
  return { ok: true, url: url.toString() }
}


module.exports = { createEventId, hmacHex, validateWebhookUrl, isPrivateOrReservedIp }
