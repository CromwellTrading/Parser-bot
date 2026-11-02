# SO Assistant 2.2 — GroqCloud

## Variables privadas de Render

| Variable | Valor / finalidad |
|---|---|
| `GROQ_API_KEY` | Clave creada en GroqCloud. Obligatoria y solo en Render. |
| `GROQ_API_BASE_URL` | `https://api.groq.com/openai/v1` |
| `GROQ_MODEL_PRIMARY` | `openai/gpt-oss-120b` |
| `GROQ_MODEL_FALLBACKS` | `qwen/qwen3.8-27b,openai/gpt-oss-20b` |
| `GROQ_FALLBACKS_ENABLED` | `true`; intenta otros modelos ante límites o fallos transitorios. |
| `AI_ASSISTANT_DAILY_LIMIT` | Límite interno por cliente; predeterminado 80. |
| `AI_ASSISTANT_GLOBAL_DAILY_LIMIT` | Límite interno global; predeterminado 600. |
| `AI_ASSISTANT_MAX_TOKENS` | Máximo de salida; predeterminado 1400, límite duro 4096. |

La API es compatible con la ruta `POST /chat/completions` de GroqCloud. El backend rota el modelo inicial entre los modelos configurados y prueba los restantes cuando recibe límites (429), indisponibilidad o un modelo no disponible. No reintenta credenciales inválidas.

## Cuotas externas gratuitas

La página oficial de límites publica actualmente para cada uno de estos tres modelos Free Plan: 30 RPM, 1.000 RPD, 8.000 TPM y 200.000 TPD. Los límites se aplican a la organización de Groq, por modelo, no a cada usuario de SynthesisOne. Como se distribuyen solicitudes entre tres modelos, el cupo agregado teórico es mayor, pero los tokens por minuto/día pueden agotarse antes que las solicitudes. No se garantiza una cantidad fija de conversaciones.

Los límites internos (`AI_ASSISTANT_DAILY_LIMIT`, `AI_ASSISTANT_GLOBAL_DAILY_LIMIT`) son un segundo control; no amplían la cuota externa. Los valores exactos de la organización pueden variar. Revisa `https://console.groq.com/docs/rate-limits` y `https://console.groq.com/settings/limits` antes de publicar o ampliar el uso.

## Personalidad y avatar

El prompt de SO Assistant está en `src/utils/assistantService.js`. El backend solicita JSON con `reply`, `emotion`, `gesture` y `mood_text`. Si un modelo devuelve texto normal, el backend lo acepta con emoción neutral para mantener compatibilidad. Android muestra el avatar local `so_assistant_avatar.jpg`, el estado emocional y gestos breves.

La personalidad puede ser expresiva, curiosa, juguetona y espontánea, pero el asistente no afirma ser humano, no inventa datos de pedidos, no actúa financieramente y no pide credenciales privadas.

## Mensajes espontáneos

Android puede solicitar como máximo una intervención generada por IA al día por cliente, tras un retraso aleatorio al abrir Inicio. La petición `mode=spontaneous` no incluye historial ni contexto de cuenta, utiliza un único modelo, máximo 220 tokens de salida y timeout de 7 segundos. Cuenta como una solicitud normal y respeta los límites por cliente/globales. Si no hay cuota o el modelo no responde, Android muestra una frase local de respaldo. El usuario puede desactivarlo en Ajustes. No es una notificación push y no se ejecuta con la aplicación cerrada.

## Despliegue

1. Crear una API key en `https://console.groq.com/keys`.
2. Añadir `GROQ_API_KEY` y las variables de modelos a Render.
3. Mantener la clave únicamente en Render; nunca en Android, GitHub ni el archivo de recursos de la APK.
4. Desplegar el backend y verificar `/api/assistant/config` con una sesión autenticada.
5. Probar respuestas, cambio de modelo por 429 y comportamiento con una clave inválida en entorno de staging.
