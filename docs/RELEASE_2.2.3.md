# SynthesisOne 2.2.3 — SO Assistant y regiones de Game Market

## Correcciones

1. **SO Assistant Android:** las dos acciones rápidas y el botón de diagnóstico administrativo ya no heredan el padding vertical de 16 dp del botón genérico. Con altura de 34 dp, ese padding dejaba prácticamente cero espacio para el texto y hacía que parecieran barras vacías.
2. **Región RechargeGames:** el `product_key` conserva la clave original del catálogo, pero la propiedad `region` usa la forma canónica que figura en la documentación de la API: `LATAM`, `Brazil`, `EU`, `MENA`, etc.
3. **Verificación de UID:** la app envía el nombre de región del catálogo al backend; el backend normaliza slugs y etiquetas antes de consultar `/v1/region-check`.
4. **Falsos positivos:** `UID_NOT_FOUND` se trata como verificación inconclusa, no como mismatch definitivo; tanto ese caso como `WRONG_REGION` exigen confirmación explícita para continuar.

## Compatibilidad y despliegue

- Android requiere actualizar la APK para que aparezcan los textos corregidos y el nuevo flujo de confirmación.
- Backend debe desplegarse junto con Android para que `region-check` y el envío de pedidos empleen la misma normalización.
- No hay migración SQL nueva.
- No se cambian métodos de pago, Wallet, licencias, ETECSA, recompensas o webhooks.

## Verificación local

- `npm test`: 238 pruebas aprobadas, 0 fallidas, 0 omitidas en un entorno donde `SMS-relay-main` está al lado de `Parser-bot-main`.
- No se pudo ejecutar `:app:assembleDebug` en este entorno porque DNS no pudo resolver `services.gradle.org`; se requiere compilar en GitHub Actions o en un entorno Android con Gradle/SDK disponibles.
- La comprobación HTTP en vivo contra el verificador no se pudo ejecutar desde este entorno por el mismo bloqueo de DNS. Las pruebas usan respuestas simuladas del contrato del proveedor.
