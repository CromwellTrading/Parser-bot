'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/gameMarket.js'), 'utf8')
const { canAccessGameMarket } = require('../src/utils/storeSessionAccess')

test('free-store client is permitted to read the official Game Market catalog when inactive', () => {
  const client = { id: 'store-client', store_only: true, active: false, expires_at: null }
  assert.equal(canAccessGameMarket(client, 'GET', '/catalog'), true)
})

test('free-store client is not permitted to use paid-license Game Market routes', () => {
  const client = { id: 'store-client', store_only: true, active: false, expires_at: null }
  assert.equal(canAccessGameMarket(client, 'GET', '/profile'), false)
  assert.equal(canAccessGameMarket(client, 'PUT', '/profile'), false)
  assert.equal(canAccessGameMarket(client, 'GET', '/admin/catalog'), false)
})

test('Game Market auth loads store_only and checks the route-level access policy', () => {
  assert.match(routeSource, /storeSessionAccess/)
  assert.match(routeSource, /role, wallet, phone_number, store_only/)
  assert.match(routeSource, /canAccessGameMarket\(data, req\?\.method, req\?\.path\)/)
})
