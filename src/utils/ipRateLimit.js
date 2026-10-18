'use strict'

// Best-effort per-process abuse control for public entry points. This is intentionally
// dependency-free and bounded in memory. Multi-instance deployments should ALSO enforce
// a shared limiter at the gateway/CDN because per-process counters are not cluster-wide.
function createIpRateLimiter({ windowMs, max, message, now = () => Date.now(), maxKeys = 10000 }) {
  const buckets = new Map()
  return function ipRateLimit(req, res, next) {
    const timestamp = now()
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 120)
    let bucket = buckets.get(ip)
    if (!bucket || bucket.resetAt <= timestamp) bucket = { count: 0, resetAt: timestamp + windowMs }
    bucket.count += 1
    buckets.delete(ip)
    buckets.set(ip, bucket)

    if (buckets.size > maxKeys) {
      for (const [key, entry] of buckets) {
        if (entry.resetAt <= timestamp || buckets.size > maxKeys) buckets.delete(key)
        if (buckets.size <= maxKeys) break
      }
    }

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))))
      return res.status(429).json({ ok: false, error: message || 'Demasiados intentos. Espera un momento y vuelve a intentarlo.' })
    }
    return next()
  }
}

module.exports = { createIpRateLimiter }
