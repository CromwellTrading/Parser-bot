'use strict'

const supabase = require('../supabase')

let started = false
let running = false
let databaseWasDown = false
const intervalMs = (() => {
  const n = Number(process.env.OPS_HEALTH_INTERVAL_MS || 300000)
  return Number.isFinite(n) ? Math.min(15 * 60 * 1000, Math.max(5 * 60 * 1000, Math.floor(n))) : 300000
})()

async function notifyAdmins(text) {
  try {
    const { bot, ADMINS } = require('../telegram')
    await Promise.all((ADMINS || []).map(id => bot.sendMessage(id, text).catch(() => {})))
  } catch (_) {
    // Alerts must never break the payment or health workers.
  }
}

async function recordIncident({ fingerprint, component, severity = 'WARN', title, message, metadata = {} }) {
  const { data, error } = await supabase.rpc('record_service_incident', {
    p_fingerprint: fingerprint,
    p_component: component,
    p_severity: severity,
    p_title: title,
    p_message: message,
    p_metadata: metadata,
  })
  if (error) throw error
  const incident = data?.incident || data
  console.warn(JSON.stringify({ ts: new Date().toISOString(), event: 'OPS_INCIDENT_OPEN', fingerprint, component, severity, title, incident_id: incident?.id || null }))
  if (data?.notify_admins) {
    await notifyAdmins(`🚨 SynthesisOne · ${severity}\n${title}\n${message}\nComponente: ${component}\nEl panel privado contiene el detalle.`)
  }
  return incident
}

async function resolveFingerprint(fingerprint, note = 'La condición dejó de detectarse en la comprobación automática.') {
  const { data: incident, error: findError } = await supabase.from('service_incidents')
    .select('id,status').eq('fingerprint', fingerprint).maybeSingle()
  if (findError) throw findError
  if (!incident || incident.status === 'RESOLVED') return false
  const { error } = await supabase.rpc('resolve_service_incident', {
    p_id: incident.id, p_resolved_by: 'health-monitor', p_note: note,
  })
  if (error) throw error
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'OPS_INCIDENT_AUTO_RESOLVED', fingerprint }))
  return true
}

async function monitoredCount(table, configure) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  if (configure) query = configure(query) || query
  const { count, error } = await query
  if (error) throw error
  return Number(count || 0)
}

async function checkCondition({ fingerprint, component, severity, title, message, count, metadata = {} }) {
  if (count > 0) {
    // Do not call record_service_incident on every polling pass for the same open
    // incident. The RPC increments occurrence_count and forces status back to OPEN,
    // which created noisy logs and could undo an administrator's acknowledgement.
    const { data: existing, error } = await supabase.from('service_incidents')
      .select('id,status,last_seen_at').eq('fingerprint', fingerprint).maybeSingle()
    if (error) throw error
    if (existing && existing.status !== 'RESOLVED') {
      // Keep last_seen_at reasonably fresh without rewriting the row every 2 minutes.
      const lastSeen = Date.parse(existing.last_seen_at || '')
      if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= 15 * 60 * 1000) {
        const now = new Date().toISOString()
        const { error: touchError } = await supabase.from('service_incidents')
          .update({ last_seen_at: now, updated_at: now })
          .eq('id', existing.id).neq('status', 'RESOLVED')
        if (touchError) throw touchError
      }
      return
    }
    await recordIncident({ fingerprint, component, severity, title, message: `${message} Registros afectados: ${count}.`, metadata: { ...metadata, count } })
  } else {
    await resolveFingerprint(fingerprint)
  }
}

