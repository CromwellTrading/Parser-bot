const supabase = require('../supabase')

function safeMeta(meta = {}) {
  const out = {}
  for (const [key, value] of Object.entries(meta || {})) {
    if (/secret|token|authorization|signature/i.test(key)) continue
    if (value === undefined) continue
    if (typeof value === 'string' && value.length > 4000) out[key] = value.slice(0, 4000) + '…'
    else out[key] = value
  }
  return out
}

function logWebhook(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    service: 'synthesisone-parser',
    subsystem: 'webhook',
    level,
    event,
    ...safeMeta(meta),
  }
  const line = JSON.stringify(entry)
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)
  return entry
}

async function persistWebhookEvent(meta = {}) {
  try {
    const row = {
      client_id: meta.clientId || null,
      event_id: meta.eventId || null,
      delivery_id: meta.deliveryId || null,
      event: meta.event || 'UNKNOWN',
      level: meta.level || 'INFO',
      status: meta.status || null,
      stage: meta.stage || null,
      webhook_url: meta.webhookUrl || null,
      attempt: Number.isFinite(Number(meta.attempt)) ? Number(meta.attempt) : null,
      response_status: Number.isFinite(Number(meta.responseStatus)) ? Number(meta.responseStatus) : null,
      response_body: meta.responseBody ? String(meta.responseBody).slice(0, 16000) : null,
      error: meta.error ? String(meta.error).slice(0, 4000) : null,
      details: safeMeta(meta.details || {}),
      created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('webhook_event_logs').insert(row)
    if (error) console.error(JSON.stringify({ ts: new Date().toISOString(), service: 'synthesisone-parser', subsystem: 'webhook', level: 'ERROR', event: 'PERSIST_LOG_FAILED', error: error.message }))
  } catch (error) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), service: 'synthesisone-parser', subsystem: 'webhook', level: 'ERROR', event: 'PERSIST_LOG_EXCEPTION', error: error.message }))
  }
}

module.exports = { logWebhook, persistWebhookEvent }
