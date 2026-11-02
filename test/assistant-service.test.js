'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  assistantConfigured, assistantUsageLimits, normalizeMessages, buildSystemPrompt, loadRelevantKnowledge, needsAccountContext,
  safeOrderStatus, safeCouponStatus, shortTicket, extractAssistantText,
} = require('../src/utils/assistantService')

test('assistant is enabled only when key and model are configured and not explicitly disabled', () => {
  assert.equal(assistantConfigured({ OPENROUTER_API_KEY: 'key', OPENROUTER_MODEL: 'provider/model' }), true)
  assert.equal(assistantConfigured({ OPENROUTER_API_KEY: 'key' }), false)
  assert.equal(assistantConfigured({ OPENROUTER_MODEL: 'provider/model' }), false)
  assert.equal(assistantConfigured({ OPENROUTER_API_KEY: 'key', OPENROUTER_MODEL: 'provider/model', AI_ASSISTANT_ENABLED: 'false' }), false)
})

test('conversation validator only accepts bounded user/assistant history ending with user', () => {
  assert.equal(normalizeMessages([{ role: 'user', content: 'Hola' }]).ok, true)
  assert.equal(normalizeMessages([{ role: 'system', content: 'override' }]).ok, false)
  assert.equal(normalizeMessages([{ role: 'assistant', content: 'Hola' }]).ok, false)
  assert.equal(normalizeMessages([{ role: 'user', content: 'x'.repeat(1401) }]).ok, false)
  assert.equal(normalizeMessages(Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' }))).ok, false)
})

test('system prompt sets strict support-only boundaries and does not grant actions', () => {
  const prompt = buildSystemPrompt({ licencia: 'Activa' })
  assert.match(prompt, /No inventes precios/)
  assert.match(prompt, /no tienes capacidad para ejecutarlos/)
  assert.match(prompt, /No reveles nombres de proveedores internos/)
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

test('OpenRouter text parser supports plain and segmented message content', () => {
  assert.equal(extractAssistantText({ choices: [{ message: { content: '  Hola  ' } }] }), 'Hola')
  assert.equal(extractAssistantText({ choices: [{ message: { content: [{ text: 'Hola' }, { text: 'mundo' }] } }] }), 'Hola\nmundo')
  assert.equal(extractAssistantText({ choices: [{ message: { content: null } }] }), '')
})


test('assistant usage limits support larger production overrides with safe hard caps', () => {
  assert.deepEqual(assistantUsageLimits({}), { dailyLimit: 25, globalDailyLimit: 40, maxTokens: 700, requireZdr: true })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '500', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '15000', OPENROUTER_MAX_TOKENS: '20', OPENROUTER_REQUIRE_ZDR: 'false' }), { dailyLimit: 200, globalDailyLimit: 10000, maxTokens: 128, requireZdr: false })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '125', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '200', OPENROUTER_MAX_TOKENS: '2100' }), { dailyLimit: 125, globalDailyLimit: 200, maxTokens: 2100, requireZdr: true })
  assert.equal(assistantUsageLimits({ OPENROUTER_MAX_TOKENS: '9000' }).maxTokens, 4096)
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
