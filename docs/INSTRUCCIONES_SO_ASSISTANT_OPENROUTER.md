# SO Assistant — instalación de OpenRouter

Este paquete añade un chat de atención al cliente dentro de SynthesisOne SO. El modelo NO está preseleccionado: el propietario elige el ID exacto en OpenRouter y lo coloca en Render.

## Orden de instalación

1. Haz una copia del backend y de la base de datos actual.
2. En el proyecto Supabase conectado a producción, revisa que la migración `034_ai_assistant_usage.sql` no esté aplicada y ejecútala una sola vez. Crea dos contadores: por cliente y global diario. No almacena conversaciones.
3. En Render añade las variables que aparecen abajo. `OPENROUTER_API_KEY` es secreta; no la coloques en Android, en un `.env` compartido ni en GitHub.
4. Despliega el backend actualizado. Comprueba `/healthz`, `/readyz` y los logs.
5. Compila e instala el APK Android actualizado con la misma clave de firma y un `versionCode` superior.
6. Con una cuenta real, abre `ASISTENTE IA`, comprueba que el estado pasa a conectado y realiza una pregunta general. Luego prueba una consulta de pedido/cupón propio.

## Variables de Render

| Variable | Valor |
|---|---|
| `OPENROUTER_API_KEY` | Tu clave privada de OpenRouter. Obligatoria. |
| `OPENROUTER_MODEL` | El ID exacto que tú elijas, formato `proveedor/modelo`. Obligatoria. |
| `AI_ASSISTANT_ENABLED` | `true`. Opcional; se activa automáticamente si hay clave y modelo. |
| `AI_ASSISTANT_DAILY_LIMIT` | `25` preguntas por cliente/día UTC por defecto. |
| `AI_ASSISTANT_GLOBAL_DAILY_LIMIT` | `40` preguntas para todos los clientes/día UTC por defecto. |
| `OPENROUTER_MAX_TOKENS` | `700` tokens de salida como máximo por defecto. |
| `OPENROUTER_REQUIRE_ZDR` | `true` por defecto. Exige proveedores compatibles con Zero Data Retention y `data_collection=deny`. |
| `OPENROUTER_APP_NAME` | `SynthesisOne SO` por defecto. |
| `OPENROUTER_SITE_URL` | URL pública propia si existe; opcional. |

No se incluye ningún ID de modelo predeterminado. Si el modelo que elijas no tiene un proveedor compatible con ZDR, la petición se rechazará en lugar de enviar el contexto por un proveedor menos protector. Cambiar `OPENROUTER_REQUIRE_ZDR=false` desactiva esa protección por solicitud y debe hacerse solo después de revisar las políticas del proveedor.

## Costes y límites

- El backend limita cada cliente a 25 consultas diarias y toda la aplicación a 40 consultas diarias de forma predeterminada. Ambos límites son configurables.
- Añade también un límite de crédito/gasto a la clave de OpenRouter desde su panel, si tu tipo de cuenta ofrece esa opción. No dependas únicamente del límite diario de la aplicación.
- El máximo predeterminado es 700 tokens; el backend acepta valores configurados entre 128 y 4096 tokens.
- El contador se consume antes de llamar al modelo; un error del proveedor también puede consumir un intento para evitar reintentos ilimitados.

## Privacidad y permisos

- La clave de OpenRouter solo está en Render.
- Se envía solo el historial reciente y limitado de la conversación. No se persiste en Supabase.
- Para preguntas de cuenta, el backend obtiene un resumen de la cuenta autenticada. Elige solo los datos necesarios: pedidos, cupones, licencia o saldos. No envía SMS, números de tarjeta, teléfonos de transferencia, tokens, secretos ni códigos de entrega.
- CUP y Saldo Móvil se presentan como balances separados.
- La IA es de consulta. No puede aprobar pagos, modificar balances, emitir reembolsos, cancelar pedidos ni liberar productos.
- Los casos que necesitan intervención pasan al canal de soporte humano.

## Prueba

1. `GET /api/assistant/config` con una sesión de cliente válida debe devolver `enabled: true`.
2. `POST /api/assistant/chat` recibe `{ "messages": [{"role":"user","content":"Hola"}] }`.
3. Comprueba que el log `AI_ASSISTANT_REQUEST_COMPLETED` registra el modelo y el uso de tokens, pero nunca el texto del mensaje o la respuesta.
4. Comprueba que el contador global y el del cliente se incrementan.

El build Android debe validarse con GitHub Actions. El entorno local de esta preparación no pudo descargar Gradle desde `services.gradle.org`; no debe considerarse certificada la compilación hasta que el workflow termine satisfactoriamente.
