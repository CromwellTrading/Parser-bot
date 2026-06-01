function removeAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizePhone(phone) {
  if (!phone) return null
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 10 && clean.startsWith('53')) return clean.slice(2)
  return clean
}

function parseSms(sender, body) {
  const clean = removeAccents(body)
  const upper = clean.toUpperCase()

  // ══════════════════════════════════════════════════════════════════
  // CUBACEL / ETECSA
  // ══════════════════════════════════════════════════════════════════

  // RECIBIDO: "Usted ha recibido X CUP del numero YYYY. Saldo principal Z..."
  if (upper.includes('USTED HA RECIBIDO') && upper.includes('DEL NUMERO')) {
    const amount  = body.match(/ha recibido\s+([\d.]+)\s*CUP/i)?.[1]
    const phone   = body.match(/del numero\s+(\d+)/i)?.[1]
    const balance = body.match(/Saldo principal\s+([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'RECIBIDO', type: 'CUBACEL', network: 'CUBACEL',
      amount: amount ? parseFloat(amount) : null,
      currency: 'CUP',
      sender_phone: normalizePhone(phone),
      receiver_phone: null, receiver_account: null,
      transaction_id: null,
      balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // ENVIADO: "Usted ha transferido X CUP al numero YYYY. Saldo principal Z..."
  if (upper.includes('USTED HA TRANSFERIDO') && upper.includes('AL NUMERO')) {
    const amount  = body.match(/ha transferido\s+([\d.]+)\s*CUP/i)?.[1]
    const phone   = body.match(/al numero\s+(\d+)/i)?.[1]
    const balance = body.match(/Saldo principal\s+([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'ENVIADO', type: 'CUBACEL', network: 'CUBACEL',
      amount: amount ? parseFloat(amount) : null,
      currency: 'CUP',
      sender_phone: null,
      receiver_phone: normalizePhone(phone),
      receiver_account: null, transaction_id: null,
      balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PAGOxMOVIL / TRANSFERMOVIL
  // ══════════════════════════════════════════════════════════════════

  // 1. RECIBIDO: Tarjeta→Tarjeta o Monedero→Tarjeta
  if (upper.includes('EL TITULAR DEL TELEFONO') && upper.includes('A LA CUENTA') && !upper.includes('AL MONEDERO')) {
    const phone   = clean.match(/El titular del telefono\s+(\d+)/i)?.[1]
    const account = clean.match(/a la cuenta[:\s]+([\dX]+)/i)?.[1]
    const amount  = clean.match(/de\s+([\d.]+)\s*CUP/i)?.[1]
    const txId    = clean.match(/(?:Nro\.?\s*Transaccion|Transaccion)[:\s]+(\w+)/i)?.[1]
    const masked  = account?.includes('X')
    return {
      direction: 'RECIBIDO',
      type: masked ? 'MONEDERO_TARJETA' : 'TARJETA_TARJETA',
      network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: normalizePhone(phone), receiver_phone: null,
      receiver_account: account, transaction_id: txId,
      balance_after: null, raw: body
    }
  }

  // 2. RECIBIDO: Monedero→Monedero
  if (upper.includes('EL TITULAR DEL TELEFONO') && upper.includes('AL MONEDERO')) {
    const phone  = clean.match(/El titular del telefono\s+(\d+)/i)?.[1]
    const amount = clean.match(/de\s+([\d.]+)\s*CUP/i)?.[1]
    const txId   = clean.match(/(?:Nro\.?\s*Transaccion|Transaccion)[:\s]+(\w+)/i)?.[1]
    return {
      direction: 'RECIBIDO', type: 'MONEDERO_MONEDERO', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: normalizePhone(phone), receiver_phone: null,
      receiver_account: null, transaction_id: txId,
      balance_after: null, raw: body
    }
  }

  // 3. RECIBIDO: Tarjeta→Monedero (recarga desde tarjeta)
  if (upper.includes('RECARGADO CON') || (upper.includes('RECARGA DE LA CUENTA') && upper.includes('MONEDERO'))) {
    const amount  = clean.match(/(?:recargado con|Importe Recargado)[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const txId    = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1]
    const balance = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'RECIBIDO', type: 'TARJETA_MONEDERO', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: null, receiver_phone: null, receiver_account: null,
      transaction_id: txId, balance_after: balance ? parseFloat(balance) : null,
      note: 'Remitente anonimo — verificar por ID de transaccion',
      raw: body
    }
  }

  // 4. ENVIADO: Monedero→Monedero (Mi Transfer, con Ordenante)
  if (
    upper.includes('LA TRANSFERENCIA FUE COMPLETADA') &&
    upper.includes('ORDENANTE') &&
    upper.includes('BENEFICIARIO')
  ) {
    const amount    = clean.match(/Monto[:\s]+([\d.]+)/i)?.[1]
    const benef     = clean.match(/Beneficiario[:\s]+(\d+)/i)?.[1]
    const ordenante = clean.match(/Ordenante[:\s]+(\d+)/i)?.[1]
    const txId      = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1]
    const comision  = clean.match(/cobro de comision de\s+([\d.]+)\s*CUP/i)?.[1]
    const balance   = clean.match(/Saldo restante[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const totalGasto = (amount && comision)
      ? parseFloat(amount) + parseFloat(comision)
      : amount ? parseFloat(amount) : null
    return {
      direction: 'ENVIADO', type: 'MONEDERO_MONEDERO', network: 'PAGOMOVIL',
      amount: totalGasto, currency: 'CUP',
      sender_phone: normalizePhone(ordenante),
      receiver_phone: normalizePhone(benef),
      receiver_account: null, transaction_id: txId,
      commission: comision ? parseFloat(comision) : null,
      balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // 5. ENVIADO: Monedero→Tarjeta (Mi Transfer, sin Ordenante)
  if (
    upper.includes('LA TRANSFERENCIA FUE COMPLETADA') &&
    upper.includes('BENEFICIARIO') &&
    !upper.includes('ORDENANTE')
  ) {
    const amount     = clean.match(/Monto[:\s]+([\d.]+)/i)?.[1]
    const benef      = clean.match(/Beneficiario[:\s]+([\dX]+)/i)?.[1]
    const txId       = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1]
    const comision   = clean.match(/cobro de comision de\s+([\d.]+)\s*CUP/i)?.[1]
    const balanceCup = clean.match(/Saldo cuenta CUP[:\s]+([\d.]+)/i)?.[1]
    const balanceUsd = clean.match(/Saldo cuenta USD[:\s]+([\d.]+)/i)?.[1]
    const totalGasto = (amount && comision)
      ? parseFloat(amount) + parseFloat(comision)
      : amount ? parseFloat(amount) : null
    return {
      direction: 'ENVIADO', type: 'MONEDERO_TARJETA', network: 'PAGOMOVIL',
      amount: totalGasto, currency: 'CUP',
      sender_phone: null, receiver_phone: null, receiver_account: benef,
      transaction_id: txId,
      commission: comision ? parseFloat(comision) : null,
      balance_after: balanceCup ? parseFloat(balanceCup) : null,
      balance_usd_after: balanceUsd ? parseFloat(balanceUsd) : null,
      raw: body
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // BANCO BANDEC
  // ══════════════════════════════════════════════════════════════════

  // 6. ENVIADO: Tarjeta→Monedero (Bandec)
  if (upper.includes('BANCO BANDEC') && upper.includes('MOVIL DEL MONEDERO')) {
    const amount  = clean.match(/Importe Recargado[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const phone   = clean.match(/movil del monedero[:\s]+(\d+)/i)?.[1]
    const txId    = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1]
    const balance = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'ENVIADO', type: 'TARJETA_MONEDERO', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: null, receiver_phone: normalizePhone(phone),
      receiver_account: null, transaction_id: txId,
      balance_after: balance ? parseFloat(balance) : null, raw: body
    }
  }

  // 7. ENVIADO: Tarjeta→Tarjeta (Bandec)
  if (upper.includes('BANCO BANDEC') && upper.includes('LA TRANSFERENCIA FUE COMPLETADA')) {
    const amount  = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const benef   = clean.match(/Beneficiario[:\s]+([\dX]+)/i)?.[1]
    const txId    = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1]
    const balance = clean.match(/Saldo restante[:\s]+(?:CR\s+)?([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'ENVIADO', type: 'TARJETA_TARJETA', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: null, receiver_phone: null, receiver_account: benef,
      transaction_id: txId, balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // BANCO POPULAR DE AHORRO (BPA)
  // ══════════════════════════════════════════════════════════════════

  // 8. ENVIADO: Tarjeta→Monedero (BPA)
  if (upper.includes('BANCO POPULAR DE AHORRO') && upper.includes('MOVIL DEL MONEDERO')) {
    const amount  = clean.match(/Importe Recargado[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const phone   = clean.match(/movil del monedero[:\s]+(\d+)/i)?.[1]
    const txId    = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1]
    const idMon   = clean.match(/Id Monedero[:\s]+(\w+)/i)?.[1]
    const balance = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'ENVIADO', type: 'TARJETA_MONEDERO', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: null, receiver_phone: normalizePhone(phone),
      receiver_account: null,
      transaction_id: txId ?? idMon,
      balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // 9. ENVIADO: Tarjeta→Tarjeta (BPA)
  if (upper.includes('BANCO POPULAR DE AHORRO') && upper.includes('LA TRANSFERENCIA FUE COMPLETADA')) {
    const amount  = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1]
    const benef   = clean.match(/Beneficiario[:\s]+([\dX]+)/i)?.[1]
    const txId    = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1]
    const balance = clean.match(/Saldo restante[:\s]+(?:CR\s+)?([\d.]+)\s*CUP/i)?.[1]
    return {
      direction: 'ENVIADO', type: 'TARJETA_TARJETA', network: 'PAGOMOVIL',
      amount: amount ? parseFloat(amount) : null, currency: 'CUP',
      sender_phone: null, receiver_phone: null, receiver_account: benef,
      transaction_id: txId, balance_after: balance ? parseFloat(balance) : null,
      raw: body
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // DESCONOCIDO
  // ══════════════════════════════════════════════════════════════════
  return {
    direction: 'DESCONOCIDO', type: 'DESCONOCIDO', network: 'DESCONOCIDO',
    amount: null, currency: null, sender_phone: null,
    receiver_phone: null, receiver_account: null,
    transaction_id: null, balance_after: null, raw: body
  }
}

function matchesCard(accountInSms, cardFirst4, cardLast4) {
  if (!accountInSms || !cardFirst4 || !cardLast4) return false
  return accountInSms.startsWith(cardFirst4) && accountInSms.endsWith(cardLast4)
}

module.exports = { parseSms, matchesCard, normalizePhone }
