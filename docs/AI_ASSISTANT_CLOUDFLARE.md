# SynthesisOne 2.2.2 — Cloudflare Workers AI y despliegue seguro

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
| `AI_ASSISTANT_MAX_TOKENS` | `1400` (máximo de salida por respuesta; ajustable hasta 4096) |

Los límites internos son controles de SynthesisOne y no amplían los límites de Neurons de Cloudflare. La cuota gratuita publicada de Workers AI es de 10.000 Neurons por día. El número de conversaciones que permite depende de los tokens reales de entrada y salida; debe vigilarse en el panel de Cloudflare.

## Seguridad de la clave

- Crear un token con los permisos mínimos necesarios de Workers AI. Cloudflare indica `Workers AI - Read` y `Workers AI - Edit` para tokens personalizados.
- No pegar el token en el chat, GitHub, APK, capturas o documentos compartidos.
- El token previamente compartido en una conversación debe considerarse expuesto: revocarlo y generar uno nuevo antes de habilitar producción.
- No guardar el token en el repositorio. Usar únicamente Environment en Render.
- No configurar una clave de Groq u OpenRouter como sustituta de `CLOUDFLARE_API_TOKEN`; son credenciales distintas.

## Android: ¿hace falta actualizar?

No para el cambio de proveedor si los clientes ya usan Android 2.2. Esa versión consume las mismas rutas `/api/assistant/config` y `/api/assistant/chat`, y ya procesa `reply`, `emotion`, `gesture` y `mood_text`. La credencial de Cloudflare nunca se envía a Android. Si los clientes todavía usan una versión anterior sin el chat/avatar 2.2, necesitarán la actualización Android correspondiente por sus funciones de interfaz, no por el cambio de proveedor.

## Despliegue seguro de la versión 2.2.2

1. Revocar el token que se compartió en una conversación y crear uno nuevo con permisos mínimos de Workers AI.
2. En Render, añadir `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_MODEL`, `AI_ASSISTANT_ENABLED` y los límites internos indicados arriba. No sobrescribir el resto del entorno.
3. Retirar las variables `GROQ_*` solo después de confirmar que el backend nuevo responde correctamente. No borrar otras variables de Render.
4. Hacer respaldo reciente de Supabase. Para el cambio de proveedor de IA se conserva `034_ai_assistant_usage.sql`; **la migración nueva `036_gamemarket_direct_cubacel_payments.sql` es necesaria por el pago directo de Game Market con Saldo Móvil**, no por Cloudflare.
5. Antes de publicar el backend 2.2.2, comprobar que `RECHARGEGAMES_API_KEY` y `STORE_WALLET_SALDO_RECEIVER_PHONE` ya están configuradas en Render. Aplicar la migración 036 desde el proyecto Supabase correcto y confirmar que termina sin errores. Si informa de SMS duplicados, detenerse y revisar esos registros; no borrar datos automáticamente.
6. Desplegar el backend 2.2.2. Con una sesión real de prueba, consultar `GET /api/assistant/config` y probar `POST /api/assistant/chat`. Verificar que la respuesta incluya `reply`, `emotion`, `gesture` y `mood_text`.
7. Probar con una cuenta controlada una oferta individual con Saldo Móvil, comprobando que solo se liquide con un SMS CUBACEL exacto y que no se genere un movimiento de Wallet. Comprobar también Transfermóvil CUP, Wallet CUP/SALDO y las operaciones normales de login, ETECSA, licencias y webhooks.
8. Publicar la nueva APK 2.2.2 para llevar a los usuarios el chat compacto y la nueva opción de pago directo. Android no necesita credenciales de Cloudflare.

## Límites de validación de esta entrega

Las pruebas automatizadas verifican configuración, construcción de endpoint, límites y parsing sin llamar al proveedor real. Una llamada real a Cloudflare requiere el token nuevo y debe realizarse después del despliegue en Render; no se declara verificada en este paquete. La suite no sustituye una transacción CUBACEL real ni la prueba del proveedor RechargeGames. La migración 036 tampoco se ha aplicado a producción desde este entorno.
