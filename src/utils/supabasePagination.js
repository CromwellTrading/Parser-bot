'use strict'

/** Read all rows from a Supabase/PostgREST query. PostgREST commonly caps each
 * response (often at 1,000 rows), so catalog screens must not rely on one query. */
async function readAllRows(buildQuery, { pageSize = 500, maxRows = 100_000 } = {}) {
  if (typeof buildQuery !== 'function') throw new TypeError('buildQuery debe ser una función')
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('pageSize no válido')
  const rows = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery().range(from, Math.min(from + pageSize - 1, maxRows - 1))
    if (error) throw error
    const page = Array.isArray(data) ? data : []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
  throw new Error(`La consulta superó el límite de seguridad de ${maxRows} filas`)
}

module.exports = { readAllRows }
