package com.synthesisone.app.utils

object SmsParser {

    data class ParsedSms(
        val direction: String,
        val type: String,
        val network: String,
        val category: String,
        val amount: Double?,
        val currency: String?,
        val senderPhone: String?,
        val receiverPhone: String?,
        val receiverAccount: String?,
        val transactionId: String?,
        val balanceAfter: Double?,
        val transactionAt: Long? = null,
        val note: String? = null
    )

    fun parse(body: String, receivedAt: Long? = null): ParsedSms {
        val clean = normalize(body)
        val upper = clean.uppercase()

        fun withTime(parsed: ParsedSms): ParsedSms = parsed.copy(transactionAt = parseTransactionAt(clean, receivedAt))

        parseCubacelIncoming(clean, upper)?.let { return withTime(it) }
        parseCubacelOutgoing(clean, upper)?.let { return withTime(it) }

        // BPA primero — antes que MiTransfer para evitar conflictos
        parseBpaCardWalletOutgoing(clean, upper)?.let { return withTime(it) }
        parseBpaCardCardOutgoing(clean, upper)?.let { return withTime(it) }

        // Bandec
        parseBandecWalletOutgoing(clean, upper)?.let { return withTime(it) }
        parseBandecCardCardOutgoing(clean, upper)?.let { return withTime(it) }

        // MiTransfer
        parseWalletWalletOutgoing(clean, upper)?.let { return withTime(it) }
        parseWalletWalletIncoming(clean, upper)?.let { return withTime(it) }
        parseWalletCardOutgoing(clean, upper)?.let { return withTime(it) }
        parseWalletCardIncoming(clean, upper)?.let { return withTime(it) }
        parseCardWalletIncomingNoSender(clean, upper)?.let { return withTime(it) }
        parseCardWalletIncomingWithSender(clean, upper)?.let { return withTime(it) }

        // PAGOxMOVIL genérico
        parseCardCardIncomingWithSender(clean, upper)?.let { return withTime(it) }
        parseCardCardIncomingNoSender(clean, upper)?.let { return withTime(it) }

        return ParsedSms(
            direction = "DESCONOCIDO",
            type = "DESCONOCIDO",
            network = "DESCONOCIDO",
            category = "DESCONOCIDO",
            amount = null,
            currency = null,
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = null,
            transactionId = null,
            balanceAfter = null,
            transactionAt = parseTransactionAt(clean, receivedAt),
            note = null
        )
    }

