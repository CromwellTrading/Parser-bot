/**
 * Parser de SMS de PAGOxMOVIL / Transfermóvil
 * Basado en el parser Flask original, portado a Node.js
 */

function removeAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizePhone(phone) {
  if (!phone) return null
  const clean = phone.replace(/\D/g, '')
  // Quitar prefijo 53 de Cuba si tiene 10 dígitos
  if (clean.length === 10 && clean.startsWith('53')) return clean.slice(2)
  return clean
}

/**
 * Parsea SMS de PAGOxMOVIL y detecta el tipo de transferencia
 */
function parseSms(sender, body) {
  const clean = removeAccents(body)
  const upper = clean.toUpperCase()

  // ── 1. RECIBIDO: Tarjeta → Tarjeta (con remitente visible) ───────────────
  // "El titular del telefono XXXX le ha realizado una transferencia a la cuenta YYYY de ZZZ CUP"
  if (upper.includes('EL TITULAR DEL TELEFONO') && upper.includes('A LA CUENTA') && !upper.includes('AL MONEDERO')) {
    const phoneMatch = clean.match(/El titular del telefono\s+(\d+)/i)
    const accountMatch = clean.match(/a la cuenta[:\s]+([\dX]+)/i)
    const amountMatch = clean.match(/de\s+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/(?:Nro\.?\s*Transaccion|Transaccion)[:\s]+(\w+)/i)
    const dateMatch = clean.match(/Fecha[:\s]+(\d+\/\d+\/\d+)/i)

    // Detectar si la cuenta tiene X (monedero→tarjeta) o no (tarjeta→tarjeta)
    const account = accountMatch ? accountMatch[1] : null
    const isMasked = account && account.includes('X')

    return {
      direction: 'RECIBIDO',
      type: isMasked ? 'MONEDERO_TARJETA' : 'TARJETA_TARJETA',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      sender_phone: phoneMatch ? normalizePhone(phoneMatch[1]) : null,
      receiver_account: account,
      transaction_id: txMatch ? txMatch[1] : null,
      date: dateMatch ? dateMatch[1] : null,
      raw: body
    }
  }

  // ── 2. RECIBIDO: Monedero → Monedero ─────────────────────────────────────
  // "El titular del telefono XXXX le ha realizado una transferencia al Monedero MiTransfer YYYY de ZZZ CUP"
  if (upper.includes('EL TITULAR DEL TELEFONO') && upper.includes('AL MONEDERO')) {
    const phoneMatch = clean.match(/El titular del telefono\s+(\d+)/i)
    const walletMatch = clean.match(/Monedero MiTransfer\s+(\d+)/i)
    const amountMatch = clean.match(/de\s+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/(?:Nro\.?\s*Transaccion|Transaccion)[:\s]+(\w+)/i)
    const dateMatch = clean.match(/Fecha[:\s]+(\d+\/\d+\/\d+)/i)

    return {
      direction: 'RECIBIDO',
      type: 'MONEDERO_MONEDERO',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      sender_phone: phoneMatch ? normalizePhone(phoneMatch[1]) : null,
      receiver_wallet: walletMatch ? walletMatch[1] : null,
      transaction_id: txMatch ? txMatch[1] : null,
      date: dateMatch ? dateMatch[1] : null,
      raw: body
    }
  }

  // ── 3. RECIBIDO: Tarjeta → Monedero ──────────────────────────────────────
  // "Monedero MiTransfer: Su monedero CUP ha sido recargado con: X CUP"
  // "Banco Bandec: La recarga de la cuenta CUP se realizo con exito. movil del monedero recargado:XXXX"
  if (upper.includes('RECARGADO CON') || upper.includes('RECARGA DE LA CUENTA')) {
    const amountMatch = clean.match(/(?:recargado con|Importe Recargado)[:\s]+([\d.]+)\s*CUP/i)
    const walletMatch = clean.match(/(?:monedero recargado|movil del monedero recargado)[:\s]+(\d+)/i)
    const txIdMatch = clean.match(/(?:Id Transaccion|Id Monedero)[:\s]+(\w+)/i)
    const txMatch = clean.match(/(?:Id Transaccion)[:\s]+(\w+)/i)
    const balanceMatch = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)

    return {
      direction: 'RECIBIDO',
      type: 'TARJETA_MONEDERO',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      sender_phone: null, // anónimo en este tipo
      receiver_wallet: walletMatch ? walletMatch[1] : null,
      transaction_id: txMatch ? txMatch[1] : (txIdMatch ? txIdMatch[1] : null),
      balance_after: balanceMatch ? parseFloat(balanceMatch[1]) : null,
      raw: body,
      note: 'ANONIMO — verificar por ID de transaccion'
    }
  }

  // ── 4. ENVIADO: Monedero → Monedero ──────────────────────────────────────
  // "Monedero Mi Transfer: La Transferencia fue completada. Beneficiario: XXXX Ordenante: YYYY Monto: ZZZ CUP"
  if (upper.includes('LA TRANSFERENCIA FUE COMPLETADA') && upper.includes('ORDENANTE')) {
    const benefMatch = clean.match(/Beneficiario[:\s]+(\d+)/i)
    const ordenMatch = clean.match(/Ordenante[:\s]+(\d+)/i)
    const amountMatch = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/(?:Nro\.?\s*Transaccion)[:\s]+(\w+)/i)
    const commMatch = clean.match(/comision de\s+([\d.]+)\s*CUP/i)
    const balanceMatch = clean.match(/Saldo restante[:\s]+([\d.]+)\s*CUP/i)
    const dateMatch = clean.match(/Fecha[:\s]+(\d+\/\d+\/\d+)/i)

    return {
      direction: 'ENVIADO',
      type: 'MONEDERO_MONEDERO',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      sender_phone: ordenMatch ? normalizePhone(ordenMatch[1]) : null,
      receiver_phone: benefMatch ? normalizePhone(benefMatch[1]) : null,
      transaction_id: txMatch ? txMatch[1] : null,
      commission: commMatch ? parseFloat(commMatch[1]) : null,
      balance_after: balanceMatch ? parseFloat(balanceMatch[1]) : null,
      date: dateMatch ? dateMatch[1] : null,
      raw: body
    }
  }

  // ── 5. ENVIADO: Monedero → Tarjeta ───────────────────────────────────────
  // "Monedero Mi Transfer: La Transferencia fue completada. Beneficiario: 9227XXXXXXXX8054 Monto: X CUP"
  if (upper.includes('LA TRANSFERENCIA FUE COMPLETADA') && upper.includes('BENEFICIARIO') && !upper.includes('ORDENANTE')) {
    const benefMatch = clean.match(/Beneficiario[:\s]+([\dX]+)/i)
    const amountMatch = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/(?:Nro\.?\s*Transaccion)[:\s]+(\w+)/i)
    const commMatch = clean.match(/comision de\s+([\d.]+)\s*CUP/i)
    const cupBalMatch = clean.match(/Saldo cuenta CUP[:\s]+([\d.]+)/i)

    return {
      direction: 'ENVIADO',
      type: 'MONEDERO_TARJETA',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      receiver_account: benefMatch ? benefMatch[1] : null,
      transaction_id: txMatch ? txMatch[1] : null,
      commission: commMatch ? parseFloat(commMatch[1]) : null,
      balance_after: cupBalMatch ? parseFloat(cupBalMatch[1]) : null,
      raw: body
    }
  }

  // ── 6. ENVIADO: Tarjeta → Monedero (Banco Bandec) ────────────────────────
  // "Banco Bandec: La recarga de la cuenta CUP se realizo con exito. movil del monedero recargado:XXXX"
  if (upper.includes('BANCO BANDEC') && upper.includes('MOVIL DEL MONEDERO')) {
    const walletMatch = clean.match(/movil del monedero recargado[:\s]*(\d+)/i)
    const amountMatch = clean.match(/Importe Recargado[:\s]+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/Id Transaccion[:\s]+(\w+)/i)
    const balanceMatch = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)

    return {
      direction: 'ENVIADO',
      type: 'TARJETA_MONEDERO',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      receiver_wallet: walletMatch ? walletMatch[1] : null,
      transaction_id: txMatch ? txMatch[1] : null,
      balance_after: balanceMatch ? parseFloat(balanceMatch[1]) : null,
      raw: body
    }
  }

  // ── 7. ENVIADO: Tarjeta → Tarjeta (Banco Bandec) ─────────────────────────
  // "Banco Bandec: La Transferencia fue completada. Beneficiario: XXXX Monto: ZZZ CUP"
  if (upper.includes('BANCO BANDEC') && upper.includes('LA TRANSFERENCIA FUE COMPLETADA')) {
    const benefMatch = clean.match(/Beneficiario[:\s]+([\dX]+)/i)
    const amountMatch = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)
    const txMatch = clean.match(/(?:Nro\.?\s*Transaccion)[:\s]+(\w+)/i)
    const balanceMatch = clean.match(/Saldo restante[:\s]+(?:CR\s+)?([\d.]+)\s*CUP/i)
    const dateMatch = clean.match(/Fecha[:\s]+(\d+\/\d+\/\d+)/i)

    return {
      direction: 'ENVIADO',
      type: 'TARJETA_TARJETA',
      amount: amountMatch ? parseFloat(amountMatch[1]) : null,
      currency: 'CUP',
      receiver_account: benefMatch ? benefMatch[1] : null,
      transaction_id: txMatch ? txMatch[1] : null,
      balance_after: balanceMatch ? parseFloat(balanceMatch[1]) : null,
      date: dateMatch ? dateMatch[1] : null,
      raw: body
    }
  }

  // ── Sin coincidencia ──────────────────────────────────────────────────────
  return {
    direction: 'DESCONOCIDO',
    type: 'DESCONOCIDO',
    amount: null,
    currency: null,
    raw: body
  }
}

/**
 * Verifica si una tarjeta registrada (first4-last4) coincide con
 * la cuenta que aparece en el SMS (puede estar enmascarada o completa)
 */
function matchesCard(accountInSms, cardFirst4, cardLast4) {
  if (!accountInSms || !cardFirst4 || !cardLast4) return false
  const clean = accountInSms.replace(/X/g, '')
  return accountInSms.startsWith(cardFirst4) && accountInSms.endsWith(cardLast4)
}

module.exports = { parseSms, matchesCard, normalizePhone }
