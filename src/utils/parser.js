function removeAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizePhone(phone) {
  if (!phone) return null
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 10 && clean.startsWith('53')) return clean.slice(2)
  return clean
}

function parseSmsBase(sender, body) {
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

  // 4. ENVIADO: MiTransfer con Ordenante.
  // El beneficiario puede ser teléfono o tarjeta; la tarjeta puede venir completa o enmascarada.
  if (
    upper.includes('LA TRANSFERENCIA FUE COMPLETADA') &&
    upper.includes('ORDENANTE') &&
    upper.includes('BENEFICIARIO')
  ) {
    const amount    = clean.match(/Monto[:\s]+([\d.,]+)/i)?.[1]
    const benef     = clean.match(/Beneficiario[:\s]+([\dX\s]+)/i)?.[1]?.replace(/\s/g, '')
    const ordenante = clean.match(/Ordenante[:\s]+(\d+)/i)?.[1]
    const txId      = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1]
    const comision  = clean.match(/cobro de comision de\s+([\d.,]+)\s*CUP/i)?.[1]
    const balance   = clean.match(/Saldo restante[:\s]+([\d.,]+)\s*CUP/i)?.[1]
    const totalGasto = (amount && comision)
      ? parseFloat(amount.replace(',', '.')) + parseFloat(comision.replace(',', '.'))
      : amount ? parseFloat(amount.replace(',', '.')) : null
    const beneficiaryDigits = (benef || '').replace(/\D/g, '')
    const beneficiaryIsCard = Boolean(benef && (benef.includes('X') || beneficiaryDigits.length === 16))

    return beneficiaryIsCard
      ? {
          direction: 'ENVIADO', type: 'MONEDERO_TARJETA', network: 'PAGOMOVIL',
          amount: totalGasto, currency: 'CUP',
          sender_phone: normalizePhone(ordenante),
          receiver_phone: null,
          receiver_account: benef, transaction_id: txId,
          commission: comision ? parseFloat(comision.replace(',', '.')) : null,
          balance_after: balance ? parseFloat(balance.replace(',', '.')) : null,
          raw: body
        }
      : {
          direction: 'ENVIADO', type: 'MONEDERO_MONEDERO', network: 'PAGOMOVIL',
          amount: totalGasto, currency: 'CUP',
          sender_phone: normalizePhone(ordenante),
          receiver_phone: normalizePhone(benef),
          receiver_account: null, transaction_id: txId,
          commission: comision ? parseFloat(comision.replace(',', '.')) : null,
          balance_after: balance ? parseFloat(balance.replace(',', '.')) : null,
          raw: body
        }
  }

  // 5. ENVIADO: Monedero→Tarjeta (Mi Transfer, sin Ordenante)
if (
  upper.includes('MONEDERO MI TRANSFER') &&
  upper.includes('LA TRANSFERENCIA FUE COMPLETADA') &&
  upper.includes('BENEFICIARIO') &&
  !upper.includes('ORDENANTE')
) {
  const amount = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const benefMatch = clean.match(/Beneficiario[:\s]+([\dX\s]+)/i);
  const benef = benefMatch ? benefMatch[1].replace(/\s/g, '') : null;
  const txId = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1];
  const comision = clean.match(/cobro de comision de\s+([\d.]+)\s*CUP/i)?.[1];
  const balanceCup = clean.match(/Saldo cuenta CUP[:\s]+([\d.]+)/i)?.[1];
  const balanceUsd = clean.match(/Saldo cuenta USD[:\s]+([\d.]+)/i)?.[1];
  if (benef && (benef.includes('X') || benef.replace(/\D/g, '').length === 16)) {
    const totalGasto = (amount && comision)
      ? parseFloat(amount) + parseFloat(comision)
      : amount ? parseFloat(amount) : null;
    return {
      direction: 'ENVIADO', type: 'MONEDERO_TARJETA', network: 'PAGOMOVIL',
      amount: totalGasto, currency: 'CUP',
      sender_phone: null, receiver_phone: null, receiver_account: benef,
      transaction_id: txId,
      commission: comision ? parseFloat(comision) : null,
      balance_after: balanceCup ? parseFloat(balanceCup) : null,
      balance_usd_after: balanceUsd ? parseFloat(balanceUsd) : null,
      raw: body
    };
  }
}
  // 5.5 ENVIADO: Monedero→Monedero (Mi Transfer, sin Ordenante) - beneficiario es teléfono
