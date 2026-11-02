# SynthesisOne Backend 2.2.1 — Cloudflare Workers AI

- Sustituye la configuración del asistente de Groq por Cloudflare Workers AI.
- Añade validación estricta del Account ID de 32 caracteres y del identificador de modelo `@cf/...`.
- Usa el endpoint oficial `/ai/v1/chat/completions`, Bearer token y el parámetro `max_tokens`.
- Mantiene el contrato de chat existente y oculta el nombre del proveedor en las respuestas enviadas a Android.
- Mantiene el prompt de personalidad, los límites de seguridad, los contextos autenticados, el avatar y las emociones.
- Ajusta los valores internos iniciales a 300 solicitudes globales/día y 650 tokens máximos de salida para controlar el consumo de la cuota gratuita.
- Fortalece el parser para respuestas JSON envueltas en texto y elimina bloques `<think>`.
- No añade migraciones SQL ni cambia los procesos de pagos, Wallet, licencias, ETECSA, Game Market o webhooks.

Antes de desplegar, seguir `docs/AI_ASSISTANT_CLOUDFLARE.md`. El token que se compartió en la conversación debe revocarse y sustituirse por uno nuevo.
