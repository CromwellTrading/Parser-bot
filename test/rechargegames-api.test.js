'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { rechargeGamesRequest, API_BASE } = require('../src/utils/rechargeGamesApi')

const originalKey = process.env.RECHARGEGAMES_API_KEY
const originalFetch = global.fetch

test('RechargeGames requests stay server-side and use X-API-Key and the exact product query', async () => {
  process.env.RECHARGEGAMES_API_KEY = 'test-api-key-never-log'
  let seenUrl = null
  let seenOptions = null
  global.fetch = async (url, options) => {
    seenUrl = String(url)
    seenOptions = options
    return new Response(JSON.stringify({ currency: 'USDT', categories: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const result = await rechargeGamesRequest('/v1/products', { query: { all: 'true' } })
    assert.equal(seenUrl, `${API_BASE}/v1/products?all=true`)
    assert.equal(seenOptions.headers['X-API-Key'], 'test-api-key-never-log')
    assert.equal(seenOptions.redirect, 'error')
    assert.equal(result.data.currency, 'USDT')
  } finally {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.RECHARGEGAMES_API_KEY
    else process.env.RECHARGEGAMES_API_KEY = originalKey
  }
})

test('RechargeGames API error codes are normalized without including the API key', async () => {
  process.env.RECHARGEGAMES_API_KEY = 'test-api-key-never-log'
  global.fetch = async () => new Response(JSON.stringify({ error: { code: 'resellers_only', message: 'Resellers only' } }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
  try {
    await assert.rejects(
      () => rechargeGamesRequest('/v1/ping'),
      error => error.status === 403 && error.code === 'resellers_only' && !error.message.includes('test-api-key-never-log')
    )
  } finally {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.RECHARGEGAMES_API_KEY
    else process.env.RECHARGEGAMES_API_KEY = originalKey
  }
})