if (
  upper.includes('MONEDERO MI TRANSFER') &&
  upper.includes('LA TRANSFERENCIA FUE COMPLETADA') &&
  upper.includes('BENEFICIARIO') &&
  !upper.includes('ORDENANTE')
) {
  const amount = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const benefMatch = clean.match(/Beneficiario[:\s]+([\d\s]+)/i);
  const benef = benefMatch ? benefMatch[1].replace(/\s/g, '') : null;
  const txId = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1];
  const comision = clean.match(/cobro de comision de\s+([\d.]+)\s*CUP/i)?.[1];
  const balance = clean.match(/Saldo restante[:\s]+([\d.]+)\s*CUP/i)?.[1];
  if (benef && !benef.includes('X') && benef.replace(/\D/g, '').length <= 11) {
    const totalGasto = (amount && comision)
      ? parseFloat(amount) + parseFloat(comision)
      : amount ? parseFloat(amount) : null;
    return {
      direction: 'ENVIADO', type: 'MONEDERO_MONEDERO', network: 'PAGOMOVIL',
      amount: totalGasto, currency: 'CUP',
      sender_phone: null,
      receiver_phone: normalizePhone(benef),
      receiver_account: null, transaction_id: txId,
      commission: comision ? parseFloat(comision) : null,
      balance_after: balance ? parseFloat(balance) : null,
      raw: body
    };
  }
}
  

  // ══════════════════════════════════════════════════════════════════
  // BANCO BANDEC
  // ══════════════════════════════════════════════════════════════════

  // 6. ENVIADO: Tarjeta→Monedero (Bandec)
if (upper.includes('BANCO BANDEC') && upper.includes('MOVIL DEL MONEDERO')) {
  const amount = clean.match(/Importe Recargado[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const phoneMatch = clean.match(/movil del monedero[:\s]+([\d\s]+)/i);
  const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : null;
  const txId = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1];
  const balance = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)?.[1];
  return {
    direction: 'ENVIADO', type: 'TARJETA_MONEDERO', network: 'PAGOMOVIL',
    amount: amount ? parseFloat(amount) : null, currency: 'CUP',
    sender_phone: null, receiver_phone: normalizePhone(phone),
    receiver_account: null, transaction_id: txId,
    balance_after: balance ? parseFloat(balance) : null,
    raw: body
  }
}

  // 7. ENVIADO: Tarjeta→Tarjeta (Bandec)
