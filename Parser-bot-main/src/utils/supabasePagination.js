'use strict'

/** Read all rows from a Supabase/PostgREST query. PostgREST commonly caps each
 * response (often at 1,000 rows), so callers must not rely on one query alone.
 * At the safety limit, probe one extra row: exactly maxRows is valid; more means
 * fail loudly rather than return a partial result that could miss a payment ticket.
 */
async function readAllRows(buildQuery, { pageSize = 500, maxRows = 100_000 } = {}) {
  if (typeof buildQuery !== 'function') throw new TypeError('buildQuery debe ser una función')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('pageSize no válido')
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError('maxRows no válido')
  const rows = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1)
    const expectedCount = to - from + 1
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw error
    const page = Array.isArray(data) ? data : []
    rows.push(...page)
    if (page.length < expectedCount) return rows
  }

  const { data, error } = await buildQuery().range(maxRows, maxRows)
  if (error) throw error
  if (Array.isArray(data) && data.length > 0) {
    throw new Error(`La consulta superó el límite de seguridad de ${maxRows} filas`)
  }
  return rows
}


/**
 * Read rows whose filter is an `in (...)` list without creating oversized
 * PostgREST URLs. Large UUID lists can push Supabase/Undici beyond its ~16 KB
 * request-header limit even when the actual response is small. Split the
 * values into bounded groups and page each group's result set.
 *
 * buildQuery receives only the current value batch and must return a fresh
 * Supabase query builder. maxRows is enforced across every batch, not per batch.
 */
async function readRowsInBatches(buildQuery, values, {
  batchSize = 50,
  pageSize = 500,
  maxRows = 100_000,
} = {}) {
  if (typeof buildQuery !== 'function') throw new TypeError('buildQuery debe ser una función')
  if (!Array.isArray(values)) throw new TypeError('values debe ser un arreglo')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new RangeError('batchSize no válido')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('pageSize no válido')
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError('maxRows no válido')
  if (!values.length) return []

  const rows = []
  for (let start = 0; start < values.length; start += batchSize) {
    const batch = values.slice(start, start + batchSize)
    // Keep at least a one-row probe for subsequent batches after reaching the
    // global cap; this distinguishes exactly maxRows from an oversized result.
    const remaining = maxRows - rows.length
    const batchMaxRows = Math.max(1, remaining)
    const batchRows = await readAllRows(
      () => buildQuery(batch, start / batchSize),
      { pageSize: Math.min(pageSize, batchMaxRows), maxRows: batchMaxRows },
    )
    if (rows.length + batchRows.length > maxRows) {
      throw new Error(`La consulta superó el límite de seguridad de ${maxRows} filas`)
    }
    rows.push(...batchRows)
  }
  return rows
}

module.exports = { readAllRows, readRowsInBatches }
