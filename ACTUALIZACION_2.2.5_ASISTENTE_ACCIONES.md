# 2.2.5 — SO Assistant con acciones

- `POST /api/assistant/chat` devuelve además `actions` (máx. 3) y `suggestions` (máx. 3).
- Acciones permitidas (lista cerrada, validada en `sanitizeAssistantActions`): `navigate`, `open_game`, `reseller_calc`.
- No existen acciones de pago, compra, saldo, reembolso ni aprobación; el modelo solo sugiere y el usuario toca.
- Sin migraciones ni variables nuevas. Pruebas: `node --test` (test/assistant-actions.test.js).

## Game Market y pagos
- `GET /api/game-market/catalog?view=summary` y `/catalog/games/:id/offers` (y variantes `/admin/catalog`). Sin `view` devuelve el catálogo completo como antes (compatible con apps viejas).
- Corregido: `/api/etecsa` y `/api/game-recharges` (checkout config) mostraban tarjetas y números aunque la automatización estuviera apagada.
- Corregido: la sesión de activación de licencia ya enmascara una cuenta receptora retirada.
- Nuevo: `GET /api/system/payment-destinations/overview` (solo admin): qué cuentas reciben pagos y cuáles ven los clientes.
- El chat del asistente recibe el estado de pagos en vivo y avisa al cliente de no transferir si no hay cuentas activas.
