'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('zlib')
const { createCatalogResponder } = require('../src/utils/catalogResponseCache')

function fakeRes() {
  return { headers: {}, body: null, code: 0,
    set(k, v) { this.headers[k.toLowerCase()] = v; return this },
    status(c) { this.code = c; return this },
    send(b) { this.body = b; return this } }
}
const big = () => ({ games: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Juego ${i}`, offers: [] })) })

test('gzip is used when accepted and decompresses to the original payload', async () => {
  const r = createCatalogResponder()
  const res = fakeRes()
  await r.send({ headers: { 'accept-encoding': 'gzip, deflate' } }, res, 'k', async () => big())
  assert.equal(res.headers['content-encoding'], 'gzip')
  assert.ok(res.body.length < JSON.stringify(big()).length / 3)
  assert.equal(JSON.parse(zlib.gunzipSync(res.body).toString()).games.length, 400)
})

test('plain JSON is sent when the client does not accept gzip', async () => {
  const r = createCatalogResponder()
  const res = fakeRes()
  await r.send({ headers: {} }, res, 'k', async () => big())
  assert.equal(res.headers['content-encoding'], undefined)
  assert.equal(JSON.parse(res.body.toString()).games.length, 400)
})

test('result is cached for the ttl, builds are coalesced, and invalidate forces a rebuild', async () => {
  let t = 0; let builds = 0
  const r = createCatalogResponder({ ttlMs: 1000, now: () => t })
  const build = async () => { builds++; await new Promise(x => setTimeout(x, 5)); return big() }
  await Promise.all([r.load('a', build), r.load('a', build), r.load('a', build)])
  assert.equal(builds, 1)
  t = 900; await r.load('a', build); assert.equal(builds, 1)
  t = 1100; await r.load('a', build); assert.equal(builds, 2)
  r.invalidate(); await r.load('a', build); assert.equal(builds, 3)
})

test('a failed build is not cached', async () => {
  const r = createCatalogResponder()
  await assert.rejects(r.load('a', async () => { throw new Error('boom') }))
  const entry = await r.load('a', async () => ({ ok: true }))
  assert.ok(entry.json.length > 0)
})
