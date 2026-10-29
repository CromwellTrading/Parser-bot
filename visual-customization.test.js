'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const route = fs.readFileSync(path.join(__dirname, 'src/routes/gameMarket.js'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, 'supabase/migrations/032_multi_referral_codes_and_revamp_styles.sql'), 'utf8')

function stringSetFrom(source, pattern) {
  const match = source.match(pattern)
  assert.ok(match, `Missing allow-list matching ${pattern}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort()
}

test('all eight color palettes are allowed by the backend and additive migration', () => {
  const expected = ['violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean', 'amoled'].sort()
  const backend = stringSetFrom(route, /const THEMES = new Set\(\[([^\]]+)\]\)/)
  assert.deepEqual(backend, expected)
  assert.ok(migration.includes("CHECK (theme IN ('violet','light','red','green','cyan','gold','ocean','amoled')) NOT VALID"))
})

test('all twelve design styles are allowed by the backend and additive migration', () => {
  const expected = ['hybrid', 'glass', 'minimal', 'professional', 'aurora', 'arena', 'soft', 'imperial', 'fuego', 'voltaje', 'nebulosa', 'porcelana'].sort()
  const backend = stringSetFrom(route, /const LAYOUT_STYLES = new Set\(\[([^\]]+)\]\)/)
  assert.deepEqual(backend, expected)
  assert.ok(migration.includes("CHECK (layout_style IN ('hybrid', 'professional', 'glass', 'minimal', 'aurora', 'arena', 'soft', 'imperial', 'fuego', 'voltaje', 'nebulosa', 'porcelana')) NOT VALID"))
})
