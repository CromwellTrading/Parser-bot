'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readAllRows, readRowsInBatches } = require('../src/utils/supabasePagination')

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

test('accepts exactly maxRows even when the last page is partial', async () => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ id: index + 1 }))
  const result = await readAllRows(fakeQuery(rows), { pageSize: 10, maxRows: 22 })
  assert.equal(result.length, 22)
  assert.equal(result.at(-1).id, 22)
})

test('does not silently return a partial dataset when maxRows is not a page multiple', async () => {
  const rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }))
  await assert.rejects(() => readAllRows(fakeQuery(rows), { pageSize: 10, maxRows: 22 }), /límite de seguridad de 22 filas/)
})


test('splits large IN filters into bounded batches and reads every matching row', async () => {
  const gameIds = Array.from({ length: 399 }, (_, index) => `game-${String(index).padStart(3, '0')}`)
  const rows = gameIds.flatMap((game_id, index) => Array.from({ length: (index % 7) + 3 }, (_, offer) => ({
    id: `${game_id}-offer-${offer}`,
    game_id,
  })))
  const observedBatchSizes = []

  const result = await readRowsInBatches(batch => {
    observedBatchSizes.push(batch.length)
    const selected = rows.filter(row => batch.includes(row.game_id))
    return {
      range: async (from, to) => ({ data: selected.slice(from, to + 1), error: null }),
    }
  }, gameIds, { batchSize: 50, pageSize: 500, maxRows: 10_000 })

  assert.equal(result.length, rows.length)
  assert.deepEqual(result.map(row => row.id).sort(), rows.map(row => row.id).sort())
  assert.equal(observedBatchSizes.length, Math.ceil(gameIds.length / 50))
  assert.ok(observedBatchSizes.every(size => size > 0 && size <= 50))
})

test('enforces the row safety limit across all IN-filter batches', async () => {
  const ids = ['game-a', 'game-b', 'game-c']
  const rows = ids.flatMap(game_id => [{ id: `${game_id}-1`, game_id }, { id: `${game_id}-2`, game_id }])
  await assert.rejects(() => readRowsInBatches(batch => {
    const selected = rows.filter(row => batch.includes(row.game_id))
    return { range: async (from, to) => ({ data: selected.slice(from, to + 1), error: null }) }
  }, ids, { batchSize: 1, pageSize: 2, maxRows: 5 }), /límite de seguridad/)
})
