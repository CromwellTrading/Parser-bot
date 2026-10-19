'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readAllRows } = require('./src/utils/supabasePagination')

function fakeQuery(rows, pageErrors = new Map()) {
  return () => ({
    range: async (from, to) => {
      if (pageErrors.has(from)) return { data: null, error: pageErrors.get(from) }
      return { data: rows.slice(from, to + 1), error: null }
    },
  })
}

test('reads more than the common 1,000-row PostgREST cap in multiple pages', async () => {
  const rows = Array.from({ length: 2401 }, (_, index) => ({ id: index + 1 }))
  const result = await readAllRows(fakeQuery(rows), { pageSize: 500, maxRows: 3000 })
  assert.equal(result.length, 2401)
  assert.equal(result[0].id, 1)
  assert.equal(result.at(-1).id, 2401)
})

test('propagates page errors and stops at the configured row safety limit', async () => {
  await assert.rejects(() => readAllRows(fakeQuery([], new Map([[0, new Error('db failed')]]))), /db failed/)
  const endless = () => ({ range: async (from, to) => ({ data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null }) })
  await assert.rejects(() => readAllRows(endless, { pageSize: 10, maxRows: 20 }), /límite de seguridad/)
})
