'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const route = fs.readFileSync(path.join(__dirname, 'src/routes/gameMarket.js'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, 'supabase/migrations/030_visual_customization_expansion.sql'), 'utf8')

function stringSetFrom(source, pattern) {
  const match = source.match(pattern)
  assert.ok(match, `Missing allow-list matching ${pattern}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort()
}

test('backend color allow-list matches the additive Supabase migration', () => {
  const expected = ['violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean'].sort()
  const backend = stringSetFrom(route, /const THEMES = new Set\(\[([^\]]+)\]\)/)
  assert.deepEqual(backend, expected)
  assert.ok(migration.includes("CHECK (theme IN ('violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean')) NOT VALID"))
})

test('backend interface design allow-list matches the additive Supabase migration', () => {
  const expected = ['hybrid', 'glass', 'minimal', 'professional', 'aurora', 'arena', 'soft'].sort()
  const backend = stringSetFrom(route, /const LAYOUT_STYLES = new Set\(\[([^\]]+)\]\)/)
  assert.deepEqual(backend, expected)
  assert.ok(migration.includes("CHECK (layout_style IN ('hybrid', 'glass', 'minimal', 'professional', 'aurora', 'arena', 'soft')) NOT VALID"))
})
