# SO Assistant — configuración de OpenRouter

## Variables de entorno en Render

| Variable | Obligatoria | Valor |
|---|---:|---|
| `OPENROUTER_API_KEY` | Sí | Clave privada creada en OpenRouter. Solo en Render; nunca en Android ni en el repositorio. |
| `OPENROUTER_MODEL` | Sí | Identificador exacto del modelo que el propietario elija en OpenRouter (`proveedor/modelo`). No se fija uno en el código. |
| `AI_ASSISTANT_ENABLED` | No | `true` para habilitar o `false` para deshabilitar. Por defecto se habilita cuando existen clave y modelo. |
| `AI_ASSISTANT_DAILY_LIMIT` | No | Preguntas máximas por cliente y día UTC. Predeterminado: `25`; permitido: 1–200. |
| `AI_ASSISTANT_GLOBAL_DAILY_LIMIT` | No | Tope para todos los clientes combinados por día UTC. Predeterminado: `40`; permitido: 1–10.000. |
| `OPENROUTER_MAX_TOKENS` | No | Máximo de tokens de salida por respuesta. Predeterminado: `700`; permitido: 128–1200. |
| `OPENROUTER_REQUIRE_ZDR` | No | Predeterminado `true`: solo endpoints con Zero Data Retention y `data_collection=deny`. Para quitar esta protección, configurar `false` deliberadamente después de revisar las políticas del proveedor elegido. |
| `OPENROUTER_APP_NAME` | No | Nombre enviado a OpenRouter para identificar la aplicación. Predeterminado: `SynthesisOne SO`. |
| `OPENROUTER_SITE_URL` | No | URL pública del sitio de la app, si existe. Se envía como `HTTP-Referer`. |

No añadir estas variables al APK ni al archivo `.env` de Android. Configurar `OPENROUTER_API_KEY` y `OPENROUTER_MODEL` como secretos/variables privadas del servicio Render.

## Base de datos

Antes de habilitar el asistente, ejecutar una sola vez `supabase/migrations/034_ai_assistant_usage.sql` en el proyecto Supabase utilizado por producción. La migración registra únicamente el número de preguntas por cliente y día; no guarda prompts, respuestas ni transcripciones.

La cuota se consume antes de llamar al modelo. Una llamada que falle después de reservar la cuota también contará para el límite diario, para evitar reintentos costosos ilimitados. La base aplica ambos límites atómicamente: por cliente y para toda la aplicación. El límite global predeterminado es 40 consultas/día.

## Funcionamiento y privacidad

- Endpoint: `POST /api/assistant/chat` (requiere token de cliente válido).
- Estado: `GET /api/assistant/config` (requiere token de cliente válido).
- La clave OpenRouter permanece en el backend.
- El cliente Android envía un máximo de 12 mensajes de historial, con límites por mensaje y por conversación.
- No se guardan las conversaciones en Supabase. El historial permanece temporalmente en memoria de la pantalla Android.
- Cuando el cliente pregunta por pedidos, pagos, licencia o cupones, el backend puede adjuntar un resumen mínimo de su propia cuenta: estado de licencia, estados de sus últimos pedidos y estado/porcentaje de sus cupones. No se envían SMS, teléfonos, tarjetas, credenciales, claves, códigos de entrega ni identificadores completos de pedido.
- Las consultas sobre webhook pueden recibir como base de conocimiento la guía pública `docs/CLIENT_WEBHOOK_API.md`; el documento solo se adjunta cuando la pregunta es sobre webhooks.
- Las respuestas son de solo orientación. No hay herramientas para aprobar pagos, mover saldos, cancelar compras o realizar reembolsos.
- Se aplican cinco peticiones por minuto por cliente y un máximo diario persistente, configurable.
- Por defecto, OpenRouter debe enrutar a proveedores con `zdr: true` y `data_collection: deny`. Si el modelo elegido no tiene un endpoint compatible, la petición falla sin desactivar la protección. El propietario puede cambiar `OPENROUTER_REQUIRE_ZDR=false` solo tras revisar y aceptar la política de retención del proveedor.

## Prueba posterior al despliegue

1. Ejecutar la migración `034_ai_assistant_usage.sql`.
2. Añadir `OPENROUTER_API_KEY` y `OPENROUTER_MODEL` en Render.
3. Confirmar `AI_ASSISTANT_ENABLED=true` y guardar.
4. Consultar `GET /api/assistant/config` desde una sesión autenticada; debe devolver `enabled: true`.
5. En Android, abrir **Asistente IA** y preguntar una duda general.
6. Preguntar por el estado de un pedido propio. La respuesta debe utilizar solo el resumen asociado a esa cuenta.
7. Confirmar que el historial no aparece en tablas de Supabase y que los logs registran modelo/tokens/errores, nunca el texto de los mensajes.

## Notas sobre el modelo

El backend no contiene un modelo predeterminado. El propietario debe colocar en `OPENROUTER_MODEL` el ID exacto que elija en OpenRouter. Algunos modelos no disponen de proveedores que cumplan ZDR; en ese caso, la respuesta devuelve un mensaje de incompatibilidad de privacidad en vez de enviar los datos por una ruta menos protectora.


## SO Assistant proactivo 2.1

Además del chat, Android consume dos endpoints autenticados: `GET /api/assistant/insights` y `GET /api/assistant/admin/insights`. El primero devuelve un máximo de 20 eventos orientativos derivados de lecturas recientes del propio cliente: estados de pedidos, pagos en revisión, devoluciones, cupones recién emitidos, progreso de misiones de referidos y la ventana de bienvenida. El segundo exige rol `admin` validado en el backend y devuelve métricas agregadas de operación. Ninguno de estos endpoints llama a OpenRouter ni consume la cuota diaria del chat.

Las consultas usan límites explícitos por tabla (Game Market/ETECSA: 20 filas recientes cada una; Wallet: 15; cupones disponibles: 10; conteos de referidos por `count/head`). El backend no expone identificadores de cuenta en los eventos; genera IDs opacos para deduplicación. El cliente Android consulta como máximo cada 180 segundos mientras está conectado y registra un máximo de 80 eventos ya presentados en preferencias locales.

El diagnóstico administrativo es estrictamente de solo lectura. No puede habilitar automatizaciones, confirmar pagos, emitir reembolsos, cambiar saldos, reiniciar el servicio ni modificar pedidos. La autorización se verifica en servidor contra `clients.role`; ocultar o mostrar el botón en Android no concede permisos.

La entrega 2.1 añade guía de primera visita, consejos contextuales, guía visual a SO Reseller, resumen de cuenta para preparar consultas a soporte, recomendaciones de Wallet y avisos de cupones/misiones. No implementa asistencia por voz ni solicita permisos de micrófono.

### Límite entre asistencia proactiva y chat generativo

`GET /api/assistant/insights` y `GET /api/assistant/admin/insights` producen avisos a partir de reglas deterministas y consultas acotadas al backend; no llaman a OpenRouter ni consumen cuota de chat. El administrador solo recibe métricas agregadas y recomendaciones de lectura. Los dos endpoints requieren sesión; el segundo comprueba `clients.role=admin` en servidor. No hay herramientas del modelo para acreditar saldos, aprobar pagos, cambiar pedidos ni ejecutar reembolsos.