    private fun parseTransactionAt(clean: String, receivedAt: Long?): Long? {
        val dateTimePatterns = listOf(
            Regex("(?i)(?:FECHA(?:\\s+Y\\s+HORA)?|REALIZADA\\s+EL|FECHA\\s+DE\\s+(?:LA\\s+)?(?:OPERACION|TRANSACCION))\\s*[:#-]?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})\\s*(?:,|[-|])?\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)"),
            Regex("\\b(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b"),
            Regex("\\b(\\d{4}-\\d{1,2}-\\d{1,2})\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b")
        )
        for (pattern in dateTimePatterns) {
            val m = pattern.find(clean) ?: continue
            val datePart = m.groupValues[1]
            val timePart = m.groupValues[2]
            parseCubaDateTime(datePart, timePart)?.let { return it }
        }

        val timeOnly = Regex("(?i)(?:HORA(?:\\s+DE\\s+(?:LA\\s+)?(?:OPERACION|TRANSACCION))?|REALIZADA\\s+A\\s+LAS)\\s*[:#-]?\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)").find(clean)
            ?.groupValues?.getOrNull(1)
        if (timeOnly != null && receivedAt != null) {
            val date = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("America/Havana")).apply { timeInMillis = receivedAt }
            val datePart = "%04d-%02d-%02d".format(
                java.util.Locale.US, date.get(java.util.Calendar.YEAR), date.get(java.util.Calendar.MONTH) + 1, date.get(java.util.Calendar.DAY_OF_MONTH)
            )
            parseCubaDateTime(datePart, timeOnly)?.let { return it }
        }
        return null
    }

    private fun parseCubaDateTime(datePart: String, timePart: String): Long? {
        val candidates = listOf("dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm")
        val normalizedDate = datePart.replace('-', '/')
        val normalized = if (normalizedDate.count { it == '/' } == 2 && normalizedDate.split('/').first().length == 4) {
            val bits = normalizedDate.split('/')
            "${bits[2]}/${bits[1]}/${bits[0]} $timePart"
        } else {
            "$normalizedDate $timePart"
        }
        for (pattern in candidates) {
            runCatching {
                val fmt = java.text.SimpleDateFormat(pattern, java.util.Locale.US)
                fmt.isLenient = false
                fmt.timeZone = java.util.TimeZone.getTimeZone("America/Havana")
                fmt.parse(normalized)?.time
            }.getOrNull()?.let { return it }
        }
        return null
    }

    // =========================
    // SALDO MÓVIL / CUBACEL
    // =========================

    private fun parseCubacelIncoming(clean: String, upper: String): ParsedSms? {
        // Cubacel formats vary slightly between recharge SMS versions. The phrase is specific
        // enough to classify the event even when the sender phone is omitted or includes ':'.
        if (!upper.contains("USTED HA RECIBIDO")) return null

        val amountRaw = extractFirst(clean, """HA RECIBIDO\s+(?:(?:UNA|UN)\s+)?(?:(?:RECARGA|TRANSFERENCIA|SALDO)\s+DE\s+)?([\d.,]+)\s*(?:CUP|MN)""")
            ?: extractFirst(clean, """(?:RECARGA|TRANSFERENCIA)\s+(?:RECIBIDA\s+)?(?:DE\s+)?([\d.,]+)\s*(?:CUP|MN)""")
        val amount = amountRaw?.let { parseAmount(it) }
        val phone = extractFirst(clean, """DEL NUMERO\s*[:#-]?\s*(\+?\d{7,15})""")
        val balance = extractFirst(clean, """SALDO PRINCIPAL\s*[:#-]?\s*([\d.,]+)\s*CUP""")?.let { parseAmount(it) }

        return ParsedSms(
            direction = "RECIBIDO",
            type = "SALDO_MOVIL",
            network = "CUBACEL",
            category = "SALDO_MOVIL",
            amount = amount,
            currency = "SALDO",
            senderPhone = normalizePhone(phone ?: ""),
            receiverPhone = null,
            receiverAccount = null,
            transactionId = null,
            balanceAfter = balance,
            note = "ENTRADA_SALDO_MOVIL"
        )
    }

    private fun parseCubacelOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.contains("USTED HA TRANSFERIDO")) return null

        val amountRaw = extractFirst(clean, """HA TRANSFERIDO\s+(?:(?:UNA|UN)\s+)?(?:(?:RECARGA|TRANSFERENCIA|SALDO)\s+DE\s+)?([\d.,]+)\s*(?:CUP|MN)""")
            ?: extractFirst(clean, """TRANSFERENCIA\s+(?:ENVIADA\s+)?(?:DE\s+)?([\d.,]+)\s*(?:CUP|MN)""")
        val amount = amountRaw?.let { parseAmount(it) }
        val phone = extractFirst(clean, """AL NUMERO\s*[:#-]?\s*(\+?\d{7,15})""")
        val balance = extractFirst(clean, """SALDO PRINCIPAL\s*[:#-]?\s*([\d.,]+)\s*CUP""")?.let { parseAmount(it) }

        return ParsedSms(
            direction = "ENVIADO",
            type = "SALDO_MOVIL",
            network = "CUBACEL",
            category = "SALDO_MOVIL",
            amount = amount,
            currency = "SALDO",
            senderPhone = null,
            receiverPhone = normalizePhone(phone ?: ""),
            receiverAccount = null,
            transactionId = null,
            balanceAfter = balance,
            note = "SALIDA_SALDO_MOVIL"
        )
    }

    // =========================
    // BANCO POPULAR DE AHORRO (BPA)
    // =========================

    private fun parseBpaCardWalletOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("BANCO POPULAR DE AHORRO:")) return null
        if (!upper.contains("LA RECARGA DE LA CUENTA CUP SE REALIZO CON EXITO")) return null
        if (!upper.contains("MOVIL DEL MONEDERO RECARGADO:")) return null

        val receiverPhone = extractBetween(clean, "movil del monedero recargado:", "Importe Recargado:")
            ?.let { normalizePhone(it) }
        val amount = extractAmountAfterLabel(clean, "Importe Recargado:")
        val idMonedero = extractBetween(clean, "Id Monedero:", "Id Transaccion:")
        val txId = extractBetween(clean, "Id Transaccion:", "Saldo Restante:")
        val balance = extractAmountAfterLabel(clean, "Saldo Restante:")

        return ParsedSms(
            direction = "ENVIADO",
            type = "TARJETA_MONEDERO",
            network = "BPA",
            category = "TRANSFERENCIA",
            amount = amount,
            currency = "CUP",
            senderPhone = null,
            receiverPhone = receiverPhone,
            receiverAccount = idMonedero?.trim(),
            transactionId = txId?.trim(),
            balanceAfter = balance,
            note = "BPA_TARJETA_MONEDERO"
        )
    }

    private fun parseBpaCardCardOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("BANCO POPULAR DE AHORRO:")) return null
        if (!upper.contains("LA TRANSFERENCIA FUE COMPLETADA")) return null
        if (!upper.contains("BENEFICIARIO:")) return null
        if (!upper.contains("MONTO:")) return null

        val beneficiary = extractBetween(clean, "Beneficiario:", "Ordenante:")
        val amount = extractAmountAfterLabel(clean, "Monto:")
        val txId = extractBetween(clean, "Nro. Transaccion:", "Saldo restante:")
        val balance = extractAmountAfterLabel(clean, "Saldo restante:")

        return ParsedSms(
            direction = "ENVIADO",
            type = "TARJETA_TARJETA",
            network = "BPA",
            category = "TRANSFERENCIA",
            amount = amount,
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = beneficiary?.trim(),
            transactionId = txId?.trim(),
            balanceAfter = balance,
            note = "BPA_TARJETA_TARJETA"
        )
    }

    // =========================
    // BANCO BANDEC
    // =========================

    private fun parseBandecWalletOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("BANCO BANDEC:")) return null
        if (!upper.contains("LA RECARGA DE LA CUENTA CUP SE REALIZO CON EXITO")) return null
        if (!upper.contains("MOVIL DEL MONEDERO RECARGADO:")) return null
        if (!upper.contains("IMPORTE RECARGADO:")) return null

        val receiverPhone = extractBetween(clean, "movil del monedero recargado:", "Importe Recargado:")
            ?.let { normalizePhone(it) }
        val amount = extractAmountAfterLabel(clean, "Importe Recargado:")
        val idMonedero = extractBetween(clean, "Id Monedero:", "Id Transaccion:")
        val txId = extractBetween(clean, "Id Transaccion:", "Saldo Restante:")
        val balance = extractAmountAfterLabel(clean, "Saldo Restante:")

        return ParsedSms(
            direction = "ENVIADO",
            type = "TARJETA_MONEDERO",
            network = "BANDEC",
            category = "TRANSFERENCIA",
            amount = amount,
            currency = "CUP",
            senderPhone = null,
            receiverPhone = receiverPhone,
            receiverAccount = idMonedero?.trim(),
            transactionId = txId?.trim(),
            balanceAfter = balance,
            note = "BANDEC_MONEDERO"
        )
    }

    private fun parseBandecCardCardOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("BANCO BANDEC:")) return null
        if (!upper.contains("LA TRANSFERENCIA FUE COMPLETADA")) return null
        if (!upper.contains("BENEFICIARIO:")) return null
        if (!upper.contains("ORDENANTE: CUP")) return null
        if (!upper.contains("MONTO:")) return null
        if (!upper.contains("NRO. TRANSACCION:")) return null

        val beneficiary = extractBetween(clean, "Beneficiario:", "Ordenante:")
        val amount = extractAmountAfterLabel(clean, "Monto:")
        val txId = extractBetween(clean, "Nro. Transaccion:", "Saldo restante:")
        val balance = extractAmountAfterLabel(clean, "Saldo restante:")

        return ParsedSms(
            direction = "ENVIADO",
            type = "TARJETA_TARJETA",
            network = "BANDEC",
            category = "TRANSFERENCIA",
            amount = amount,
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = beneficiary?.trim(),
            transactionId = txId?.trim(),
            balanceAfter = balance,
            note = "BANDEC_SALIDA"
        )
    }

    // =========================
    // MONEDERO -> MONEDERO
    // =========================

    private fun parseWalletWalletIncoming(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^EL\s+TITULAR\s+DEL\s+TELEFONO\s+(\d{8,12})\s+LE\s+HA\s+REALIZADO\s+UNA\s+TRANSFERENCIA\s+AL\s+MONEDERO\s+MITRANSFER\s+([0-9X]{6,20})\s+DE\s+([\d.,]+)\s+CUP\.\s+NRO\.?\s+TRANSACCION\s+([A-Z0-9\-]+)(?:\.\s*FECHA:.*)?\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "MONEDERO_MONEDERO",
            network = "MITRANSFER",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[3]),
            currency = "CUP",
            senderPhone = normalizePhone(m.groupValues[1]),
            receiverPhone = null,
            receiverAccount = m.groupValues[2].trim(),
            transactionId = m.groupValues[4].trim(),
            balanceAfter = null,
            note = "SIN_REMITENTE"
        )
    }

    private fun parseWalletWalletOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("MONEDERO MITRANSFER:")) return null
        if (!upper.contains("LA TRANSFERENCIA FUE COMPLETADA")) return null
        if (!upper.contains("BENEFICIARIO:")) return null
        if (!upper.contains("ORDENANTE:")) return null
        if (!upper.contains("MONTO:")) return null
        if (!upper.contains("NRO. TRANSACCION:")) return null
        if (!upper.contains("SE HA REALIZADO COBRO DE COMISION")) return null

        val beneficiary = extractBetween(clean, "Beneficiario:", "Ordenante:")?.trim()
        val ordenante = extractBetween(clean, "Ordenante:", "Monto:")
        val amount = extractAmountAfterLabel(clean, "Monto:")
        val txId = extractBetween(clean, "Nro. Transaccion:", "Se ha realizado cobro de comision")
        val balance = extractAmountAfterLabel(clean, "Saldo restante:")
        val beneficiaryDigits = beneficiary.orEmpty().filter { it.isDigit() }
        val beneficiaryIsCard = beneficiary?.contains('X', ignoreCase = true) == true || beneficiaryDigits.length == 16

        return if (beneficiaryIsCard) {
            ParsedSms(
                direction = "ENVIADO",
                type = "MONEDERO_TARJETA",
                network = "MITRANSFER",
                category = "TRANSFERENCIA",
                amount = amount,
                currency = "CUP",
                senderPhone = normalizePhone(ordenante?.trim().orEmpty()),
                receiverPhone = null,
                receiverAccount = beneficiary,
                transactionId = txId?.trim(),
                balanceAfter = balance,
                note = "SALIDA_CONFIRMADA_TARJETA"
            )
        } else {
            ParsedSms(
                direction = "ENVIADO",
                type = "MONEDERO_MONEDERO",
                network = "MITRANSFER",
                category = "TRANSFERENCIA",
                amount = amount,
                currency = "CUP",
                senderPhone = normalizePhone(ordenante?.trim().orEmpty()),
                receiverPhone = normalizePhone(beneficiary.orEmpty()),
                receiverAccount = null,
                transactionId = txId?.trim(),
                balanceAfter = balance,
                note = "SALIDA_CONFIRMADA"
            )
        }
    }

    // =========================
    // MONEDERO -> TARJETA
    // =========================

    private fun parseWalletCardOutgoing(clean: String, upper: String): ParsedSms? {
        if (!upper.startsWith("MONEDERO MITRANSFER:")) return null
        if (!upper.contains("LA TRANSFERENCIA FUE COMPLETADA")) return null
        if (!upper.contains("SE HA REALIZADO COBRO DE COMISION")) return null
        if (!upper.contains("BENEFICIARIO:")) return null
        if (!upper.contains("MONTO:")) return null

        val beneficiary = extractBetween(clean, "Beneficiario:", "Monto:")
        val amount = extractAmountAfterLabel(clean, "Monto:")
        val txId = extractBetween(clean, "Nro. Transaccion:", "Se ha realizado cobro de comision")
        val balanceCup = extractAmountAfterLabel(clean, "Saldo cuenta CUP:")
        val balanceUsd = extractAmountAfterLabel(clean, "Saldo cuenta USD:")

        return ParsedSms(
            direction = "ENVIADO",
            type = "MONEDERO_TARJETA",
            network = "MITRANSFER",
            category = "TRANSFERENCIA",
            amount = amount,
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = beneficiary?.trim(),
            transactionId = txId?.trim(),
            balanceAfter = balanceCup ?: balanceUsd,
            note = "SALIDA_CONFIRMADA"
        )
    }

    private fun parseWalletCardIncoming(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^EL\s+TITULAR\s+DEL\s+TELEFONO\s+(\d{8,12})\s+LE\s+HA\s+REALIZADO\s+UNA\s+TRANSFERENCIA\s+A\s+LA\s+CUENTA:?\s+([0-9X]{8,24})\s+DE\s+([\d.,]+)\s+CUP\.\s+NRO\.?\s+TRANSACCION\s+([A-Z0-9\-]+)(?:\s+CON\s+REMITENTE)?(?:\.\s*FECHA:.*)?\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null
        val receiverAccount = m.groupValues[2].trim()
        if (!receiverAccount.contains("XXXXXXXX")) return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "MONEDERO_TARJETA",
            network = "PAGOMOVIL",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[3]),
            currency = "CUP",
            senderPhone = normalizePhone(m.groupValues[1]),
            receiverPhone = null,
            receiverAccount = receiverAccount,
            transactionId = m.groupValues[4].trim(),
            balanceAfter = null,
            note = "CUENTA_ENMASCARADA"
        )
    }

    // =========================
    // TARJETA -> MONEDERO
    // =========================

    private fun parseCardWalletIncomingNoSender(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^MONEDERO\s+MITRANSFER:\s+SU\s+MONEDERO\s+CUP\s+HA\s+SIDO\s+RECARGADO\s+CON:\s*([\d.,]+)\s+CUP\.\s*ID\s+TRANSACCION:\s*([A-Z0-9\-]+)\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "TARJETA_MONEDERO",
            network = "MITRANSFER",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[1]),
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = null,
            transactionId = m.groupValues[2].trim(),
            balanceAfter = null,
            note = "SIN_REMITENTE"
        )
    }

    private fun parseCardWalletIncomingWithSender(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^SE\s+HA\s+REALIZADO\s+UNA\s+TRANSFERENCIA\s+AL\s+MONEDERO\s+MITRANSFER\s+([0-9X]{6,20})\s+DE\s+([\d.,]+)\s+CUP\.\s+NRO\.?\s+TRANSACCION\s+([A-Z0-9\-]+)(?:\.\s*FECHA:.*)?\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "TARJETA_MONEDERO",
            network = "MITRANSFER",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[2]),
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = m.groupValues[1].trim(),
            transactionId = m.groupValues[3].trim(),
            balanceAfter = null,
            note = "SIN_REMITENTE"
        )
    }

    // =========================
    // TARJETA -> TARJETA
    // =========================

    private fun parseCardCardIncomingWithSender(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^EL\s+TITULAR\s+DEL\s+TELEFONO\s+(\d{8,12})\s+LE\s+HA\s+REALIZADO\s+UNA\s+TRANSFERENCIA\s+A\s+LA\s+CUENTA:?\s+([0-9X]{8,24})\s+DE\s+([\d.,]+)\s+CUP\.\s+NRO\.?\s+TRANSACCION\s+([A-Z0-9\-]+)(?:\s+CON\s+REMITENTE)?(?:\.\s*FECHA:.*)?\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null
        val receiverAccount = m.groupValues[2].trim()
        if (receiverAccount.contains("XXXXXXXX")) return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "TARJETA_TARJETA",
            network = "PAGOMOVIL",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[3]),
            currency = "CUP",
            senderPhone = normalizePhone(m.groupValues[1]),
            receiverPhone = null,
            receiverAccount = receiverAccount,
            transactionId = m.groupValues[4].trim(),
            balanceAfter = null,
            note = "CON_REMITENTE"
        )
    }

    private fun parseCardCardIncomingNoSender(clean: String, upper: String): ParsedSms? {
        val regex = Regex(
            pattern = """^SE\s+HA\s+REALIZADO\s+UNA\s+TRANSFERENCIA\s+A\s+LA\s+CUENTA\s+([0-9X]{8,24})\s+DE\s+([\d.,]+)\s+CUP\.\s+NRO\.?\s+TRANSACCION\s+([A-Z0-9\-]+)(?:\.\s*FECHA:.*)?\.?$""",
            options = setOf(RegexOption.IGNORE_CASE)
        )

        val m = regex.find(clean) ?: return null
        val receiverAccount = m.groupValues[1].trim()
        if (receiverAccount.contains("XXXXXXXX")) return null

        return ParsedSms(
            direction = "RECIBIDO",
            type = "TARJETA_TARJETA",
            network = "PAGOMOVIL",
            category = "TRANSFERENCIA",
            amount = parseAmount(m.groupValues[2]),
            currency = "CUP",
            senderPhone = null,
            receiverPhone = null,
            receiverAccount = receiverAccount,
            transactionId = m.groupValues[3].trim(),
            balanceAfter = null,
            note = "SIN_REMITENTE"
        )
    }

    // =========================
    // HELPERS
    // =========================

    private fun extractBetween(text: String, start: String, end: String?): String? {
        val startIndex = text.indexOf(start, ignoreCase = true)
        if (startIndex < 0) return null
        val from = startIndex + start.length
        val tail = text.substring(from)
        return if (end == null) {
            tail.trim().trimEnd('.', ' ')
        } else {
            val endIndex = tail.indexOf(end, ignoreCase = true)
            if (endIndex < 0) return null
            tail.substring(0, endIndex).trim().trimEnd('.', ' ')
        }
    }

    private fun extractFirst(text: String, pattern: String): String? {
        return Regex(pattern, RegexOption.IGNORE_CASE)
            .find(text)
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
    }

    private fun extractAmountAfterLabel(text: String, label: String): Double? {
        val raw = extractBetween(text, label, "CUP") ?: return null
        return parseAmount(raw)
    }

    private fun parseAmount(raw: String): Double? {
        val value = raw.trim().replace(" ", "").replace(Regex("[^0-9.,]"), "")
        if (value.isBlank()) return null
        val comma = value.lastIndexOf(',')
        val dot = value.lastIndexOf('.')
        val normalized = when {
            comma >= 0 && dot >= 0 -> {
                // The last punctuation mark is the decimal separator; remove grouping marks.
                if (comma > dot) value.replace(".", "").replace(',', '.') else value.replace(",", "")
            }
            comma >= 0 -> {
                if (Regex("^\\d{1,3}(,\\d{3})+$").matches(value)) value.replace(",", "") else value.replace(',', '.')
            }
            dot >= 0 -> {
                if (Regex("^\\d{1,3}(\\.\\d{3})+$").matches(value)) value.replace(".", "") else value
            }
            else -> value
        }
        return normalized.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 }
    }

    private fun normalize(text: String): String {
        return removeAccents(text).replace(Regex("""\s+"""), " ").trim()
    }

    private fun removeAccents(text: String): String {
        val map = mapOf(
            'á' to 'a', 'é' to 'e', 'í' to 'i', 'ó' to 'o', 'ú' to 'u',
            'Á' to 'A', 'É' to 'E', 'Í' to 'I', 'Ó' to 'O', 'Ú' to 'U',
            'ñ' to 'n', 'Ñ' to 'N'
        )
        return text.map { map[it] ?: it }.joinToString("")
    }

    private fun normalizePhone(phone: String): String {
        val digits = phone.filter { it.isDigit() }
        return if (digits.length == 10 && digits.startsWith("53")) digits.drop(2) else digits
    }
}
