const test = require('node:test')
const assert = require('node:assert/strict')
const { getConfiguredAdminSecret, secretsMatch } = require('../src/utils/adminAuth')

test('PANEL_ADMIN_PASSWORD is preferred over legacy ADMIN_SECRET', () => {
  const oldPanel = process.env.PANEL_ADMIN_PASSWORD
  const oldLegacy = process.env.ADMIN_SECRET
  try {
    process.env.ADMIN_SECRET = 'legacy-secret'
    delete process.env.PANEL_ADMIN_PASSWORD
    assert.equal(getConfiguredAdminSecret(), 'legacy-secret')
    assert.equal(secretsMatch('legacy-secret'), true)

    process.env.PANEL_ADMIN_PASSWORD = 'new-panel-secret'
    assert.equal(getConfiguredAdminSecret(), 'new-panel-secret')
    assert.equal(secretsMatch('legacy-secret'), false)
    assert.equal(secretsMatch('new-panel-secret'), true)
    assert.equal(secretsMatch('new-panel-secret '), true)
    assert.equal(secretsMatch('wrong-secret'), false)
  } finally {
    if (oldPanel === undefined) delete process.env.PANEL_ADMIN_PASSWORD
    else process.env.PANEL_ADMIN_PASSWORD = oldPanel
    if (oldLegacy === undefined) delete process.env.ADMIN_SECRET
    else process.env.ADMIN_SECRET = oldLegacy
  }
})

test('empty admin credentials are rejected', () => {
  const oldPanel = process.env.PANEL_ADMIN_PASSWORD
  const oldLegacy = process.env.ADMIN_SECRET
  try {
    delete process.env.PANEL_ADMIN_PASSWORD
    delete process.env.ADMIN_SECRET
    assert.equal(getConfiguredAdminSecret(), '')
    assert.equal(secretsMatch('anything'), false)
  } finally {
    if (oldPanel === undefined) delete process.env.PANEL_ADMIN_PASSWORD
    else process.env.PANEL_ADMIN_PASSWORD = oldPanel
    if (oldLegacy === undefined) delete process.env.ADMIN_SECRET
    else process.env.ADMIN_SECRET = oldLegacy
  }
})
