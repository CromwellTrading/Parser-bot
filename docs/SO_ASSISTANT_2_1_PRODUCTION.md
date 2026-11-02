> **Documento histórico de SO Assistant 2.1.** No uses sus instrucciones antiguas de proveedor ni sus resultados de pruebas como validación de la versión actual. Para la configuración vigente del asistente, sigue `docs/AI_ASSISTANT_CLOUDFLARE.md` y la nota de versión `docs/SO_ASSISTANT_2_2_1_CLOUDFLARE.md`. La versión 2.2.1 del backend es la que debe desplegarse para Cloudflare Workers AI.

# SynthesisOne — SO Assistant 2.1 (guía de despliegue)

## Alcance de la actualización

Esta entrega continúa sobre el proyecto 2.0 e incorpora la capa proactiva del asistente. No incluye asistencia por voz, grabación, reconocimiento de voz, micrófono ni permisos nuevos.

### Funciones para clientes

- Acceso flotante al asistente con preferencia para ocultarlo; las advertencias críticas de pago siguen mostrándose.
- Tutor de primera visita y consejos contextuales para Actividad, Libro de caja, Game Market y Wallet.
- Seguimiento proactivo de pedidos Game Market, ETECSA y recargas Wallet: revisión de pago, datos pendientes, revisión de entrega/devolución, operaciones que continúan en proceso, tickets vencidos, entregas y devoluciones confirmadas.
- Alertas de cupones recién emitidos, misiones de referidos cercanas a completarse, códigos de referido próximos a un nuevo cupón y oferta de bienvenida próxima a vencer.
- Asesor de recompensas dentro del panel existente, guía rápida y navegación visual hasta la tarjeta SO Reseller.
- Comparador Mobile Legends: compara solo paquetes activos/disponibles con cantidad de diamantes explícita e identifica la mejor relación precio/cantidad en la región seleccionada. No cambia la selección ni altera los precios.
- Consejos de seguridad en Wallet y botón para preparar un resumen de pedidos/pagos/Wallet para soporte.
- Para clientes administradores, diagnóstico agregado y de solo lectura sobre incidencias, Wallet, pedidos, webhooks, base de datos y automatización.

### Límites deliberados

- La IA no acredita saldo, no autoriza transferencias, no modifica pedidos, no activa automatizaciones, no emite reembolsos y no aprueba solicitudes.
- Los cálculos, reglas de cupones, precios, cantidades y decisiones de disponibilidad permanecen en la lógica determinista existente.
- Los diagnósticos administrativos se basan en métricas agregadas. Si parte de las métricas no puede consultarse, el resultado se marca como parcial y no debe interpretarse como un estado sano.
- En la entrega 2.1, las intervenciones espontáneas de personalidad se generaban localmente desde un conjunto limitado de frases. El proveedor remoto cambió en la actualización 2.2.1; consulta `docs/AI_ASSISTANT_CLOUDFLARE.md` para la configuración vigente.
- Las lecturas proactivas de cliente están acotadas: hasta 20 pedidos Game Market, 20 ETECSA, 15 tickets Wallet, 10 cupones recientes y conteos por `count/head` para referidos.

## Cambios de API

| Método y ruta | Autorización | Finalidad |
|---|---|---|
| `GET /api/assistant/insights` | Sesión autenticada, token no revocado y device binding cuando esté configurado | Devuelve hasta 20 avisos contextuales del cliente actual. Respuesta `no-store`. |
| `GET /api/assistant/admin/insights` | Igual que arriba y además `clients.role = admin` verificado en backend | Devuelve métricas agregadas e indicaciones operativas de solo lectura. Respuesta `no-store`. |

El cliente consulta insights cada 180 segundos con conexión y sesión activa. Se aplica límite de cinco consultas por minuto por cliente; la frecuencia Android normal es una cada tres minutos. El asistente guarda localmente hasta 80 IDs opacos para evitar repetir avisos ya mostrados.

## Orden de despliegue recomendado

1. Descargar y conservar una copia del backend y Android actualmente desplegados.
2. Crear y verificar un backup restaurable de Supabase antes de tocar migraciones.
3. Confirmar que la migración `034_ai_assistant_usage.sql` ya se ejecutó una sola vez, si el chat del asistente ya está habilitado. No duplicarla.
4. Revisar `docs/SECURITY_RLS_HARDENING.md`. La migración `035_public_schema_backend_only_rls.sql` debe ejecutarse manualmente y solo si todas las integraciones existentes acceden a las tablas por backend/service role. No se ejecuta automáticamente desde la APK ni desde Render.
5. Desplegar el backend 2.1 en Render, conservando las variables productivas actuales (especialmente URL/clave Supabase, tokens de proveedores, webhook y bot). No rotar ni copiar secretos como parte de este cambio.
6. Probar `/healthz`, `/readyz`, login, `/api/assistant/config`, `/api/assistant/insights` con una sesión de cliente y `/api/assistant/admin/insights` con una cuenta administradora. Una cuenta cliente normal debe recibir `403` en la ruta administrativa.
7. Compilar Android con el mismo keystore de release y `versionCode` superior al instalado. No distribuir un APK debug como actualización de producción.
8. Probar de extremo a extremo: checkout en CUP, Wallet, topup con automatización habilitada/deshabilitada, compra con saldo existente, historial, Game Market, Mobile Legends, ETECSA, cupones, misiones, SO Reseller, soporte y panel admin.

## Pruebas disponibles en el paquete

- `node --check` en los módulos backend modificados.
- `node --test test/assistant-insights.test.js test/assistant-proactive-security.test.js test/assistant-service.test.js` para las funciones de asistente y seguridad: **23/23 pasan**.
- `npm test` para toda la suite: **220/221 pasan**.

La suite completa mantiene un único fallo preexistente de integración: el test `licensed webhook delivery history is client-scoped and returns only a safe summary` espera que Android llame a `/api/auth/webhooks/deliveries`; esa llamada ya está ausente en el `MainActivity.kt` original y no se añadió ni eliminó en esta actualización. El resto de la suite pasa.

La compilación Android no pudo completarse en este entorno porque Gradle 8.1.1 debe descargarse desde `services.gradle.org` y el entorno no pudo resolver ese host. La comprobación PSI de Kotlin sí valida que el archivo fuente se puede parsear, pero no sustituye una compilación Android real. Ejecuta el workflow de GitHub Actions del proyecto antes de instalar la APK en producción.

## RLS y seguridad

La migración 035 endurece los objetos de aplicación del esquema `public` para acceso exclusivamente backend, pero **no se ha aplicado al Supabase de producción** desde este entorno. No declares RLS activado hasta ejecutar la migración completa, comprobar `COMMIT` y realizar las consultas de verificación incluidas en `docs/SECURITY_RLS_HARDENING.md`. La migración puede interrumpir integraciones que utilicen `anon` o `authenticated` directamente; primero verifica las dependencias. `service_role` debe permanecer solo en Render.

## Cobertura funcional de la experiencia 2.1

La actualización de Android completa la experiencia con tutor de primera visita, consejos contextuales, guía rápida, navegación resaltada a SO Reseller, alertas de Wallet y pagos, comparación de valor de Mobile Legends, ayuda contextual de recompensas y preparación de resumen para soporte. El seguimiento de pedidos y cupones se basa en los eventos del backend descritos arriba. Para la parte administrativa, se ofrecen recomendaciones sobre incidencias, operaciones de Wallet, devoluciones, pedidos detenidos y webhooks, siempre como diagnóstico de solo lectura. No se añadió voz.
