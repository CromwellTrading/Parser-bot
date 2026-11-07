# 2.2.5 — SO Assistant con acciones

- `POST /api/assistant/chat` devuelve además `actions` (máx. 3) y `suggestions` (máx. 3).
- Acciones permitidas (lista cerrada, validada en `sanitizeAssistantActions`): `navigate`, `open_game`, `reseller_calc`.
- No existen acciones de pago, compra, saldo, reembolso ni aprobación; el modelo solo sugiere y el usuario toca.
- Sin migraciones ni variables nuevas. Pruebas: `node --test` (test/assistant-actions.test.js).