async function runHealthCheck() {
  if (running) return { skipped: true }
  running = true
  const began = Date.now()
  try {
    const { error: dbError } = await supabase.from('clients').select('id').limit(1)
    if (dbError) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'OPS_DATABASE_HEALTH_FAILED', code: dbError.code || null, message: String(dbError.message || 'unknown').slice(0, 200) }))
      if (!databaseWasDown) await notifyAdmins('🚨 SynthesisOne · ERROR\nSupabase no responde\nEl monitor no puede guardar una incidencia mientras la base de datos esté caída. Revisa Supabase y el endpoint /readyz.')
      databaseWasDown = true
      return { ok: false, database: 'DOWN' }
    }
    if (databaseWasDown) {
      databaseWasDown = false
      await notifyAdmins('✅ SynthesisOne · RECUPERADO\nLa conexión con Supabase volvió a responder. Comprueba las incidencias y las recargas pendientes en el panel.')
    }

    const reviewCount = await monitoredCount('store_wallet_topups', q => q.not('payment_review_at', 'is', null))
    await checkCondition({
      fingerprint: 'wallet:payment-review', component: 'wallet', severity: 'ERROR',
      title: 'Hay recargas de Wallet en revisión',
      message: 'Una o más recargas requieren conciliación. No pidas al cliente que pague otra vez; comprueba el ticket, el SMS y el libro de movimientos.',
      count: reviewCount,
    })

    const overdueCount = await monitoredCount('store_wallet_topups', q => q.eq('status', 'WAITING_PAYMENT').lt('payment_deadline_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()))
    await checkCondition({
      fingerprint: 'wallet:overdue-waiting', component: 'wallet', severity: 'WARN',
      title: 'Tickets Wallet vencidos siguen esperando pago',
      message: 'El monitor detectó tickets cuyo plazo terminó y que aún no han cambiado de estado. El conciliador puede confirmar pagos con hora bancaria dentro de la ventana válida.',
      count: overdueCount,
    })

    const walletRefundsPending = await monitoredCount('game_recharge_orders', q => q.eq('payment_source', 'WALLET').eq('status', 'REFUND_REQUIRED').is('wallet_refunded_at', null))
    await checkCondition({
      fingerprint: 'wallet:refunds-pending', component: 'wallet', severity: 'CRITICAL',
      title: 'Hay devoluciones de Wallet pendientes',
      message: 'Una compra fallida ya descontó saldo y todavía no tiene una devolución confirmada en el libro de movimientos. El sistema reintenta automáticamente; comprueba el ticket y no pidas al cliente que pague otra vez.',
      count: walletRefundsPending,
    })

    const transferRefundsPending = await monitoredCount('game_recharge_orders', q => q.eq('payment_source', 'TRANSFERMOVIL').eq('status', 'REFUND_REQUIRED'))
    await checkCondition({
      fingerprint: 'orders:transfer-refunds-pending', component: 'game-market', severity: 'ERROR',
      title: 'Hay pedidos pagados por Transfermóvil que requieren resolución',
      message: 'El proveedor marcó una entrega fallida de un pedido pagado por transferencia. Esto no se puede devolver automáticamente a Wallet: revisa la operación y contacta al cliente para resolver el pago.',
      count: transferRefundsPending,
    })

    const staleCutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const [etecsaStuck, gameStuck] = await Promise.all([
      monitoredCount('etecsa_orders', q => q.in('status', ['PROCESSING', 'SUBMITTING_TO_SOKY', 'SUBMITTING_TO_PROVIDER']).lt('updated_at', staleCutoff)),
      monitoredCount('game_recharge_orders', q => q.in('status', ['PROCESSING', 'SUBMITTING_TO_PROVIDER', 'SUBMITTING_TO_SOKY']).lt('updated_at', staleCutoff)),
    ])
    await checkCondition({ fingerprint: 'orders:etecsa-stuck', component: 'etecsa', severity: 'WARN', title: 'Pedidos ETECSA llevan demasiado tiempo en proceso', message: 'Revisa la respuesta del proveedor y el estado del pedido antes de solicitar otro pago.', count: etecsaStuck })
    await checkCondition({ fingerprint: 'orders:game-stuck', component: 'game-market', severity: 'WARN', title: 'Pedidos Game Market llevan demasiado tiempo en proceso', message: 'Revisa el proveedor y no vuelvas a cobrar al cliente. El pedido y sus movimientos están en el panel.', count: gameStuck })

    const webhookFailures = await monitoredCount('webhook_event_logs', q => q.in('status', ['FAILED', 'EXCEPTION', 'BLOCKED']).gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()))
    await checkCondition({ fingerprint: 'webhooks:recent-failures', component: 'webhooks', severity: 'WARN', title: 'Fallos recientes de entrega de webhooks', message: 'Hay entregas personales que fallaron; no deben bloquear ni alterar acreditaciones de la tienda oficial.', count: webhookFailures })

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'OPS_HEALTH_CHECK_COMPLETED', duration_ms: Date.now() - began, wallet_review: reviewCount, overdue_wallet: overdueCount, wallet_refunds_pending: walletRefundsPending, transfer_refunds_pending: transferRefundsPending, etecsa_stuck: etecsaStuck, game_stuck: gameStuck, webhook_failures: webhookFailures }))
    return { ok: true, wallet_review: reviewCount, overdue_wallet: overdueCount, wallet_refunds_pending: walletRefundsPending, transfer_refunds_pending: transferRefundsPending, etecsa_stuck: etecsaStuck, game_stuck: gameStuck, webhook_failures: webhookFailures }
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'OPS_HEALTH_CHECK_ERROR', code: error?.code || null, message: String(error?.message || 'unknown').slice(0, 200) }))
    return { ok: false, error: error?.code || 'health_check_error' }
  } finally {
    running = false
  }
}

function startHealthMonitor() {
  if (started) return
  started = true
  setTimeout(() => runHealthCheck().catch(() => {}), 15000)
  setInterval(() => runHealthCheck().catch(() => {}), intervalMs)
}

module.exports = { runHealthCheck, startHealthMonitor, recordIncident, resolveFingerprint }
