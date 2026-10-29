# SynthesisOne — Webhook API para clientes

**Versión del contrato:** `1.0`  
**Tipo de integración:** recepción de eventos HTTP  
**Transporte:** HTTPS  
**Método:** `POST`  
**Formato:** `application/json`

Esta guía describe el contrato que debe implementar un servicio receptor para aceptar los eventos enviados a la URL de webhook configurada para su cuenta. No requiere acceso a los componentes internos de SynthesisOne.

## 1. Requisitos del endpoint

El endpoint receptor debe:

- Publicarse en una URL HTTPS accesible desde Internet y contar con un certificado TLS válido.
- Aceptar solicitudes `POST` con `Content-Type: application/json`.
- Responder con un código HTTP `2xx` cuando el evento haya sido aceptado para procesamiento.
- Validar la firma del webhook antes de confiar en el cuerpo recibido.
- Registrar y deduplicar eventos mediante `event_id`.
- Procesar los campos opcionales de forma tolerante: un campo puede ser `null`, no aparecer o variar según el tipo de mensaje.

No se admiten destinos `localhost`, redes privadas ni direcciones internas. No incluyas credenciales en la URL (por ejemplo, `https://usuario:clave@host/`).

## 2. Tipos de evento

| `event` | Descripción |
|---|---|
| `TRANSFER_DETECTED` | El mensaje cumple los criterios del contrato para identificarse como una transferencia. |
| `SMS_RECEIVED` | Se recibió un mensaje que no cumple los criterios anteriores. |

El campo `verification.is_financial_transfer` indica la clasificación incluida en el payload. El receptor debe aplicar sus propios controles de negocio antes de ejecutar acciones irreversibles.

## 3. Encabezados HTTP

| Encabezado | Uso |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Event-Id` | Identificador del evento. Utilízalo como clave de idempotencia. |
| `X-Webhook-Timestamp` | Marca de tiempo Unix, en segundos. |
| `X-Webhook-Signature` | Firma HMAC-SHA256 hexadecimal del cuerpo JSON original. |
| `X-Webhook-Signature-V2` | Firma HMAC-SHA256 hexadecimal de `timestamp + "." + cuerpo JSON original`. |

### Verificación de firma

El secreto de webhook se entrega o configura de forma privada para la integración. Trátalo como una contraseña: no lo publiques, no lo incluyas en una aplicación de navegador y no lo escribas en logs.

Para verificar `X-Webhook-Signature-V2`:

1. Captura los bytes originales del cuerpo HTTP antes de parsear o reserializar el JSON.
2. Lee `X-Webhook-Timestamp` y `X-Webhook-Signature-V2`.
3. Calcula `HMAC-SHA256(secret, timestamp + "." + rawBody)` y codifica el resultado en hexadecimal minúsculo.
4. Compara la firma calculada con la recibida mediante una comparación en tiempo constante.
5. Rechaza timestamps fuera de la ventana de antigüedad que definas para tu servicio.

La firma compatible `X-Webhook-Signature` se calcula como `HMAC-SHA256(secret, rawBody)`. Se recomienda verificar la firma V2 porque incluye la marca temporal.

**Ejemplo de verificación en Node.js/Express:** instala la ruta antes de cualquier middleware que consuma el cuerpo, o configura tu middleware de captura de cuerpo original para preservar exactamente los bytes recibidos.

```js
const crypto = require('node:crypto');
const express = require('express');
const app = express();
const secret = process.env.SYNTHESISONE_WEBHOOK_SECRET;

