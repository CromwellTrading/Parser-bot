'use strict'

const ALLOWED_STATUSES = new Set(['PENDING', 'DELIVERING', 'DELIVERED', 'FAILED'])

const STATUS_LABELS = {
  PENDING: 'Pendiente de envío',
  DELIVERING: 'Enviando',
  DELIVERED: 'Entregado',
  FAILED: 'No entregado',
}

const EVENT_LABELS = {
  TRANSFER_DETECTED: 'Aviso de transferencia',
  SMS_RECEIVED: 'Aviso recibido',
}

function safeDeliveryMessage(row) {
  const error = String(row?.last_error || '').trim()
  const statusCode = Number(row?.response_status || 0)
  const httpMatch = error.match(/\bHTTP\s+(\d{3})\b/i)
  const code = statusCode >= 400 && statusCode <= 599 ? statusCode : (httpMatch ? Number(httpMatch[1]) : 0)

  if (error === 'FREE_STORE_SESSION' || error === 'LICENSE_INACTIVE_OR_EXPIRED') {
    return 'El envío se detuvo porque la licencia no estaba activa cuando se procesó el aviso.'
  }
  if (/destino.*no permitido|direcci[oó]n.*seguridad|privad[ao]|resuelve a una direcci[oó]n no permitida/i.test(error)) {
    return 'La dirección receptora no cumple las reglas de seguridad. Revisa que use HTTPS y una dirección pública.'
  }
  if (/timeout|timed out/i.test(error)) return 'El servidor receptor tardó demasiado en responder.'
  if (/ENOTFOUND|EAI_AGAIN|dns|resolver|resolve/i.test(error)) return 'No se pudo localizar el servidor receptor.'
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|socket hang up|no se pudo conectar/i.test(error)) {
    return 'No se pudo establecer conexión con el servidor receptor.'
  }
  if (code >= 400 && code <= 499) return `El servidor receptor respondió con HTTP ${code}. Revisa la ruta y los requisitos de recepción.`
  if (code >= 500 && code <= 599) return `El servidor receptor respondió con HTTP ${code}. Puedes revisar su disponibilidad; SynthesisOne reintentará cuando corresponda.`
  if (error && /secreto configurado/i.test(error)) return 'No se pudo realizar el envío porque falta la configuración de seguridad del webhook.'
  if (String(row?.status || '').toUpperCase() === 'FAILED') return 'El aviso no pudo entregarse. Revisa la configuración de tu servidor receptor.'
  return null
}

function publicWebhookDeliverySummary(row = {}) {
  const rawStatus = String(row.status || '').toUpperCase()
  const status = ALLOWED_STATUSES.has(rawStatus) ? rawStatus : 'FAILED'
  const rawEvent = String(row.payload?.event || '').toUpperCase()
  const attempts = Number(row.attempts)
  const responseStatus = Number(row.response_status)

  return {
    id: String(row.id ?? ''),
    event_id: String(row.event_id || ''),
    event_label: EVENT_LABELS[rawEvent] || 'Aviso de automatización',
    status,
    status_label: STATUS_LABELS[status],
    attempts: Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : 0,
    response_status: Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599 ? responseStatus : null,
    issue_message: safeDeliveryMessage({ ...row, status }),
    created_at: row.created_at || null,
    delivered_at: status === 'DELIVERED' ? (row.delivered_at || null) : null,
    next_attempt_at: status === 'PENDING' ? (row.next_attempt_at || null) : null,
  }
}

module.exports = { publicWebhookDeliverySummary, safeDeliveryMessage }
