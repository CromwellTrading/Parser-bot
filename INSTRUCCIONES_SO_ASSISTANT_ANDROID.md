# SynthesisOne SO — Asistente IA (Android)

La interfaz del asistente está conectada desde el botón «ASISTENTE IA» del panel principal. Mantiene el historial solo en memoria durante la sesión de la app y se comunica con el backend autenticado por `GET /api/assistant/config` y `POST /api/assistant/chat`.

No requiere una clave de GroqCloud ni seleccionar un modelo en Android. La clave y los modelos se configuran exclusivamente en Render. La APK envía el token de sesión y el identificador del dispositivo; no contiene claves de IA.

Para publicar: utiliza la misma clave de firma de la app, incrementa `versionCode` y ejecuta el workflow habitual de GitHub Actions para `assembleRelease`. La comprobación local de Gradle no pudo descargar Gradle 8.1.1 por falta de resolución DNS de `services.gradle.org`; el chequeo sintáctico de Kotlin no encontró errores de parsing, pero no sustituye la compilación de Android.


## SO Assistant proactivo (actualización 2.0)

- El acceso flotante se muestra en el dashboard y puede ocultarse desde Ajustes → Privacidad y seguridad → SO Assistant flotante.
- Las advertencias de seguridad de transferencias no se silencian con ese interruptor. Si no puede confirmarse la automatización, la app evita continuar al formulario de pago y muestra el contacto oficial de soporte `+53 59190241`.
- El comparador Mobile Legends solo evalúa ofertas activas/disponibles de la región seleccionada cuya cantidad de diamantes pueda identificarse de forma explícita en los datos del catálogo. No modifica la oferta seleccionada ni el precio.
- La guía de SO Reseller lleva al usuario a Ajustes y resalta la tarjeta existente.


## SO Assistant proactivo (actualización 2.1)

- **Seguimiento contextual:** Android consulta `GET /api/assistant/insights` cada tres minutos mientras la actividad principal está abierta, hay sesión y existe conexión. El backend limita las lecturas recientes y devuelve avisos sin enviar el historial completo al modelo. Android guarda una lista local acotada de identificadores para no repetir el mismo aviso.
- **Pedidos y pagos:** puede avisar de pagos en revisión, datos pendientes, revisión de entrega/devolución, pedidos que siguen procesándose, tickets vencidos, entregas completadas y devoluciones registradas. No crea tickets, repite pagos ni modifica pedidos.
- **Recompensas:** detecta cupones recién disponibles, misiones de referidos próximas a completarse, códigos de referido cerca del siguiente cupón y oferta de bienvenida próxima a vencer. La aplicación usa la información oficial de recompensas; no recalcula ni cambia reglas comerciales.
- **Ayuda y soporte:** incluye tutor de primera visita, consejos contextuales, guía rápida, guía visual a SO Reseller y botón para preparar un resumen de pedidos/pagos/Wallet para soporte usando solo el contexto autenticado que el backend pueda consultar.
- **Wallet:** presenta un consejo de seguridad según la integridad del ledger. Las comprobaciones de saldo y disponibilidad siguen siendo responsabilidad del backend y de los endpoints existentes.
- **Administración:** el diagnóstico `GET /api/assistant/admin/insights` es de solo lectura y se autoriza por `role=admin` en el servidor. Los permisos de la interfaz Android no son una frontera de seguridad.
- **Sin voz:** esta entrega no añade grabación, micrófono, reconocimiento ni síntesis de voz y no solicita permisos nuevos.

Los avisos operativos de pedidos y recompensas son lecturas acotadas del backend y no descuentan la cuota del chat. El chat usa GroqCloud y sus cuotas. El saludo espontáneo, como máximo uno al día, puede solicitar una frase breve a GroqCloud sin contexto de cuenta; cuenta como una consulta. Si la API está ocupada o no hay cuota, Android muestra una frase local de respaldo.

### Endpoints nuevos de la capa proactiva

| Método y ruta | Acceso | Uso |
|---|---|---|
| `GET /api/assistant/insights` | Sesión de cliente válida y dispositivo enlazado cuando exista | Eventos del propio cliente; no expone IDs completos ni datos de pago. Lecturas recientes con límites. |
| `GET /api/assistant/admin/insights` | Sesión válida y rol `admin` comprobado en servidor | Indicadores agregados de servicio, base de datos, automatización, Wallet, pedidos e incidencias. Solo lectura. |

El sondeo Android se realiza cada 180 segundos cuando el dashboard está activo y el dispositivo está online. Si el endpoint no responde, la app no debe asumir que el servicio está disponible: no se habilita una transferencia por una respuesta de IA.

### Alcance completo de la asistencia 2.1

La capa proactiva también incluye avisos de revisión de pago, demora de pedido, vencimiento de ticket, entrega completada, devolución, cupón recién emitido y misiones/recompensas próximas. En el chat se puede pedir un resumen de cuenta para preparar una consulta a soporte. El diagnóstico admin es de lectura y solo aparece para roles autorizados en el servidor. El sondeo proactivo ocurre mientras el dashboard está abierto, hay sesión y conectividad; no es push y no se garantiza con la app cerrada.

La IA orienta al usuario y prepara resúmenes. No realiza pagos, reembolsos, cambios de saldo, modificaciones de pedidos ni aprobaciones. Se excluye asistencia por voz.


## SO Assistant 2.2 — avatar expresivo y GroqCloud

- El avatar `app/src/main/res/drawable-nodpi/so_assistant_avatar.jpg` aparece en la cabecera del chat y junto a cada respuesta del asistente. También se reutiliza en el acceso flotante y los avisos contextuales.
- El backend devuelve `emotion`, `gesture` y `mood_text` junto a `reply`. Android valida esos valores y realiza animaciones breves de sonrisa, guiño, pensamiento, saludo, asentimiento, alerta, celebración, inclinación, sorpresa gestual, encogimiento de hombros, rebote, suspiro, timidez y asomarse.
- La personalidad tiene más libertad para variar el tono, bromear con tacto, mostrar curiosidad, sorpresa, timidez de personaje, orgullo por logros confirmados y picardía. No simula ser humana, no inventa recuerdos ni ejerce presión emocional.
- La personalidad espontánea está activada por defecto y puede desactivarse en Ajustes. Como máximo se intenta una intervención generada por IA por día por cliente, solo en Inicio después de un retraso aleatorio y cuando no hay otra alerta ni el chat abierto. Se envía sin datos de cuenta y usa una consulta normal de la cuota. Si Groq no responde rápidamente, se utiliza un mensaje local y no se bloquea la interfaz.
- No se generan mensajes push ni mensajes con la app cerrada. La espontaneidad se produce mientras el dashboard está abierto y el usuario está autenticado.
- No se añaden permisos de micrófono, grabación ni voz.

### Publicación

La workflow Android genera el wrapper JAR oficial de Gradle 8.1.1 si no está en el ZIP, comprueba su SHA-256 oficial y después ejecuta la compilación. Ejecuta `workflow_dispatch` en GitHub Actions y revisa que la APK release esté firmada antes de distribuirla.
