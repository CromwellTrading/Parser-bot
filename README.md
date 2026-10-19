# SynthesisOne — backend de producción

Backend Node.js/Express para el relay de SMS, activación de licencias, operaciones ETECSA/Soky, Game Market/RechargeGames, Wallet, SO Reseller y webhooks. La APK no debe conectarse directamente a tablas de Supabase ni contener claves de proveedores.

## Qué se integra

- `GET /healthz`: confirma que el proceso HTTP está vivo.
- `GET /readyz`: comprueba conexión con Supabase sin devolver detalles internos.
- `/api/etecsa`: catálogo real de Soky, órdenes, consulta de estado, cancelación, recepción de destinatario y webhook.
- `/api/game-market`: catálogo publicado, precios administrados en base de datos, perfiles, solicitudes SO Reseller y operaciones administrativas.
- `/api/game-recharges`: órdenes de RechargeGames, consulta/estado y webhook firmado.
- `/api/store`: Wallet, tickets de depósito, compras Game Market con Wallet, historial y avisos reales publicados por administración.
- `/api/store-session`: alta de sesión de tienda, protegida por límite de intentos por IP.
- Workers de catálogo y órdenes ETECSA/Game Market, reconciliación de SMS y vigilancia operativa se arrancan desde `src/index.js`.

## Requisitos

- Node.js 18 o posterior (se usa `fetch` nativo y `AbortSignal.timeout`).
- Una instancia de Supabase con las tablas base del proyecto y las migraciones de este repositorio aplicadas.
- Un servicio HTTPS para publicar los webhooks.

Instalación local/de servidor:

```bash
npm ci
npm test
npm start
```

## Variables de entorno

Configúralas en Render/tu gestor de secretos; no las incluyas en Git, ZIP público ni APK. El archivo `.env` local está excluido del repositorio.

**Obligatorias para iniciar el backend actual**

- `SUPABASE_URL`: URL del proyecto.
- `SUPABASE_SERVICE_KEY`: clave `service_role`, solo en el servidor. Es una credencial privilegiada.
- `TELEGRAM_BOT_TOKEN`: token del bot operativo.

**Necesarias para alertas/admin por Telegram**

- `ADMIN_TELEGRAM_IDS`: IDs numéricos de administradores, separados por comas. Ya no hay IDs personales predefinidos. Si se omite, nadie queda incluido en la lista autorizada para comandos/alertas administrativas.

**Catálogo/entrega ETECSA**

- `SOKY_APP_TOKEN`: clave real de SokyRecargas.
- `SOKY_WEBHOOK_SECRET`: secreto de firma; debe coincidir con la configuración de webhook.
- En Supabase, `synthesisone_settings` debe tener la configuración `etecsa_pricing` que administra el panel. Sin tasa válida no se fabrican precios.
- Webhook del backend: `https://TU_HOST/api/etecsa/webhook` (usa el mismo secreto y el mecanismo de firma documentado por Soky).

**Game Market / RechargeGames**

- `RECHARGEGAMES_API_KEY`: clave real de reseller; sin ella no hay actualización ni compra real.
- `RECHARGEGAMES_WEBHOOK_SECRET`: secreto configurado en el panel del proveedor.
- Webhook del backend: `https://TU_HOST/api/game-recharges/webhook`.
- Supabase debe tener los precios `game_market_pricing:normal` y `game_market_pricing:reseller`. La migración 023 copia la regla ya persistida de `game_market_pricing:synthesisone` si faltan las dos claves; no inventa otra tasa. Después deben revisarse ambas tasas desde la administración. El catálogo muestra CUP y Saldo Móvil como precios distintos. Transfermóvil directo solo cobra CUP; Wallet permite elegir por separado `price_cup` (Wallet CUP) o `price_saldo` (Wallet Saldo Móvil), sin conversión entre libros.

**Administración/seguridad adicional**

