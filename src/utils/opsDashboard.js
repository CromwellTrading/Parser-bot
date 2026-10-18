'use strict'

const supabase = require('../supabase')

function errorText(error) {
  return String(error?.message || error?.details || error?.code || 'unknown').slice(0, 220)
}

async function countRows(table, configure = () => {}) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  query = configure(query) || query
  const { count, error } = await query
  if (error) throw error
  return Number(count || 0)
}

async function getOpsSummary() {
  const checkedAt = new Date().toISOString()
  const out = {
    ok: true, checked_at: checkedAt, service: { status: 'UP', uptime_seconds: Math.floor(process.uptime()) },
    database: { status: 'UNKNOWN' }, incidents: { open: 0, critical: 0 },
    wallet: { payment_review: 0, overdue_waiting: 0, refunds_pending: 0 },
    orders: { etecsa_stuck: 0, game_stuck: 0, transfer_refunds_pending: 0 },
    webhook_failures: 0, warnings: [], migrations_required: false,
  }

  try {
    const { error } = await supabase.from('clients').select('id').limit(1)
    if (error) throw error
    out.database.status = 'UP'
  } catch (error) {
    out.database.status = 'DOWN'
    out.database.message = errorText(error)
    out.ok = false
    out.warnings.push('No se pudo consultar la base de datos.')
    return out
  }

  const cutoffStale = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const cutoffOverdue = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const tasks = [
    ['incidents_open', () => countRows('service_incidents', q => q.in('status', ['OPEN', 'ACKNOWLEDGED']))],
    ['incidents_critical', () => countRows('service_incidents', q => q.in('status', ['OPEN', 'ACKNOWLEDGED']).in('severity', ['CRITICAL', 'ERROR']))],
    ['wallet_review', () => countRows('store_wallet_topups', q => q.not('payment_review_at', 'is', null))],
    ['wallet_overdue', () => countRows('store_wallet_topups', q => q.eq('status', 'WAITING_PAYMENT').lt('payment_deadline_at', cutoffOverdue))],
    ['wallet_refunds_pending', () => countRows('game_recharge_orders', q => q.eq('payment_source', 'WALLET').eq('status', 'REFUND_REQUIRED').is('wallet_refunded_at', null))],
    ['transfer_refunds_pending', () => countRows('game_recharge_orders', q => q.eq('payment_source', 'TRANSFERMOVIL').eq('status', 'REFUND_REQUIRED'))],
    ['etecsa_stuck', () => countRows('etecsa_orders', q => q.in('status', ['PROCESSING', 'SUBMITTING_TO_SOKY', 'SUBMITTING_TO_PROVIDER']).lt('updated_at', cutoffStale))],
    ['game_stuck', () => countRows('game_recharge_orders', q => q.in('status', ['PROCESSING', 'SUBMITTING_TO_PROVIDER', 'SUBMITTING_TO_SOKY']).lt('updated_at', cutoffStale))],
    ['webhook_failures', () => countRows('webhook_event_logs', q => q.in('status', ['FAILED', 'EXCEPTION', 'BLOCKED']).gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()))],
  ]
  const values = await Promise.all(tasks.map(async ([key, run]) => {
    try { return [key, await run(), null] } catch (error) { return [key, null, error] }
  }))
  for (const [key, value, error] of values) {
    if (error) {
      out.ok = false
      if (/service_incidents|payment_review_at|wallet_refunded_at/.test(String(error.message || ''))) out.migrations_required = true
      out.warnings.push(`${key}: ${errorText(error)}`)
      continue
    }
    if (key === 'incidents_open') out.incidents.open = value
    else if (key === 'incidents_critical') out.incidents.critical = value
    else if (key === 'wallet_review') out.wallet.payment_review = value
    else if (key === 'wallet_overdue') out.wallet.overdue_waiting = value
    else if (key === 'wallet_refunds_pending') out.wallet.refunds_pending = value
    else if (key === 'transfer_refunds_pending') out.orders.transfer_refunds_pending = value
    else if (key === 'etecsa_stuck') out.orders.etecsa_stuck = value
    else if (key === 'game_stuck') out.orders.game_stuck = value
    else if (key === 'webhook_failures') out.webhook_failures = value
  }
  return out
}

