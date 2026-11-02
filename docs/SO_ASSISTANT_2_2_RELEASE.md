# SO Assistant 2.2 — Funcionalidad Android y personalidad

Esta entrega Android incluye el avatar, estados emocionales, gestos, chat, consejos contextuales y presencia espontánea. El contrato con el backend es `GET /api/assistant/config` y `POST /api/assistant/chat`; los campos principales son `reply`, `emotion`, `gesture` y `mood_text`.

La versión 2.2.1 del backend sustituye el proveedor anterior por Cloudflare Workers AI. No hace falta recompilar Android 2.2 solamente para cambiar el proveedor, porque la app sigue consumiendo el mismo contrato HTTP.

La configuración y el orden de despliegue vigentes están en `docs/AI_ASSISTANT_CLOUDFLARE.md`.
