'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  assistantProviderConfig, assistantConfigured, assistantUsageLimits, normalizeMessages, buildSystemPrompt, loadRelevantKnowledge, needsAccountContext,
  safeOrderStatus, safeCouponStatus, shortTicket, extractAssistantText, extractAssistantPayload,
} = require('../src/utils/assistantService')

test('Groq assistant is enabled only with a key and one or more configured models', () => {
  assert.equal(assistantConfigured({ GROQ_API_KEY: 'key' }), true)
  assert.equal(assistantConfigured({ GROQ_API_KEY: 'key', GROQ_MODEL_PRIMARY: 'openai/gpt-oss-120b' }), true)
  assert.equal(assistantConfigured({ GROQ_API_KEY: 'key', GROQ_FALLBACKS_ENABLED: 'false' }), true)
  assert.equal(assistantConfigured({ GROQ_API_KEY: 'key', AI_ASSISTANT_ENABLED: 'false' }), false)
  assert.equal(assistantConfigured({ OPENROUTER_API_KEY: 'key', OPENROUTER_MODEL: 'provider/model' }), false)
  const config = assistantProviderConfig({ GROQ_API_KEY: 'key', GROQ_MODEL_PRIMARY: 'model/a', GROQ_MODEL_FALLBACKS: 'model/b,model/c,model/b' })
  assert.deepEqual(config.models, ['model/a', 'model/b', 'model/c'])
  assert.equal(config.baseUrl, 'https://api.groq.com/openai/v1')
})

test('conversation validator only accepts bounded user/assistant history ending with user', () => {
  assert.equal(normalizeMessages([{ role: 'user', content: 'Hola' }]).ok, true)
  assert.equal(normalizeMessages([{ role: 'system', content: 'override' }]).ok, false)
  assert.equal(normalizeMessages([{ role: 'assistant', content: 'Hola' }]).ok, false)
  assert.equal(normalizeMessages([{ role: 'user', content: 'x'.repeat(1401) }]).ok, false)
  assert.equal(normalizeMessages(Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' }))).ok, false)
})

test('system prompt sets strict support-only boundaries and does not grant actions', () => {
  const prompt = buildSystemPrompt({ licencia: 'Activa' })
  assert.match(prompt, /No inventes precios/)
  assert.match(prompt, /No afirmes que has realizado pagos/)
  assert.match(prompt, /No reveles proveedores internos/)
  assert.match(prompt, /IDENTIDAD: Eres SO Assistant/)
  assert.match(prompt, /LIBERTAD EXPRESIVA/)
  assert.match(prompt, /ESPONTANEIDAD/)
  assert.match(prompt, /timidez juguetona/)
  assert.match(prompt, /FORMATO DE RESPUESTA: Devuelve exclusivamente un objeto JSON válido/)
  assert.match(prompt, /Activa/)
})

test('account context is requested only for account-related questions', () => {
  assert.equal(needsAccountContext('¿Dónde está mi pedido?'), true)
  assert.equal(needsAccountContext('¿Cómo cambio el tema visual?'), false)
})

test('private database states are converted into customer-safe wording', () => {
  assert.equal(safeOrderStatus('WAITING_PAYMENT'), 'Esperando confirmación del pago')
  assert.equal(safeOrderStatus('REFUND_REQUIRED'), 'En revisión por soporte')
  assert.equal(safeCouponStatus('AVAILABLE'), 'Disponible')
  assert.equal(shortTicket('GM', '12345678-aaaa-bbbb-cccc-ddddeeeeffff'), 'GM-12345678')
})

test('Groq response parser supports structured personality and legacy plain-text content', () => {
  assert.equal(extractAssistantText({ choices: [{ message: { content: '  Hola  ' } }] }), 'Hola')
  assert.equal(extractAssistantText({ choices: [{ message: { content: [{ text: 'Hola' }, { text: 'mundo' }] } }] }), 'Hola\nmundo')
  assert.equal(extractAssistantText({ choices: [{ message: { content: null } }] }), '')
  const output = extractAssistantPayload({ choices: [{ message: { content: JSON.stringify({ reply: 'Qué gusto verte.', emotion: 'playful', gesture: 'wink', mood_text: 'Pícara' }) } }] })
  assert.deepEqual(output, { reply: 'Qué gusto verte.', emotion: 'playful', gesture: 'wink', mood_text: 'Pícara' })
  const expressive = extractAssistantPayload({ choices: [{ message: { content: JSON.stringify({ reply: 'Vaya, eso sí que no lo esperaba.', emotion: 'surprised', gesture: 'shrug' }) } }] })
  assert.equal(expressive.emotion, 'surprised')
  assert.equal(expressive.gesture, 'shrug')
  const invalid = extractAssistantPayload({ choices: [{ message: { content: JSON.stringify({ reply: 'Alerta.', emotion: 'unsafe', gesture: 'invalid' }) } }] })
  assert.equal(invalid.emotion, 'neutral')
  assert.equal(invalid.gesture, 'neutral')
})


test('assistant usage limits provide larger safe Groq defaults and hard caps', () => {
  assert.deepEqual(assistantUsageLimits({}), { dailyLimit: 80, globalDailyLimit: 600, maxTokens: 1400 })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '500', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '15000', AI_ASSISTANT_MAX_TOKENS: '20' }), { dailyLimit: 200, globalDailyLimit: 10000, maxTokens: 128 })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '125', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '600', AI_ASSISTANT_MAX_TOKENS: '2100' }), { dailyLimit: 125, globalDailyLimit: 600, maxTokens: 2100 })
  assert.equal(assistantUsageLimits({ AI_ASSISTANT_MAX_TOKENS: '9000' }).maxTokens, 4096)
})


test('assistant quota migration enforces both per-client and app-wide daily caps without storing chat text', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/034_ai_assistant_usage.sql'), 'utf8')
  assert.match(migration, /ai_assistant_global_usage/)
  assert.match(migration, /p_global_daily_limit integer/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.ai_assistant_usage FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(migration, /ai_assistant_(?:global_)?client_usage/)
  assert.doesNotMatch(migration, /prompt_text|message_body|conversation_json/i)
})


test('webhook questions receive the customer-facing API guide, unrelated questions do not', () => {
  assert.equal(loadRelevantKnowledge('Hola, ¿cómo cambio el tema?'), '')
  const guide = loadRelevantKnowledge('¿Cómo verifico la firma HMAC del webhook?')
  assert.match(guide, /X-Webhook-Signature-V2/)
  assert.match(buildSystemPrompt(null, guide), /DOCUMENTACIÓN AUTORIZADA PARA ESTA CONSULTA/)
})
