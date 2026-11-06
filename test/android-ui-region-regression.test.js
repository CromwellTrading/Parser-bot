'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const androidPath = path.resolve(__dirname, '../../SMS-relay-main/app/src/main/java/com/synthesisone/app/MainActivity.kt')
const androidAvailable = fs.existsSync(androidPath)
const android = androidAvailable ? fs.readFileSync(androidPath, 'utf8') : ''

test('SO Assistant fixed-height quick actions keep their labels visible', { skip: !androidAvailable }, () => {
  const start = android.indexOf('assistantQuickActions.addView(btn("⌖  ENCONTRAR RESELLER")')
  const end = android.indexOf('root.addView(assistantQuickActions)', start)
  assert.ok(start >= 0 && end > start, 'quick action block must exist')
  const block = android.slice(start, end)
  assert.equal((block.match(/setPadding\(dp\(this@MainActivity, 8\), 0, dp\(this@MainActivity, 8\), 0\)/g) || []).length, 2)
  assert.equal((block.match(/minHeight = dp\(this@MainActivity, 34\)/g) || []).length, 2)
  assert.match(block, /ENCONTRAR RESELLER/)
  assert.match(block, /GUÍA RÁPIDA/)
})

test('SO Assistant admin action also avoids inherited vertical padding in a 34dp button', { skip: !androidAvailable }, () => {
  const start = android.indexOf('root.addView(btn("✦  DIAGNÓSTICO OPERATIVO · ADMIN")')
  assert.ok(start >= 0, 'admin diagnostic action must exist')
  const block = android.slice(start, android.indexOf('val actionRow', start))
  assert.match(block, /minHeight = dp\(this@MainActivity, 34\)/)
  assert.match(block, /setPadding\(dp\(this@MainActivity, 8\), 0, dp\(this@MainActivity, 8\), 0\)/)
})

test('Game Market region validation uses the catalog region label and requires confirmation, not silent dead-end', { skip: !androidAvailable }, () => {
  assert.match(android, /providerRegionCheckValue = providerProduct\?\.optString\("region_name"/)
  assert.match(android, /\.put\("region", providerRegionCheckValue\)/)
  assert.match(android, /regionBlockedPlayerId = if \(result == "WRONG_REGION" \|\| result == "UID_NOT_FOUND"\) uid else ""/)
  assert.match(android, /setTitle\(if \(confirmedMismatch\) "Región diferente" else "ID sin confirmar"\)/)
  assert.match(android, /Continuar igualmente/)
  assert.match(android, /No se pudo confirmar este ID.*tendrás que confirmarlo/s)
})
