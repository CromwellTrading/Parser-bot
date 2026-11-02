# SO Assistant 2.2.1 — Cloudflare Workers AI

## Integración

El backend usa el endpoint REST oficial OpenAI-compatible:

`https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`

Modelo predeterminado: `@cf/qwen/qwen3-30b-a3b-fp8`. La petición usa `max_tokens` (no `max_completion_tokens`). El formato JSON se pide mediante el prompt del sistema; no se envía `response_format` porque Qwen3 no figura actualmente en la lista publicada de modelos con JSON Mode garantizado. El parser conserva compatibilidad con texto normal y elimina segmentos `<think>...</think>` antes de interpretar la respuesta.

## Variables privadas de Render

| Variable | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token nuevo de Workers AI. Solo en Render. |
| `CLOUDFLARE_ACCOUNT_ID` | ID de cuenta Cloudflare de 32 caracteres hexadecimales. |
| `CLOUDFLARE_MODEL` | `@cf/qwen/qwen3-30b-a3b-fp8` |
| `AI_ASSISTANT_ENABLED` | `true` |
| `AI_ASSISTANT_DAILY_LIMIT` | `80` (máximo interno por cliente) |
| `AI_ASSISTANT_GLOBAL_DAILY_LIMIT` | `300` (protección global inicial) |
| `AI_ASSISTANT_MAX_TOKENS` | `650` (máximo de salida por respuesta) |

Los límites internos son controles de SynthesisOne y no amplían los límites de Neurons de Cloudflare. La cuota gratuita publicada de Workers AI es de 10.000 Neurons por día. El número de conversaciones que permite depende de los tokens reales de entrada y salida; debe vigilarse en el panel de Cloudflare.

## Seguridad de la clave

- Crear un token con los permisos mínimos necesarios de Workers AI. Cloudflare indica `Workers AI - Read` y `Workers AI - Edit` para tokens personalizados.
- No pegar el token en el chat, GitHub, APK, capturas o documentos compartidos.
- El token previamente compartido en una conversación debe considerarse expuesto: revocarlo y generar uno nuevo antes de habilitar producción.
- No guardar el token en el repositorio. Usar únicamente Environment en Render.
- No configurar una clave de Groq u OpenRouter como sustituta de `CLOUDFLARE_API_TOKEN`; son credenciales distintas.

## Android: ¿hace falta actualizar?

No para el cambio de proveedor si los clientes ya usan Android 2.2. Esa versión consume las mismas rutas `/api/assistant/config` y `/api/assistant/chat`, y ya procesa `reply`, `emotion`, `gesture` y `mood_text`. La credencial de Cloudflare nunca se envía a Android. Si los clientes todavía usan una versión anterior sin el chat/avatar 2.2, necesitarán la actualización Android correspondiente por sus funciones de interfaz, no por el cambio de proveedor.

## Despliegue seguro

1. Revocar el token filtrado y crear otro token de Workers AI.
2. En Render, añadir `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_MODEL`, `AI_ASSISTANT_ENABLED` y los límites internos indicados arriba.
3. Retirar las variables `GROQ_*` antiguas cuando el backend nuevo esté desplegado y probado. No borrar otras variables de Render.
4. Desplegar el backend 2.2.1 primero. No se requiere una migración SQL nueva; se mantiene la migración `034_ai_assistant_usage.sql`.
5. Con una sesión real de prueba, consultar `GET /api/assistant/config` y probar `POST /api/assistant/chat`. Verificar que la respuesta incluya `reply`, `emotion`, `gesture` y `mood_text`.
6. Comprobar logs, límites, respuestas 401/403/429 y la operación normal de login, pagos, Wallet, ETECSA y Game Market. La actualización del asistente no debe modificar esos flujos.
7. Publicar Android solo si hace falta llevar a los usuarios una versión anterior a 2.2.

## Límites de validación de esta entrega

Las pruebas automatizadas verifican configuración, construcción de endpoint, límites y parsing sin llamar al proveedor real. Una llamada real a Cloudflare requiere el token nuevo y debe realizarse después del despliegue en Render; no se declara verificada en este paquete.
