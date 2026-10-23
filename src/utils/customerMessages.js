'use strict'

const INTERNAL_SERVICE_REFERENCE = /\b(recharge[\s_-]?games|soky(?:recargas)?|render|supabase|postgrest|service[\s_-]?role|api[\s_-]?key)\b/i

function safeCustomerText(value, fallback = null, maxLength = 500) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  if (!text) return fallback
  if (INTERNAL_SERVICE_REFERENCE.test(text)) return fallback
  return text
}

function safeAutomationMessage(value) {
  return safeCustomerText(value, 'El servicio está temporalmente fuera de línea. Inténtalo más tarde.', 240)
}

module.exports = { safeCustomerText, safeAutomationMessage }
