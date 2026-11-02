# SynthesisOne 2.2.2 — actualización de Game Market y SO Assistant

## Cambios

- El chat de SO Assistant reduce el encabezado y las acciones fijas para reservar más espacio a la conversación.
- El botón grande y poco claro de soporte se sustituye por tres accesos compactos y funcionales: WhatsApp, buzón de soporte y resumen preparado por la IA.
- Game Market añade el pago directo de una oferta individual con Saldo Móvil (CUBACEL), separado de Wallet.
- La compra directa exige que el teléfono pagador coincida con el teléfono registrado del cliente y que el receptor CUBACEL configurado esté supervisado por SMS Relay.
- El importe se toma de `price_saldo`, no se convierte a CUP y no se deposita ni se descuenta de Wallet.
- La conciliación comprueba moneda, red CUBACEL, cantidad exacta, teléfonos y ventana del ticket. Una notificación CUBACEL no puede liquidar un ticket CUP de Transfermóvil.
- El checkout externo se cierra de forma segura cuando falta la API key del proveedor de entrega.

## Orden obligatorio de despliegue

1. Realiza un respaldo reciente de Supabase.
2. Comprueba en Render que ya existen y son correctas las variables de producción `RECHARGEGAMES_API_KEY` y `STORE_WALLET_SALDO_RECEIVER_PHONE`. La segunda debe ser la línea receptora CUBACEL que ya utiliza la recarga de Wallet Saldo Móvil y debe estar vinculada a un cliente con SMS Relay activo. No publiques sus valores.
3. Ejecuta en el SQL Editor del proyecto Supabase de producción el archivo `supabase/migrations/036_gamemarket_direct_cubacel_payments.sql`. La migración comprueba duplicados de SMS antes de crear el índice único; si detecta duplicados, aborta la transacción para que se revisen antes de continuar.
4. Despliega el backend 2.2.2 en Render.
5. Comprueba los logs de arranque y realiza primero una prueba controlada con una cuenta de prueba y un importe pequeño. Verifica que el ticket queda pagado una sola vez y que el pedido llega al proveedor.
6. Compila y distribuye la nueva APK Android. Esta versión es necesaria para ver la nueva opción de pago y el chat compacto.

## Requisitos del pago directo CUBACEL

- Solo se ofrece para ofertas individuales de Game Market con un `price_saldo` válido.
- El móvil pagador que introduce el cliente debe coincidir con `clients.phone_number` de su sesión. Para la conciliación automática, el SMS de transferencia debe llegar al registro SMS asociado a ese cliente.
- El número receptor se obtiene de `STORE_WALLET_SALDO_RECEIVER_PHONE` y debe corresponder a una línea registrada en el sistema de clientes, que es la línea que ya se utiliza para los cobros de Saldo Móvil de Wallet.
- Se debe recibir un SMS CUBACEL verificable en el teléfono pagador (ENVIADO) o en el teléfono receptor (RECIBIDO), siempre que el registro de ese SMS esté disponible para el reconciliador. El backend verifica importe exacto, ambos teléfonos y la ventana del ticket.
- Si falta alguna prueba o hay ambigüedad con otro ticket/recarga de Wallet, el sistema no asigna el pago automáticamente.
- Los pagos directos no generan movimientos en Wallet. Las reglas promocionales existentes que excluyen Saldo Móvil siguen aplicándose.
- El carrito y las compras ETECSA no cambian en esta actualización.

## Verificación de esta entrega

- `node --test` con Android fuente montado: 233 pruebas, 233 aprobadas, 0 omitidas y 0 fallos. De forma aislada, el backend ejecuta 233 pruebas: 216 aprobadas y 17 omitidas porque necesitan la carpeta Android hermana; 0 fallos.
- `node --check` en los archivos JavaScript de `src/` y `test/`: correcto.
- La compilación Android no pudo ejecutarse en este entorno porque falta el Gradle Wrapper completo y el entorno no pudo descargar Gradle desde su distribución oficial. La APK todavía debe compilarse en GitHub Actions o en un entorno Android con Gradle disponible.
- No se ejecutó una transferencia real CUBACEL ni se aplicó la migración a la base de datos de producción. No desplegar hasta completar los pasos anteriores.
