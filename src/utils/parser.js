/**
 * Parsea el cuerpo de un SMS de Transfermóvil o PAGOxMOVIL
 * y extrae los datos estructurados del pago.
 * 
 * Ejemplos de SMS conocidos:
 * "Transferencia recibida de 1234567890 por 500.00 CUP. Saldo: 1000.00 CUP"
 * "Pago recibido 250.00 CUP de Juan Pedro. Ref: 123456"
 */
function parseSms(sender, body) {
  const result = {
    type: null,       // 'transferencia' | 'pago' | 'recarga' | 'desconocido'
    amount: null,     // número
    currency: null,   // 'CUP' | 'MLC'
    from: null,       // número o nombre del remitente
    reference: null,  // número de referencia si existe
    balance: null,    // saldo resultante si aparece
    raw: body         // siempre guardamos el SMS original
  }

  try {
    // Detectar moneda
    if (body.includes('MLC')) result.currency = 'MLC'
    else if (body.includes('CUP')) result.currency = 'CUP'

    // Extraer monto — busca patrones como "500.00 CUP" o "500,00 CUP"
    const amountMatch = body.match(/(\d+[.,]\d{2})\s*(CUP|MLC)/)
    if (amountMatch) {
      result.amount = parseFloat(amountMatch[1].replace(',', '.'))
      result.currency = amountMatch[2]
    }

    // Detectar tipo de operación
    if (/transferencia/i.test(body)) result.type = 'transferencia'
    else if (/pago/i.test(body)) result.type = 'pago'
    else if (/recarga/i.test(body)) result.type = 'recarga'
    else result.type = 'desconocido'

    // Extraer número de referencia
    const refMatch = body.match(/[Rr]ef[:\s#]*(\d+)/)
    if (refMatch) result.reference = refMatch[1]

    // Extraer saldo resultante
    const balanceMatch = body.match(/[Ss]aldo[:\s]*(\d+[.,]\d{2})\s*(CUP|MLC)/)
    if (balanceMatch) {
      result.balance = parseFloat(balanceMatch[1].replace(',', '.'))
    }

    // Extraer remitente (número de teléfono)
    const phoneMatch = body.match(/\b(5\d{7})\b/)
    if (phoneMatch) result.from = phoneMatch[1]

  } catch (err) {
    console.error('Error parseando SMS:', err.message)
  }

  return result
}

module.exports = { parseSms }
