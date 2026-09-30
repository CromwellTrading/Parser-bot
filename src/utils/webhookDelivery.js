const crypto = require('crypto')
const dns = require('dns').promises
const https = require('https')
const net = require('net')
const supabase = require('../supabase')
const { createEventId, hmacHex, validateWebhookUrl, isPrivateOrReservedIp } = require('./webhookSecurity')
const { logWebhook, persistWebhookEvent } = require('./observability')

const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 15_000)
const WEBHOOK_MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS || 8)
const WEBHOOK_WORKER_INTERVAL_MS = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || 10_000)
const WEBHOOK_LOCK_TIMEOUT_MS = Number(process.env.WEBHOOK_LOCK_TIMEOUT_MS || 5 * 60 * 1000)
const WEBHOOK_MAX_RESPONSE_BYTES = Number(process.env.WEBHOOK_MAX_RESPONSE_BYTES || 16 * 1024)
const WEBHOOK_USER_AGENT = 'SynthesisOne-Webhook/1.0'

let workerTimer = null
let workerBusy = false
const WORKER_ID = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`

async function resolvePublicAddresses(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error('Destino de webhook no permitido')
    return [{ address: hostname, family: net.isIP(hostname) }]
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  if (!records.length) throw new Error('No se pudo resolver el webhook')
  if (records.some(record => isPrivateOrReservedIp(record.address))) {
    throw new Error('El webhook resuelve a una dirección no permitida')
  }

  // Prefer IPv4 for compatibility while retaining public IPv6 as fallback.
  return records.sort((a, b) => Number(b.family === 4) - Number(a.family === 4))
}

function requestHttps(urlString, body, headers, addresses) {
  const url = new URL(urlString)
  const path = `${url.pathname || '/'}${url.search || ''}`
  const contentLength = Buffer.byteLength(body, 'utf8')

  return new Promise((resolve, reject) => {
    let addressIndex = 0

    const attempt = () => {
      const target = addresses[addressIndex++]
      if (!target) {
        reject(new Error('No se pudo conectar con el webhook'))
        return
      }

      let settled = false
      const req = https.request({
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        method: 'POST',
        path,
        servername: url.hostname,
        timeout: WEBHOOK_TIMEOUT_MS,
        headers: {
          ...headers,
          'Content-Length': contentLength,
          Connection: 'close',
        },
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      }, (res) => {
        let total = 0
        const chunks = []
        res.on('data', (chunk) => {
          if (total >= WEBHOOK_MAX_RESPONSE_BYTES) return
          const remaining = WEBHOOK_MAX_RESPONSE_BYTES - total
          const slice = chunk.subarray(0, remaining)
          total += slice.length
          chunks.push(slice)
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      })

      req.on('timeout', () => req.destroy(new Error('Webhook timeout')))
      req.on('error', (error) => {
        if (settled) return
        settled = true
        if (addressIndex < addresses.length) {
          attempt()
        } else {
          reject(error)
        }
      })

      req.write(body)
      req.end()
    }

    attempt()
  })
}

function calculateBackoffMs(attempt) {
  const exponent = Math.min(Math.max(attempt - 1, 0), 6)
  const base = 5_000 * (2 ** exponent)
  const jitter = Math.floor(Math.random() * 2_000)
  return Math.min(base + jitter, 60 * 60 * 1000)
}

async function deliverWebhook({ url, payload, secret, eventId }) {
  const validation = validateWebhookUrl(url)
  if (!validation.ok) {
    return { success: false, retryable: false, error: validation.error }
  }

  if (!secret) {
    return { success: false, retryable: false, error: 'Webhook sin secreto configurado' }
  }

  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = hmacHex(body, secret)
  const signatureV2 = hmacHex(`${timestamp}.${body}`, secret)

  try {
    const hostname = new URL(validation.url).hostname
    const addresses = await resolvePublicAddresses(hostname)
    logWebhook('INFO', 'HTTP_POST_START', { event_id: eventId, webhook_url: validation.url, hostname, resolved_addresses: addresses.map(x => x.address) })
    const startedAt = Date.now()
    const response = await requestHttps(validation.url, body, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': WEBHOOK_USER_AGENT,
      'X-Webhook-Event-Id': eventId,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': signature,
      'X-Webhook-Signature-V2': signatureV2,
    }, addresses)

    const durationMs = Date.now() - startedAt
    const success = response.statusCode >= 200 && response.statusCode < 300
    const retryable = response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500
    logWebhook(success ? 'INFO' : 'WARN', 'HTTP_POST_RESULT', { event_id: eventId, webhook_url: validation.url, status_code: response.statusCode, duration_ms: durationMs, retryable, response_body: response.body || '' })
    return {
      success,
      retryable: !success && retryable,
      statusCode: response.statusCode,
      responseBody: response.body.slice(0, WEBHOOK_MAX_RESPONSE_BYTES),
      error: success ? null : `HTTP ${response.statusCode}`,
    }
  } catch (error) {
    logWebhook('ERROR', 'HTTP_POST_EXCEPTION', { event_id: eventId, webhook_url: validation.url, error: error.message || 'Error de red' })
    return { success: false, retryable: true, error: error.message || 'Error de red' }
  }
}

async function ensureWebhookSecret(client) {
  if (client?.webhook_secret) return client

  const secret = crypto.randomBytes(32).toString('hex')
  const { data, error } = await supabase
    .from('clients')
    .update({ webhook_secret: secret })
    .eq('id', client.id)
    .is('webhook_secret', null)
    .select('id, name, token, active, phone_number, card1, card2, card3, wallet, device_id, expires_at, webhook_url, webhook_url_2, webhook_url_3, webhook_secret')
    .maybeSingle()

  if (error) throw error
  if (data) return data

  const { data: refreshed, error: refreshError } = await supabase
    .from('clients')
    .select('id, name, token, active, phone_number, card1, card2, card3, wallet, device_id, expires_at, webhook_url, webhook_url_2, webhook_url_3, webhook_secret')
    .eq('id', client.id)
    .maybeSingle()
  if (refreshError) throw refreshError
  return refreshed || { ...client, webhook_secret: secret }
}

async function queueWebhookDeliveries({ client, payload, eventId, logId }) {
  const urls = [client.webhook_url, client.webhook_url_2, client.webhook_url_3]
    .map(v => (v ? String(v).trim() : ''))
    .filter(Boolean)

  if (!urls.length) {
    logWebhook('WARN', 'NO_WEBHOOK_REGISTERED', { client_id: client.id, event_id: eventId })
    await persistWebhookEvent({ clientId: client.id, eventId, event: payload?.event, level: 'WARN', stage: 'QUEUE', status: 'SKIPPED', details: { reason: 'NO_WEBHOOK_REGISTERED' } })
    return { queued: 0, skipped: 0 }
  }

  const uniqueUrls = [...new Set(urls)]
  const rows = []
  let skipped = 0
  for (const url of uniqueUrls) {
    const validation = validateWebhookUrl(url)
    if (!validation.ok) {
      skipped += 1
      rows.push({
        client_id: client.id,
        event_id: eventId,
        sms_log_id: logId ? String(logId) : null,
        webhook_url: url,
        payload,
        status: 'FAILED',
        attempts: 0,
        last_error: validation.error,
        next_attempt_at: new Date().toISOString(),
      })
      continue
    }

    rows.push({
      client_id: client.id,
      event_id: eventId,
      sms_log_id: logId ? String(logId) : null,
      webhook_url: validation.url,
      payload,
      status: 'PENDING',
      attempts: 0,
      last_error: null,
      next_attempt_at: new Date().toISOString(),
    })
  }

  const { error } = await supabase
    .from('webhook_deliveries')
    .upsert(rows, { onConflict: 'client_id,event_id,webhook_url', ignoreDuplicates: true })

  if (error) {
    logWebhook('ERROR', 'QUEUE_FAILED', { client_id: client.id, event_id: eventId, error: error.message, queued_rows: rows.length })
    await persistWebhookEvent({ clientId: client.id, eventId, event: payload?.event, level: 'ERROR', stage: 'QUEUE', status: 'FAILED', error: error.message, details: { queued_rows: rows.length } })
    throw error
  }
  const queued = rows.filter(r => r.status === 'PENDING').length
  logWebhook('INFO', 'DELIVERIES_QUEUED', { client_id: client.id, event_id: eventId, queued, skipped, webhook_urls: uniqueUrls })
  await persistWebhookEvent({ clientId: client.id, eventId, event: payload?.event, level: 'INFO', stage: 'QUEUE', status: 'QUEUED', details: { queued, skipped, webhook_urls: uniqueUrls } })
  return { queued, skipped }
}

async function recoverStaleDeliveries() {
  const staleBefore = new Date(Date.now() - WEBHOOK_LOCK_TIMEOUT_MS).toISOString()
  const { error } = await supabase
    .from('webhook_deliveries')
    .update({ status: 'PENDING', locked_at: null, locked_by: null, next_attempt_at: new Date().toISOString(), last_error: 'Lock expirado; reintentando' })
    .eq('status', 'DELIVERING')
    .lt('locked_at', staleBefore)
  if (error) console.error('❌ Error recuperando webhooks bloqueados:', error.message)
}

async function processWebhookDeliveries(limit = 20) {
  if (workerBusy) return
  workerBusy = true
  try {
    await recoverStaleDeliveries()

    const { data: pending, error } = await supabase
      .from('webhook_deliveries')
      .select('id, client_id, event_id, webhook_url, payload, attempts')
      .eq('status', 'PENDING')
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) throw error

    for (const item of pending || []) {
      const attemptNumber = Number(item.attempts || 0) + 1
      const { data: claimed, error: claimError } = await supabase
        .from('webhook_deliveries')
        .update({
          status: 'DELIVERING',
          locked_at: new Date().toISOString(),
          locked_by: WORKER_ID,
          attempts: attemptNumber,
        })
        .eq('id', item.id)
        .eq('status', 'PENDING')
        .select('id, client_id, event_id, webhook_url, payload, attempts')
        .maybeSingle()

      if (claimError) {
        logWebhook('ERROR', 'CLAIM_FAILED', { delivery_id: item.id, event_id: item.event_id, client_id: item.client_id, error: claimError.message })
        await persistWebhookEvent({ clientId: item.client_id, eventId: item.event_id, deliveryId: item.id, level: 'ERROR', stage: 'CLAIM', status: 'FAILED', error: claimError.message })
        continue
      }
      if (!claimed) continue

      logWebhook('INFO', 'DELIVERY_ATTEMPT_START', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id, webhook_url: claimed.webhook_url, attempt: attemptNumber })
      await persistWebhookEvent({ clientId: claimed.client_id, eventId: claimed.event_id, deliveryId: claimed.id, level: 'INFO', stage: 'DELIVER', status: 'STARTED', webhookUrl: claimed.webhook_url, attempt: attemptNumber, details: { payload_event: claimed.payload?.event } })

      try {
        const { data: client, error: clientError } = await supabase
          .from('clients')
          .select('id, webhook_secret')
          .eq('id', claimed.client_id)
          .maybeSingle()

        if (clientError) {
          logWebhook('ERROR', 'CLIENT_SECRET_LOOKUP_FAILED', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id, error: clientError.message })
          throw clientError
        }
        if (!client?.webhook_secret) {
          const update = {
            status: 'FAILED',
            locked_at: null,
            locked_by: null,
            last_error: 'Webhook sin secreto configurado',
            next_attempt_at: new Date().toISOString(),
          }
          await supabase.from('webhook_deliveries').update(update).eq('id', claimed.id)
          logWebhook('ERROR', 'DELIVERY_NO_SECRET', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id })
          await persistWebhookEvent({ clientId: claimed.client_id, eventId: claimed.event_id, deliveryId: claimed.id, level: 'ERROR', stage: 'DELIVER', status: 'FAILED', webhookUrl: claimed.webhook_url, attempt: attemptNumber, error: update.last_error })
          continue
        }

        const result = await deliverWebhook({
          url: claimed.webhook_url,
          payload: claimed.payload,
          secret: client.webhook_secret,
          eventId: claimed.event_id,
        })

        if (result.success) {
          await supabase.from('webhook_deliveries').update({
            status: 'DELIVERED',
            delivered_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
            response_status: result.statusCode || null,
            response_body: result.responseBody || null,
            last_error: null,
          }).eq('id', claimed.id)
          logWebhook('INFO', 'DELIVERY_SUCCESS', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id, webhook_url: claimed.webhook_url, attempt: attemptNumber, response_status: result.statusCode, response_body: result.responseBody || '' })
          await persistWebhookEvent({ clientId: claimed.client_id, eventId: claimed.event_id, deliveryId: claimed.id, level: 'INFO', stage: 'DELIVER', status: 'DELIVERED', webhookUrl: claimed.webhook_url, attempt: attemptNumber, responseStatus: result.statusCode, responseBody: result.responseBody })
        } else {
          const exhausted = attemptNumber >= WEBHOOK_MAX_ATTEMPTS || !result.retryable
          const nextAttempt = new Date(Date.now() + calculateBackoffMs(attemptNumber)).toISOString()
          await supabase.from('webhook_deliveries').update({
            status: exhausted ? 'FAILED' : 'PENDING',
            locked_at: null,
            locked_by: null,
            next_attempt_at: nextAttempt,
            response_status: result.statusCode || null,
            response_body: result.responseBody || null,
            last_error: result.error || `HTTP ${result.statusCode || 0}`,
          }).eq('id', claimed.id)
          logWebhook(exhausted ? 'ERROR' : 'WARN', exhausted ? 'DELIVERY_FAILED_FINAL' : 'DELIVERY_RETRY_SCHEDULED', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id, webhook_url: claimed.webhook_url, attempt: attemptNumber, response_status: result.statusCode, response_body: result.responseBody || '', error: result.error || `HTTP ${result.statusCode || 0}`, next_attempt_at: nextAttempt })
          await persistWebhookEvent({ clientId: claimed.client_id, eventId: claimed.event_id, deliveryId: claimed.id, level: exhausted ? 'ERROR' : 'WARN', stage: 'DELIVER', status: exhausted ? 'FAILED' : 'RETRYING', webhookUrl: claimed.webhook_url, attempt: attemptNumber, responseStatus: result.statusCode, responseBody: result.responseBody, error: result.error || `HTTP ${result.statusCode || 0}`, details: { next_attempt_at: nextAttempt } })
        }
      } catch (error) {
        logWebhook('ERROR', 'DELIVERY_EXCEPTION', { delivery_id: claimed.id, event_id: claimed.event_id, client_id: claimed.client_id, webhook_url: claimed.webhook_url, attempt: attemptNumber, error: error.message })
        await persistWebhookEvent({ clientId: claimed.client_id, eventId: claimed.event_id, deliveryId: claimed.id, level: 'ERROR', stage: 'DELIVER', status: 'EXCEPTION', webhookUrl: claimed.webhook_url, attempt: attemptNumber, error: error.message })
        const exhausted = attemptNumber >= WEBHOOK_MAX_ATTEMPTS
        const nextAttempt = new Date(Date.now() + calculateBackoffMs(attemptNumber)).toISOString()
        await supabase.from('webhook_deliveries').update({
          status: exhausted ? 'FAILED' : 'PENDING',
          locked_at: null,
          locked_by: null,
          next_attempt_at: nextAttempt,
          last_error: error.message || 'Error procesando webhook',
        }).eq('id', claimed.id)
      }
    }
  } catch (error) {
    console.error('❌ Error en worker de webhooks:', error.message)
  } finally {
    workerBusy = false
  }
}

function startWebhookWorker() {
  if (workerTimer) return
  workerTimer = setInterval(() => {
    processWebhookDeliveries().catch(error => console.error('❌ Worker webhook:', error.message))
  }, WEBHOOK_WORKER_INTERVAL_MS)
  setTimeout(() => processWebhookDeliveries().catch(error => console.error('❌ Worker webhook inicial:', error.message)), 2_000)
}

module.exports = {
  createEventId,
  hmacHex,
  validateWebhookUrl,
  ensureWebhookSecret,
  queueWebhookDeliveries,
  deliverWebhook,
  processWebhookDeliveries,
  startWebhookWorker,
}
