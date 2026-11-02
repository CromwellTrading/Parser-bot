# SynthesisOne SO Assistant 2.2

- Proveedor principal migrado a GroqCloud con API compatible con OpenAI.
- Selección rotativa entre `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` y `openai/gpt-oss-20b`, con fallback ante límites e indisponibilidad transitoria.
- La respuesta mantiene `reply` para clientes anteriores y añade `emotion`, `gesture`, `mood_text`, `provider`, `model` y `spontaneous`.
- Prompt de personalidad ampliado: mayor libertad expresiva, humor, curiosidad, sorpresa, timidez de personaje, orgullo, picardía y variedad de tono; conserva límites de honestidad, privacidad y seguridad financiera.
- Avatar local incluido: aparece en cabecera del chat, junto a cada burbuja del asistente, en el acceso flotante y en advertencias.
- Animaciones breves para emociones/gestos normalizados.
- Intervención espontánea opcional: máximo una vez al día por cliente, con retraso aleatorio, únicamente en Inicio, sin datos de cuenta y con respuesta máxima de 220 tokens / timeout de 7 segundos. Consume una consulta si la IA responde; si no hay cuota o el modelo no responde, se usa frase local.
- El usuario puede desactivar la personalidad espontánea en Ajustes. No hay push ni ejecución cuando la app está cerrada.
- Sin asistencia por voz ni nuevos permisos de micrófono.

## Configuración Render

`GROQ_API_KEY` es obligatoria. Debe crearse en https://console.groq.com/keys. Una API key de OpenRouter no funciona en GroqCloud. La clave permanece únicamente en Render. Modelos, límites y timeout se configuran con `GROQ_*` y `AI_ASSISTANT_*`.

## Compatibilidad y despliegue

- No se añade una migración SQL nueva: se conservan los contadores de cuota existentes de la migración 034 y las políticas RLS anteriores.
- Los clientes Android anteriores pueden ignorar los campos adicionales y seguir leyendo `reply`.
- Desplegar primero el backend 2.2, comprobar `/api/assistant/config` y los límites en staging, y después publicar la APK firmada.
- En Android, el workflow de GitHub Actions puede generar el Gradle Wrapper JAR oficial y verificar el SHA-256 antes de compilar, aunque el JAR no esté presente en el ZIP inicial.


## Pruebas de esta entrega

- Backend independiente: 206 aprobadas, 0 fallidas y 15 omitidas porque el proyecto Android no está junto al backend.
- Backend con el árbol Android enlazado: 220 aprobadas y 1 fallo. El único fallo es una prueba de integración heredada que espera que `MainActivity.kt` llame a `/api/auth/webhooks/deliveries`; esa llamada no existe en el fuente actual. No se ha cambiado ese flujo en esta entrega de IA.
- Todos los archivos JavaScript de `src/` pasan `node --check`.
- No se pudo completar `assembleRelease` en el entorno de trabajo. El workflow de GitHub descarga Gradle 8.1.1, genera el wrapper JAR oficial ausente y comprueba su SHA-256 antes de compilar y firmar. La APK debe considerarse pendiente hasta que el workflow termine correctamente.