app.post('/webhooks/synthesisone', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body; // Buffer original; no JSON.stringify(req.body)
  const timestamp = req.get('X-Webhook-Timestamp') || '';
  const supplied = req.get('X-Webhook-Signature-V2') || '';
  if (!secret || !Buffer.isBuffer(rawBody) || !timestamp || !/^[a-f0-9]{64}$/i.test(supplied)) {
    return res.sendStatus(401);
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    return res.sendStatus(401);
  }

  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
    .digest();
  const actual = Buffer.from(supplied, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.sendStatus(401);
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.sendStatus(400); }

  // En producción: validar esquema, deduplicar payload.event_id y encolar el trabajo.
  return res.sendStatus(204);
});
```

El límite de cinco minutos del ejemplo es una recomendación de implementación del receptor, no un parámetro enviado por el servicio. Ajusta la ventana a las condiciones de tu sistema y sincroniza el reloj del servidor.

## 4. Esquema del payload

El objeto tiene `schema_version`, `event`, `event_id`, `occurred_at`, `client`, `merchant_accounts`, `sms`, `verification` y `transaction`. Los campos internos de `transaction` dependen del mensaje y no deben asumirse todos obligatorios.

```json
{
  "schema_version": "1.0",
  "event": "TRANSFER_DETECTED",
  "event_id": "event-id-example",
  "occurred_at": "2026-10-29T12:30:00.000Z",
  "client": {
    "id": "client-id-example",
    "name": "Cuenta de ejemplo",
    "phone_number": "+5350000000",
    "expires_at": "2027-01-01T00:00:00.000Z"
  },
  "merchant_accounts": {
    "card1": "0000000000000000",
    "card2": null,
    "card3": null,
    "wallet": null
  },
  "sms": {
    "sender": "Remitente",
    "body": "Texto de ejemplo",
    "received_at": "2026-10-29T12:30:00.000Z",
    "message_id": "message-id-example",
    "log_id": "log-id-example"
  },
  "verification": {
    "is_financial_transfer": true,
    "has_amount": true,
    "has_currency": true,
    "has_transaction_id": true,
    "has_destination_account": true,
    "has_destination_phone": false,
    "has_counterparty_phone": true
  },
  "transaction": {
    "direction": "RECIBIDO",
    "amount": 2500,
    "currency": "CUP",
    "transaction_id": "transaction-id-example"
  }
}
```

Los valores son ilustrativos. No dependas de los identificadores del ejemplo ni asumas que `transaction` siempre tendrá únicamente esos campos.

### Campos de nivel superior

| Campo | Tipo | Descripción |
|---|---|---|
| `schema_version` | string | Versión del esquema del payload. |
| `event` | string | Tipo de evento. |
| `event_id` | string | Identificador estable usado para deduplicación. |
| `occurred_at` | string (ISO 8601) | Fecha y hora asociadas al evento. |
| `client` | object | Identificadores y datos asignados a la cuenta. |
| `merchant_accounts` | object | Cuentas receptoras configuradas; pueden ser `null`. |
| `sms` | object | Metadatos y texto del mensaje de origen. Contiene datos potencialmente sensibles. |
| `verification` | object | Indicadores de presencia/clasificación de campos. |
| `transaction` | object | Datos interpretados del mensaje; puede variar y contener campos opcionales. |

## 5. Respuestas, idempotencia y reintentos

- Devuelve `2xx` únicamente cuando el evento esté aceptado. `200 OK` y `204 No Content` son respuestas válidas.
- Un `4xx` no reintentable indica que la solicitud no fue aceptada. Un `408`, `429` o error `5xx` puede originar un reintento.
- Una misma operación puede entregarse más de una vez. Guarda `event_id` con una restricción única o un mecanismo equivalente antes de ejecutar efectos de negocio.
- No uses el orden de llegada como garantía de secuencia entre eventos diferentes.
- Mantén el endpoint rápido: valida, registra de forma durable y encola el procesamiento pesado.

## 6. Protección de datos

El objeto `sms` puede contener información privada. Limita el acceso a logs y registros, aplica retención mínima, cifra los datos almacenados según la sensibilidad del negocio y evita copiar payloads completos a herramientas de analítica o trazas públicas.

## 7. Lista de verificación para producción

- [ ] URL pública `https://` con certificado válido.
- [ ] Método `POST` y `Content-Type: application/json`.
- [ ] Captura de cuerpo original para verificar HMAC.
- [ ] Verificación de firma y antigüedad del timestamp.
- [ ] Deduplicación persistente por `event_id`.
- [ ] Respuesta `2xx` después de aceptar el evento.
- [ ] Tratamiento de campos opcionales y eventos desconocidos.
- [ ] Logs sin secretos ni cuerpos financieros completos.
- [ ] Prueba de aceptación con un evento real de la cuenta y revisión del resultado.
