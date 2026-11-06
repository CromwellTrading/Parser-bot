'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  assistantProviderConfig, assistantConfigured, assistantUsageLimits, normalizeMessages, buildSystemPrompt, loadRelevantKnowledge, needsAccountContext,
  safeOrderStatus, safeCouponStatus, shortTicket, extractAssistantText, extractAssistantPayload,
} = require('../src/utils/assistantService')

test('Cloudflare Workers AI is enabled only with a token, valid account ID and model', () => {
  const accountId = '7ba4f709737e4b343513e82767c712ac'
  assert.equal(assistantConfigured({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: accountId }), true)
  assert.equal(assistantConfigured({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' }), true)
  assert.equal(assistantConfigured({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: 'invalid' }), false)
  assert.equal(assistantConfigured({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_MODEL: 'openai/gpt-oss-120b' }), false)
  assert.equal(assistantConfigured({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: accountId, AI_ASSISTANT_ENABLED: 'false' }), false)
  assert.equal(assistantConfigured({ GROQ_API_KEY: 'old-key' }), false)
  const config = assistantProviderConfig({ CLOUDFLARE_API_TOKEN: 'token', CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8' })
  assert.deepEqual(config.models, ['@cf/qwen/qwen3-30b-a3b-fp8'])
  assert.equal(config.baseUrl, `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`)
  assert.equal(config.provider, 'cloudflare-workers-ai')
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
  assert.match(prompt, /CONVERSACIÓN NATURAL/)
  assert.match(prompt, /RAZONAMIENTO PRÁCTICO Y CÁLCULOS DE RESELLER/)
  assert.match(prompt, /CAPACIDADES Y ACCIONES EN LA APP/)
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

test('Cloudflare Qwen response parser supports structured personality and legacy plain-text content', () => {
  assert.equal(extractAssistantText({ choices: [{ message: { content: '  Hola  ' } }] }), 'Hola')
  const withThink = extractAssistantPayload({ choices: [{ message: { content: '<think>Reasoning hidden</think>\n{\"reply\":\"¡Vaya!\",\"emotion\":\"amused\",\"gesture\":\"wink\"}' } }] })
  assert.deepEqual(withThink, { reply: '¡Vaya!', emotion: 'amused', gesture: 'wink', mood_text: 'Divertida' })
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


test('assistant usage limits use Cloudflare-safe daily defaults and hard caps', () => {
  assert.deepEqual(assistantUsageLimits({}), { dailyLimit: 80, globalDailyLimit: 300, maxTokens: 1400 })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '500', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '15000', AI_ASSISTANT_MAX_TOKENS: '20' }), { dailyLimit: 200, globalDailyLimit: 10000, maxTokens: 128 })
  assert.deepEqual(assistantUsageLimits({ AI_ASSISTANT_DAILY_LIMIT: '125', AI_ASSISTANT_GLOBAL_DAILY_LIMIT: '600', AI_ASSISTANT_MAX_TOKENS: '2100' }), { dailyLimit: 125, globalDailyLimit: 600, maxTokens: 2100 })
  assert.equal(assistantUsageLimits({ AI_ASSISTANT_MAX_TOKENS: '9000' }).maxTokens, 4096)
  assert.equal(assistantUsageLimits({ AI_ASSISTANT_MAX_TOKENS: 'invalid' }).maxTokens, 1400)
  assert.equal(assistantUsageLimits({ AI_ASSISTANT_MAX_TOKENS: '0' }).maxTokens, 1400)
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


test('assistant route uses Cloudflare OpenAI-compatible endpoint and max_tokens', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/assistant.js'), 'utf8')
  assert.match(route, /\$\{provider\.baseUrl\}\/chat\/completions/)
  assert.match(route, /max_tokens: spontaneousMode \? Math\.min\(maxTokens, 220\) : maxTokens/)
  assert.doesNotMatch(route, /max_completion_tokens/)
  assert.doesNotMatch(route, /response_format: \{ type: 'json_object' \}/)
  assert.match(route, /AI_EXTERNAL_DAILY_LIMIT/)
})
