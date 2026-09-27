function buildWebhookPayload(client, parsed, sender, body, receivedIso, eventId, logId, messageId) {
  const isTransfer = ['RECIBIDO', 'ENVIADO'].includes(parsed?.direction) && parsed?.amount != null
  const { raw: _raw, ...parsedForWebhook } = parsed || {}

  // `amount` is the actual transfer amount used by SynthesisOne.
  // Any provider commission is not part of the merchant payment and is kept
  // only if the parser supplied it as informational metadata. No alternate
  // total/debited amount is generated.
  const transaction = {
    ...parsedForWebhook,
  }

  return {
    schema_version: '1.0',
    event: isTransfer ? 'TRANSFER_DETECTED' : 'SMS_RECEIVED',
    event_id: eventId,
    occurred_at: receivedIso,
    client: {
      id: client.id,
      name: client.name,
      phone_number: client.phone_number,
      expires_at: client.expires_at,
    },
    merchant_accounts: {
      card1: client.card1 || null,
      card2: client.card2 || null,
      card3: client.card3 || null,
      wallet: client.wallet || null,
    },
    sms: {
      sender,
      body,
      received_at: receivedIso,
      message_id: messageId,
      log_id: logId,
    },
    verification: {
      is_financial_transfer: isTransfer,
      has_amount: transaction.amount != null,
      has_currency: Boolean(transaction.currency),
      has_transaction_id: Boolean(transaction.transaction_id),
      has_destination_account: Boolean(transaction.receiver_account),
      has_destination_phone: Boolean(transaction.receiver_phone),
      has_counterparty_phone: Boolean(transaction.sender_phone),
    },
    transaction,
  }
}

module.exports = { buildWebhookPayload }
