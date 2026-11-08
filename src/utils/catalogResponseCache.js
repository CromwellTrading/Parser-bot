'use strict'

const zlib = require('zlib')
const { promisify } = require('util')

const gzip = promisify(zlib.gzip)

/**
 * The RechargeGames catalogue is large (about 11,000 products). Serialising it from Supabase on every
 * request and sending it uncompressed made phones on mobile data hit their read timeout, so the app
 * only showed the small ETECSA catalogue while the server log showed a successful response.
 *
 * This keeps a short-lived, per-key server cache (concurrent builds are coalesced) and sends the
 * JSON gzip-compressed when the client accepts it. Failed builds are never cached.
 */
function createCatalogResponder({ ttlMs = 60_000, now = () => Date.now(), minGzipBytes = 2048 } = {}) {
  const entries = new Map()
  const inflight = new Map()

  async function load(key, build) {
    const hit = entries.get(key)
    if (hit && now() - hit.at < ttlMs) return hit
    if (inflight.has(key)) return inflight.get(key)
    const pending = (async () => {
      const payload = await build()
      const entry = { at: now(), json: Buffer.from(JSON.stringify(payload), 'utf8'), gzip: null }
      entries.set(key, entry)
      return entry
    })().finally(() => inflight.delete(key))
    inflight.set(key, pending)
    return pending
  }

  async function send(req, res, key, build) {
    const entry = await load(key, build)
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('Vary', 'Accept-Encoding')
    const acceptsGzip = /\bgzip\b/i.test(String(req.headers?.['accept-encoding'] || ''))
    if (acceptsGzip && entry.json.length >= minGzipBytes) {
      if (!entry.gzip) entry.gzip = await gzip(entry.json, { level: 6 })
      res.set('Content-Encoding', 'gzip')
      res.set('Content-Length', String(entry.gzip.length))
      return res.status(200).send(entry.gzip)
    }
    res.set('Content-Length', String(entry.json.length))
    return res.status(200).send(entry.json)
  }

  function invalidate() { entries.clear() }

  return { send, load, invalidate }
}

module.exports = { createCatalogResponder }
