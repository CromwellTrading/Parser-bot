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

module.exports = { readAllRows }
