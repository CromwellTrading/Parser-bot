const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const route = fs.readFileSync(path.join(__dirname, '../src/routes/gameMarket.js'), 'utf8')
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/031_visual_customization_expansion.sql'), 'utf8')

test('API allowlist accepts all seven design styles', () => {
  for (const style of ['hybrid', 'professional', 'glass', 'minimal', 'aurora', 'arena', 'soft']) {
    assert.match(route, new RegExp("['\"]" + style + "['\"]"))
    assert.ok(migration.includes("'" + style + "'"))
  }
})

test('API and migration accept all seven color palettes', () => {
  for (const theme of ['violet', 'light', 'red', 'green', 'cyan', 'gold', 'ocean']) {
    assert.match(route, new RegExp("['\"]" + theme + "['\"]"))
    assert.ok(migration.includes("'" + theme + "'"))
  }
})
