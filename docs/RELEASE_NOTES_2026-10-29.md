# Cambios consolidados del backend — 2026-10-29

## Funciones conservadas

- Códigos de referencia múltiples y cupones según el esquema 032 del proyecto.
- Documentación de integración del webhook personal en `docs/CLIENT_WEBHOOK_API.md`.
- Doce estilos y ocho paletas permitidos por el backend.
- Rutas de tiendas, Wallet CUP/Saldo Móvil, licencia, pagos, reconciliación, catálogo ETECSA/Game Market y operaciones administrativas desde el ZIP base aportado.

## Optimización de tráfico

- Intervalo de monitorización operativa predeterminado de cinco minutos y deduplicación de incidencias activas.
- Firma del catálogo RechargeGames para evitar escrituras masivas cuando no hay cambios relevantes; lotes de upsert de ofertas más grandes.
- Registro del tamaño recibido del proveedor y estimación del payload escrito para apoyar la comparación de métricas.
- Caché positiva y negativa de miniaturas.
- Conciliación de SMS limitada a los clientes que tienen tickets de pago elegibles.
- La migración nueva es `supabase/migrations/033_payment_sms_reconciliation_scope.sql`. La migración 032 existente corresponde a funciones distintas y se mantiene intacta.

## Comprobaciones

- `npm test`: 198 tests, 187 pasaron, 0 fallaron y 11 se omitieron.
- `node --check` para todos los archivos JavaScript: correcto.
- Sin despliegue real de Render ni ejecución de SQL de producción en esta sesión.

## Instalación segura

1. Respaldar el backend y Supabase.
2. Comparar con el repositorio conectado a Render antes de reemplazar archivos.
3. Aplicar la migración 033 en la instancia correcta si aún no existe la función RPC.
4. Ejecutar `npm test`; desplegar solo con 0 fallos.
5. Verificar salud, reconciliación, compras, pagos y reembolsos; medir el tráfico posterior antes de atribuir ahorro.