async function listIncidents({ status = 'OPEN', limit = 100 } = {}) {
  const allowed = new Set(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL'])
  const normalized = allowed.has(String(status).toUpperCase()) ? String(status).toUpperCase() : 'OPEN'
  const cap = Math.max(1, Math.min(Number(limit) || 100, 200))
  let query = supabase.from('service_incidents').select('*').order('last_seen_at', { ascending: false }).limit(cap)
  if (normalized !== 'ALL') query = query.eq('status', normalized)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

async function resolveIncident(id, resolvedBy = 'admin', note = '') {
  const { data, error } = await supabase.rpc('resolve_service_incident', {
    p_id: id,
    p_resolved_by: String(resolvedBy || 'admin').slice(0, 120),
    p_note: String(note || '').slice(0, 1000) || null,
  })
  if (error) throw error
  return data
}

async function publishAnnouncement(input, actor = 'admin') {
  const title = String(input?.title || '').trim().slice(0, 100)
  const message = String(input?.message || '').trim().slice(0, 1500)
  const severity = ['INFO', 'PROMO', 'WARN'].includes(String(input?.severity || '').toUpperCase()) ? String(input.severity).toUpperCase() : 'INFO'
  const startsAt = input?.starts_at ? new Date(input.starts_at) : new Date()
  const endsAt = input?.ends_at ? new Date(input.ends_at) : null
  if (!title || !message) throw Object.assign(new Error('Título y mensaje son obligatorios.'), { status: 400 })
  if (!Number.isFinite(startsAt.getTime()) || (endsAt && !Number.isFinite(endsAt.getTime())) || (endsAt && endsAt <= startsAt)) {
    throw Object.assign(new Error('El intervalo de publicación no es válido.'), { status: 400 })
  }
  const { data, error } = await supabase.from('store_announcements').insert({
    title, message, severity, enabled: Boolean(input?.enabled), starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null, created_by: String(actor || 'admin').slice(0, 120),
    updated_at: new Date().toISOString(),
  }).select('*').single()
  if (error) throw error
  return data
}

async function updateAnnouncement(id, patch = {}) {
  const update = { updated_at: new Date().toISOString() }
  if (typeof patch.enabled === 'boolean') update.enabled = patch.enabled
  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim().slice(0, 100)
    if (!title) throw Object.assign(new Error('El título no puede estar vacío.'), { status: 400 })
    update.title = title
  }
  if (patch.message !== undefined) {
    const message = String(patch.message || '').trim().slice(0, 1500)
    if (!message) throw Object.assign(new Error('El mensaje no puede estar vacío.'), { status: 400 })
    update.message = message
  }
  if (patch.severity !== undefined) {
    const severity = String(patch.severity || '').toUpperCase()
    if (!['INFO', 'PROMO', 'WARN'].includes(severity)) throw Object.assign(new Error('Tipo de aviso inválido.'), { status: 400 })
    update.severity = severity
  }
  if (patch.starts_at !== undefined) {
    const date = new Date(patch.starts_at)
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('Fecha de inicio inválida.'), { status: 400 })
    update.starts_at = date.toISOString()
  }
  if (patch.ends_at !== undefined) {
    const date = patch.ends_at ? new Date(patch.ends_at) : null
    if (date && !Number.isFinite(date.getTime())) throw Object.assign(new Error('Fecha final inválida.'), { status: 400 })
    update.ends_at = date ? date.toISOString() : null
  }
  // Validate the resulting interval BEFORE writing so an invalid PATCH can never
  // leave a partially updated announcement behind.
  if (patch.starts_at !== undefined || patch.ends_at !== undefined) {
    const { data: current, error: readError } = await supabase.from('store_announcements')
      .select('starts_at,ends_at').eq('id', id).maybeSingle()
    if (readError) throw readError
    if (!current) throw Object.assign(new Error('Aviso no encontrado.'), { status: 404 })
    const nextStart = update.starts_at !== undefined ? update.starts_at : current.starts_at
    const nextEnd = update.ends_at !== undefined ? update.ends_at : current.ends_at
    if (nextEnd && new Date(nextEnd) <= new Date(nextStart)) {
      throw Object.assign(new Error('La fecha final debe ser posterior al inicio.'), { status: 400 })
    }
  }
  const { data, error } = await supabase.from('store_announcements').update(update).eq('id', id).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('Aviso no encontrado.'), { status: 404 })
  return data
}

async function listAnnouncements({ activeOnly = false, limit = 50 } = {}) {
  const cap = Math.max(1, Math.min(Number(limit) || 50, 100))
  let query = supabase.from('store_announcements').select('id,title,message,severity,enabled,starts_at,ends_at,created_by,created_at,updated_at').order('created_at', { ascending: false }).limit(cap)
  if (activeOnly) {
    const now = new Date().toISOString()
    query = query.eq('enabled', true).lte('starts_at', now).or(`ends_at.is.null,ends_at.gt.${now}`)
  }
  const { data, error } = await query
  if (error) throw error
  return data || []
}

module.exports = { getOpsSummary, listIncidents, resolveIncident, publishAnnouncement, updateAnnouncement, listAnnouncements }