- `PANEL_ADMIN_PASSWORD`: contraseña del panel de administración. `ADMIN_SECRET` solo se mantiene por compatibilidad; prioriza `PANEL_ADMIN_PASSWORD`.
- `ACTIVATION_SECRET_ENCRYPTION_KEY`: clave estable recomendada para cifrar secretos de activación. El sistema deriva una clave AES-256-GCM a partir de ella. No la cambies después de guardar secretos cifrados, salvo que migres/re-cifres esos datos; si no se define, el código usa `SUPABASE_SERVICE_KEY` como alternativa.
- `LICENSE_PRICE_AMOUNT`, `LICENSE_RENEWAL_PRICE_AMOUNT`, `LICENSE_PRICE_CURRENCY`, `LICENSE_PAYMENT_CARD`, `LICENSE_PAYMENT_PHONE`, `LICENSE_DURATION_DAYS`: importes y destino para el flujo de licencias. Verifica que coincidan con los datos bancarios reales antes de aceptar pagos.
- `PORT` lo aporta normalmente la plataforma. `RENDER_EXTERNAL_URL` activa el keep-alive ligero y es usada para formar callbacks HTTPS cuando está configurada.

Las variables opcionales de timeout, reintentos, expiración de sesión y vigilancia operativa tienen valores conservadores en código; revisa `src/utils/*` antes de cambiar sus unidades.

## Migraciones de Supabase

Aplica los SQL del proyecto en orden de dependencia en **el mismo** proyecto de Supabase usado por el backend. Este paquete incluye scripts con prefijos duplicados (`007`, `009`, `010`) de etapas distintas: no deduzcas que dos archivos con el mismo prefijo son intercambiables ni omitas el contenido de uno sin revisar sus tablas/columnas.

Comprueba también las dependencias de catálogo y checkout antes de llegar a Wallet: `011_etecsa_catalog_and_pricing.sql` (tarifas/caché ETECSA), `012_etecsa_order_tickets.sql` (tickets ETECSA), `013_rechargegames_provider_and_orders.sql` (proveedor y órdenes de juegos), `014_rechargegames_thumbnails.sql` (miniaturas), `015` de almacenamiento/galería si corresponde y `016_free_store_sessions.sql` (si el despliegue usa sesión gratuita de tienda). Los nombres pueden variar ligeramente en etapas antiguas; contrasta el contenido exacto, no solo el número.

En particular:

1. Las migraciones `017_store_wallet_history_favorites.sql` y `018_wallet_payment_reliability.sql` crean la base de Wallet e idempotencia.
2. `019_ops_incidents_announcements.sql` crea las incidencias operativas y los avisos.
3. `020_game_wallet_refund_reliability.sql` corrige las devoluciones. Ahora crea la tabla `service_incidents` de forma defensiva si falta, para evitar el error previo `relation public.service_incidents does not exist`; sigue siendo necesario aplicar 019 para instalar sus funciones y el panel de incidencias.
4. `021_backend_only_rls_hardening.sql` activa y fuerza RLS en las tablas privadas existentes, retira privilegios a `PUBLIC`, `anon` y `authenticated`, y concede los privilegios necesarios a `service_role`.
5. `022_reseller_wallet_payment_review.sql` añade el estado auditable del depósito y de la aprobación manual.
6. `023_game_market_pricing_configuration.sql` recupera claves de precios ya persistidas cuando falten y elimina únicamente juegos-placeholder conocidos que no tienen correspondencia del proveedor y no tienen ninguna oferta adjunta.
7. `024_dual_currency_wallet.sql` añade los saldos y libros independientes CUP/Saldo Móvil, depósitos CUBACEL verificados por SMS, débitos de Game Market en la moneda elegida y reembolsos en esa misma moneda. Es la última migración requerida para activar la nueva Wallet doble.

Las migraciones 021–024 forman parte del código, **pero no se han aplicado automáticamente a tu base de datos** desde este entorno. Ejecutarlas requiere acceso al proyecto real. Comprueba qué falta en el proyecto Supabase conectado a Render y aplica solo las pendientes, en orden. Haz respaldo antes de aplicar SQL en producción y confirma cada resultado sin ignorar errores intermedios.

## Wallet CUP + Saldo Móvil