if (upper.includes('BANCO BANDEC') && upper.includes('LA TRANSFERENCIA FUE COMPLETADA')) {
  const amount = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const benefMatch = clean.match(/Beneficiario[:\s]+([\dX\s]+)/i);
  const benef = benefMatch ? benefMatch[1].replace(/\s/g, '') : null;
  const txId = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1];
  const balance = clean.match(/Saldo restante[:\s]+(?:CR\s+)?([\d.]+)\s*CUP/i)?.[1];
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
  const amount  = clean.match(/Importe Recargado[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const phoneMatch = clean.match(/movil del monedero recargado[:\s]+([\d\s]+)/i);
  const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : null;
  const txId    = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1];
  const idMon   = clean.match(/Id Monedero[:\s]+(\w+)/i)?.[1];
  const balance = clean.match(/Saldo Restante[:\s]+([\d.]+)\s*CUP/i)?.[1];
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

  // 8.5 RECIBIDO: Recarga a monedero MiTransfer desde tarjeta
if (upper.includes('MONEDERO MITRANSFER') && upper.includes('SU MONEDERO CUP HA SIDO RECARGADO CON')) {
  const amount = clean.match(/recargado con[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const txId   = clean.match(/Id Transaccion[:\s]+(\w+)/i)?.[1];
  return {
    direction: 'RECIBIDO', type: 'TARJETA_MONEDERO', network: 'PAGOMOVIL',
    amount: amount ? parseFloat(amount) : null, currency: 'CUP',
    sender_phone: null, receiver_phone: null, receiver_account: null,
    transaction_id: txId, balance_after: null,
    note: 'Recarga recibida en monedero Mi Transfer desde tarjeta',
    raw: body
  }
}

// 9. ENVIADO: Tarjeta→Tarjeta (BPA)
if (upper.includes('BANCO POPULAR DE AHORRO') && upper.includes('LA TRANSFERENCIA FUE COMPLETADA')) {
  const amount = clean.match(/Monto[:\s]+([\d.]+)\s*CUP/i)?.[1];
  const benefMatch = clean.match(/Beneficiario[:\s]+([\dX\s]+)/i);
  const benef = benefMatch ? benefMatch[1].replace(/\s/g, '') : null;
  const txId = clean.match(/Nro\.?\s*Transaccion[:\s]+(\w+)/i)?.[1];
  const balance = clean.match(/Saldo restante[:\s]+(?:CR\s+)?([\d.]+)\s*CUP/i)?.[1];
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

function parseCubaLocalDateTime(datePart, timePart) {
  const m = String(datePart).match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/)
  if (!m) return null
  let year, month, day
  if (m[1].length === 4) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3])
  } else {
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]); if (year < 100) year += 2000
  }
  const t = String(timePart).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!t) return null
  const hour=Number(t[1]), minute=Number(t[2]), second=Number(t[3] || 0)
  if (hour>23 || minute>59 || second>59) return null
  // Find the UTC instant corresponding to the local Cuba wall-clock time.
  const guess = Date.UTC(year, month-1, day, hour, minute, second)
  if (!Number.isFinite(guess)) return null
  const tz = 'America/Havana'
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName:'shortOffset', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p=>[p.type,p.value]))
  const z = parts.timeZoneName || 'GMT'
  const om = z.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i)
  const offsetMin = om ? ((om[2]*60) + Number(om[3]||0)) * (om[1] === '+' ? 1 : -1) : 0
  return new Date(guess - offsetMin*60*1000).toISOString()
}

function parseTransactionAt(body, receivedAt = null) {
  const clean = removeAccents(String(body || '')).replace(/\s+/g, ' ').trim()
  const patterns = [
    /(?:FECHA(?:\s+Y\s+HORA)?|REALIZADA\s+EL|FECHA\s+DE\s+(?:LA\s+)?(?:OPERACION|TRANSACCION))\s*[:#-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s*(?:,|[-|])?\s+(\d{1,2}:\d{2}(?::\d{2})?)/i,
    /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/i,
    /\b(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/i,
  ]
  for (const re of patterns) {
    const m = clean.match(re)
    if (m) {
      const parsed = parseCubaLocalDateTime(m[1], m[2])
      if (parsed) return parsed
    }
  }
  const timeOnly = clean.match(/(?:HORA(?:\s+DE\s+(?:LA\s+)?(?:OPERACION|TRANSACCION))?|REALIZADA\s+A\s+LAS)\s*[:#-]?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1]
  if (timeOnly && receivedAt) {
    const received = new Date(receivedAt)
    if (!Number.isNaN(received.getTime())) {
      const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Havana', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(received)
      const map = Object.fromEntries(dateParts.map(p=>[p.type,p.value]))
      const parsed = parseCubaLocalDateTime(`${map.year}-${map.month}-${map.day}`, timeOnly)
      if (parsed) return parsed
    }
  }
  return null
}

function parseSms(sender, body, receivedAt = null) {
  const parsed = parseSmsBase(sender, body)
  return { ...parsed, transaction_at: parseTransactionAt(body, receivedAt) }
}

function matchesCard(accountInSms, cardFirst4, cardLast4) {
  if (!accountInSms || !cardFirst4 || !cardLast4) return false
  return accountInSms.startsWith(cardFirst4) && accountInSms.endsWith(cardLast4)
}

module.exports = { parseSms, matchesCard, normalizePhone }
