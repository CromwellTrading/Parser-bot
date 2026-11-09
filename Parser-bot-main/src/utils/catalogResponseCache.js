'use strict'

const zlib = require('zlib')
const { promisify } = require('util')

const gzip = promisify(zlib.gzip)
const activeInvalidators = new Set()

/** Invalidate every Game Market response cache after the provider catalog changes. */
function invalidateCatalogResponses() {
  for (const invalidate of activeInvalidators) invalidate()
}

/**
 * The RechargeGames catalogue is large (about 11,000 products). Serialising it from Supabase on every
 * request and sending it uncompressed made phones on mobile data hit their read timeout, so the app
 * only shows the lightweight summary first and loads one game's offers on demand.
 *
 * This keeps a short-lived, per-key server cache (concurrent builds are coalesced) and sends the
 * JSON gzip-compressed when the client accepts it. Failed builds are never cached. A generation
 * number prevents an in-flight pre-sync response from being written back after invalidation.
 */
function createCatalogResponder({ ttlMs = 60_000, now = () => Date.now(), minGzipBytes = 2048 } = {}) {
  const entries = new Map()
  const inflight = new Map()
  let generation = 0

  async function load(key, build) {
    const hit = entries.get(key)
    if (hit && now() - hit.at < ttlMs) return hit

    const buildGeneration = generation
    const inflightKey = `${buildGeneration}:${key}`
    if (inflight.has(inflightKey)) return inflight.get(inflightKey)

    const pending = (async () => {
      const payload = await build()
      const entry = { at: now(), json: Buffer.from(JSON.stringify(payload), 'utf8'), gzip: null }
      // A catalog refresh may have completed while build() was reading Supabase.
      // Never repopulate the cache with that older snapshot.
      if (generation === buildGeneration) entries.set(key, entry)
      return entry
    })().finally(() => inflight.delete(inflightKey))

    inflight.set(inflightKey, pending)
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

  function invalidate() {
    generation += 1
    entries.clear()
    // Old work may finish for the request that started it, but a new request must
    // be able to start a fresh build immediately using the new generation.
    inflight.clear()
  }

  activeInvalidators.add(invalidate)
  return { send, load, invalidate }
}

module.exports = { createCatalogResponder, invalidateCatalogResponses }