- `GET /api/store/wallet` devuelve `balance_cup`, `balance_saldo`, totales independientes y el estado de integridad de ambos libros.
- `POST /api/store/wallet/topups` acepta `currency: "CUP"` con `amount_cup`, o `currency: "SALDO"` con `amount_saldo`. Ambos requieren `payer_phone`; ninguna moneda se acredita por crear el ticket.
- CUP concilia recibos de Transfermóvil contra tarjeta, importe, móvil y ventana del ticket. Saldo Móvil concilia SMS CUBACEL `RECIBIDO` en el teléfono receptor configurado o `ENVIADO` en el teléfono del pagador, con importe, ambas líneas y ventana temporal exactos.
- Para habilitar los depósitos SALDO, configura `STORE_WALLET_SALDO_RECEIVER_PHONE` en Render con el teléfono CUBACEL receptor de 8 dígitos. Ese teléfono debe existir en `clients` y estar supervisado por la APK SMS Relay conectada al mismo backend. Si no puede comprobarse, el backend no permite crear tickets de Saldo Móvil.
- Los pedidos Game Market con Wallet envían `price_basis: "CUP"` o `"SALDO"`; la RPC SQL descuenta solo ese saldo y rechaza compras cuando cualquiera de los libros no cuadra. Una devolución por fallo vuelve a la misma moneda.
- `STORE_WALLET_MIN_TOPUP_SALDO`/`STORE_WALLET_MAX_TOPUP_SALDO` permiten cambiar los límites de depósito SALDO (por defecto 100–1.000.000); existen los equivalentes `_CUP`.

## Depósitos SO Reseller

Cuando un ticket de Wallet CUP queda confirmado por la reconciliación del SMS/Transfermóvil, el backend revisa si pertenece a una solicitud con KYC aprobado y si el importe cubre el mínimo configurado (por defecto 50.000 CUP). Un depósito Saldo Móvil no cumple ese mínimo ni se convierte a CUP. De ser así:

1. Marca `PAYMENT_DETECTED_PENDING_ADMIN` y relaciona el ticket/transacción con la solicitud.
2. Envía alerta a los IDs configurados en `ADMIN_TELEGRAM_IDS`.
3. La APK informa al cliente que el depósito fue detectado pero que todavía no tiene precios reseller.
4. Solo el endpoint administrativo puede pasar la solicitud a `APPROVED`/`active`, con revisión identificada, y ahora exige un depósito elegible previamente detectado.

Esta función no identifica un depósito solo por ver un SMS de importe coincidente: primero el reconciliador valida los datos contra el ticket Wallet y reclama la transacción para evitar doble uso. La verificación humana final sigue siendo obligatoria.

## Servidores de juegos

El catálogo/órdenes usa los productos, regiones, precios y `product_key` devueltos por RechargeGames. Su documentación define `server_id` como obligatorio para Mobile Legends, pero el catálogo documentado no ofrece un endpoint verificable para enumerar servidores. La APK pide el ID/zona exacto al jugador y lo envía con la orden; no se carga una lista inventada. Si RechargeGames habilita un endpoint oficial de servidores, puede integrarse sin hardcodear IDs.

## Verificación y límites

- `npm test` ejecuta pruebas unitarias y comprobaciones de los puntos de integración de este paquete.
- Antes de publicar un release de Android, compila el proyecto con Gradle y prueba los flujos contra un entorno de proveedor/Supabase de prueba.
- Las pruebas locales no prueban credenciales ni datos reales de proveedores. Sin `SOKY_APP_TOKEN`, `RECHARGEGAMES_API_KEY` y credenciales de Supabase no se puede certificar una recarga real, el contenido actual del catálogo ni el estado RLS del proyecto desplegado.
- Las limitaciones por IP incluidas en el backend son por proceso. Si Render usa varias instancias, refuérzalas también en el gateway/CDN con un limitador compartido.


## RechargeGames API contract notes (October 2026)

- Orders use the exact `product_key` returned by `GET /v1/products?all=true`, a stable `buyer_ref`, the canonical region slug, and the player/server IDs. The integration never sends `test: true` for customer purchases. A product key longer than the provider's documented 300-character limit is rejected/skipped rather than truncated.
- Provider statuses are `pending`, `delivered`, and `failed`. Pending orders are reconciled every 60 seconds; creation retries reuse the same `buyer_ref`. Webhooks use the provider's Standard Webhooks HMAC headers and raw request body.
- Authenticated store clients can call `POST /api/game-recharges/region-check` with `{ game, uid, region }`. The backend calls the provider's documented keyless `GET /v1/region-check`, validates inputs and rate-limits checks. This verifies region for supported game IDs; it is not a server-ID directory.
- Admin-only `GET /api/game-recharges/admin/provider-balance` reports the wholesale prepaid balance in USDT without returning the private provider ledger. Provider funding/deposits are separate from customer CUP Wallet operations.
