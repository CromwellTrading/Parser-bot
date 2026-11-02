package com.synthesisone.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.synthesisone.app.MainActivity
import com.synthesisone.app.R
import com.synthesisone.app.data.AppDatabase
import com.synthesisone.app.utils.SmsParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Calendar
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object NotificationService {

    private const val CHANNEL_PAYMENTS = "synthesisone_payments"
    private const val CHANNEL_FLOW = "synthesisone_flow"
    private const val CHANNEL_SERVICE = "synthesisone_service"

    private const val NOTIF_FLOW_ID = 1001
    private const val NOTIF_SERVICE_ID = 1000

    private const val KEY_FLOW_DATE = "daily_flow_date"
    private const val KEY_FLOW_TOTAL_IN = "daily_flow_total_in"
    private const val KEY_FLOW_TOTAL_OUT = "daily_flow_total_out"
    private const val KEY_FLOW_COUNT_IN = "daily_flow_count_in"
    private const val KEY_FLOW_COUNT_OUT = "daily_flow_count_out"
    private const val KEY_FLOW_TRANSFER_IN = "daily_flow_transfer_in"
    private const val KEY_FLOW_TRANSFER_OUT = "daily_flow_transfer_out"
    private const val KEY_FLOW_TRANSFER_COUNT_IN = "daily_flow_transfer_count_in"
    private const val KEY_FLOW_TRANSFER_COUNT_OUT = "daily_flow_transfer_count_out"
    private const val KEY_FLOW_MOBILE_IN = "daily_flow_mobile_in"
    private const val KEY_FLOW_MOBILE_OUT = "daily_flow_mobile_out"
    private const val KEY_FLOW_MOBILE_COUNT_IN = "daily_flow_mobile_count_in"
    private const val KEY_FLOW_MOBILE_COUNT_OUT = "daily_flow_mobile_count_out"
    private const val KEY_FLOW_LAST_UPDATE = "daily_flow_last_update"

    private data class DailyFlowSummary(
        val dayKey: Long,
        val totalIn: Double,
        val totalOut: Double,
        val countIn: Int,
        val countOut: Int,
        val transferIn: Double,
        val transferOut: Double,
        val transferCountIn: Int,
        val transferCountOut: Int,
        val mobileIn: Double,
        val mobileOut: Double,
        val mobileCountIn: Int,
        val mobileCountOut: Int
    ) {
        val net: Double get() = totalIn - totalOut
    }

    /** Notification accent follows the client's independent color-theme preference. Android
     * still owns notification-card typography/background, but the app accent and channel light
     * can match the palette selected inside SynthesisOne. */
    private fun themeAccent(context: Context): Int {
        val theme = context.getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
            .getString("so_theme", "violet").orEmpty()
        return when (theme) {
            "light" -> Color.parseColor("#6543D6")
            "red" -> Color.parseColor("#FF426D")
            "green" -> Color.parseColor("#25B981")
            "cyan" -> Color.parseColor("#19BFD1")
            else -> Color.parseColor("#8357FF")
        }
    }

    private fun appIcon(): Int = R.mipmap.ic_launcher

    private fun largeIcon(context: Context): Bitmap? {
        val drawable = ContextCompat.getDrawable(context, R.mipmap.ic_launcher) ?: return null
        return drawable.toBitmapOrNull()
    }

    private fun Drawable.toBitmapOrNull(): Bitmap? {
        if (this is BitmapDrawable) {
            val bmp = bitmap
            if (bmp != null) return bmp
        }

        val width = if (intrinsicWidth > 0) intrinsicWidth else 1
        val height = if (intrinsicHeight > 0) intrinsicHeight else 1
        if (width <= 0 || height <= 0) return null

        return try {
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            setBounds(0, 0, canvas.width, canvas.height)
            draw(canvas)
            bitmap
        } catch (_: Throwable) {
            null
        }
    }

    private fun dayKeyForNow(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    private suspend fun calculateDailyFlow(context: Context): DailyFlowSummary {
        val db = AppDatabase.getInstance(context)
        val allSms = db.smsDao().getRecent(500)
        val startOfDay = dayKeyForNow()
        val todaySms = allSms.filter { it.receivedAt >= startOfDay }

        var totalIn = 0.0
        var totalOut = 0.0
        var countIn = 0
        var countOut = 0
        var transferIn = 0.0
        var transferOut = 0.0
        var transferCountIn = 0
        var transferCountOut = 0
        var mobileIn = 0.0
        var mobileOut = 0.0
        var mobileCountIn = 0
        var mobileCountOut = 0

        todaySms.forEach { sms ->
            val p = SmsParser.parse(sms.body, sms.receivedAt)
            val amount = p.amount ?: return@forEach
            val isMobile = p.category == "SALDO_MOVIL" || p.network == "CUBACEL"

            when (p.direction) {
                "RECIBIDO" -> {
                    totalIn += amount
                    countIn++
                    if (isMobile) {
                        mobileIn += amount
                        mobileCountIn++
                    } else {
                        transferIn += amount
                        transferCountIn++
                    }
                }

                "ENVIADO" -> {
                    totalOut += amount
                    countOut++
                    if (isMobile) {
                        mobileOut += amount
                        mobileCountOut++
                    } else {
                        transferOut += amount
                        transferCountOut++
                    }
                }
            }
        }

        return DailyFlowSummary(
            startOfDay,
            totalIn,
            totalOut,
            countIn,
            countOut,
            transferIn,
            transferOut,
            transferCountIn,
            transferCountOut,
            mobileIn,
            mobileOut,
            mobileCountIn,
            mobileCountOut
        )
    }

    private fun persistDailyFlow(context: Context, summary: DailyFlowSummary) {
        context.getSharedPreferences("synthesisone_flow_state", Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_FLOW_DATE, summary.dayKey)
            .putLong(KEY_FLOW_LAST_UPDATE, System.currentTimeMillis())
            .putFloat(KEY_FLOW_TOTAL_IN, summary.totalIn.toFloat())
            .putFloat(KEY_FLOW_TOTAL_OUT, summary.totalOut.toFloat())
            .putInt(KEY_FLOW_COUNT_IN, summary.countIn)
            .putInt(KEY_FLOW_COUNT_OUT, summary.countOut)
            .putFloat(KEY_FLOW_TRANSFER_IN, summary.transferIn.toFloat())
            .putFloat(KEY_FLOW_TRANSFER_OUT, summary.transferOut.toFloat())
            .putInt(KEY_FLOW_TRANSFER_COUNT_IN, summary.transferCountIn)
            .putInt(KEY_FLOW_TRANSFER_COUNT_OUT, summary.transferCountOut)
            .putFloat(KEY_FLOW_MOBILE_IN, summary.mobileIn.toFloat())
            .putFloat(KEY_FLOW_MOBILE_OUT, summary.mobileOut.toFloat())
            .putInt(KEY_FLOW_MOBILE_COUNT_IN, summary.mobileCountIn)
            .putInt(KEY_FLOW_MOBILE_COUNT_OUT, summary.mobileCountOut)
            .apply()
    }

    private fun readDailyFlow(context: Context): DailyFlowSummary? {
        val prefs = context.getSharedPreferences("synthesisone_flow_state", Context.MODE_PRIVATE)
        val dayKey = prefs.getLong(KEY_FLOW_DATE, -1L)
        if (dayKey <= 0L) return null

        return DailyFlowSummary(
            dayKey = dayKey,
            totalIn = prefs.getFloat(KEY_FLOW_TOTAL_IN, 0f).toDouble(),
            totalOut = prefs.getFloat(KEY_FLOW_TOTAL_OUT, 0f).toDouble(),
            countIn = prefs.getInt(KEY_FLOW_COUNT_IN, 0),
            countOut = prefs.getInt(KEY_FLOW_COUNT_OUT, 0),
            transferIn = prefs.getFloat(KEY_FLOW_TRANSFER_IN, 0f).toDouble(),
            transferOut = prefs.getFloat(KEY_FLOW_TRANSFER_OUT, 0f).toDouble(),
            transferCountIn = prefs.getInt(KEY_FLOW_TRANSFER_COUNT_IN, 0),
            transferCountOut = prefs.getInt(KEY_FLOW_TRANSFER_COUNT_OUT, 0),
            mobileIn = prefs.getFloat(KEY_FLOW_MOBILE_IN, 0f).toDouble(),
            mobileOut = prefs.getFloat(KEY_FLOW_MOBILE_OUT, 0f).toDouble(),
            mobileCountIn = prefs.getInt(KEY_FLOW_MOBILE_COUNT_IN, 0),
            mobileCountOut = prefs.getInt(KEY_FLOW_MOBILE_COUNT_OUT, 0)
        )
    }

    private fun postDailyFlowNotification(context: Context, summary: DailyFlowSummary) {
        val neto = summary.net
        val netoText = if (neto >= 0) "+ %.2f CUP".format(neto) else "- %.2f CUP".format(-neto)
        val transferText = "Transferencias: + ${"%.2f".format(summary.transferIn)} / - ${"%.2f".format(summary.transferOut)} CUP"
        val mobileText = "Saldo móvil: + ${"%.2f".format(summary.mobileIn)} / - ${"%.2f".format(summary.mobileOut)} CUP"

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(context, CHANNEL_FLOW)
            .setSmallIcon(appIcon())
            .setLargeIcon(largeIcon(context))
            .setContentTitle("Neto hoy: $netoText")
            .setContentText("$transferText • $mobileText")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Balance neto: $netoText\n" +
                        "Transferencias: + ${"%.2f".format(summary.transferIn)} CUP (${summary.transferCountIn})\n" +
                        "Transferencias salientes: - ${"%.2f".format(summary.transferOut)} CUP (${summary.transferCountOut})\n" +
                        "Saldo móvil: + ${"%.2f".format(summary.mobileIn)} CUP (${summary.mobileCountIn})\n" +
                        "Saldo móvil saliente: - ${"%.2f".format(summary.mobileOut)} CUP (${summary.mobileCountOut})"
                )
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setColor(themeAccent(context))
            .build()

        val nm = context.getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_FLOW_ID, notif)
    }

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)

        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_PAYMENTS,
                "Movimientos y pagos",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alertas visuales de movimientos financieros y activaciones"
                enableLights(true)
                lightColor = themeAccent(context)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 100, 300)
            }
        )

        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_FLOW,
                "Resumen financiero",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Resumen del flujo financiero diario"
            }
        )

        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_SERVICE,
                "SynthesisOne · Servicio",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Estado del servicio y sincronización"
            }
        )
    }

    private fun stablePaymentNotificationId(parsed: SmsParser.ParsedSms, sender: String, body: String): Int {
        val key = buildString {
            append(parsed.direction)
            append('|')
            append(parsed.type)
            append('|')
            append(parsed.network)
            append('|')
            append(parsed.transactionId?.trim().orEmpty())
            append('|')
            append(parsed.receiverAccount?.trim().orEmpty())
            append('|')
            append(sender.trim())
            append('|')
            append(body.trim())
        }
        return key.hashCode() and 0x7fffffff
    }

    fun showLicenseActivatedNotificationOnce(context: Context, token: String) {
        if (token.isBlank()) return
        createChannels(context)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

        val prefs = context.getSharedPreferences("synthesisone_prefs", Context.MODE_PRIVATE)
        val lastToken = prefs.getString("license_activation_notification_token", "").orEmpty()
        if (lastToken == token) return

        val activatedAt = prefs.getLong("license_activated_at", System.currentTimeMillis())
        val expiresAt = prefs.getLong("license_expires_at", 0L)
        val now = System.currentTimeMillis()
        val daysLeft = if (expiresAt > now) ((expiresAt - now) / (24L*60*60*1000)).toInt() else 0
        val dateFmt = SimpleDateFormat("dd/MM/yyyy · HH:mm", Locale.getDefault())
        val expFmt = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            context, 3100, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val expiryLine = if (expiresAt > 0L) "Expira: ${expFmt.format(Date(expiresAt))} · ${daysLeft} día(s) restantes"
                          else "Licencia activa · consulta la fecha de vencimiento en la app"
        val body = "Tu licencia quedó activa automáticamente.\n" +
                "Activada: ${dateFmt.format(Date(activatedAt))}\n" +
                expiryLine + "\n" +
                "Abre SynthesisOne para terminar de configurar tus datos."

        val notif = NotificationCompat.Builder(context, CHANNEL_PAYMENTS)
            .setSmallIcon(appIcon())
            .setLargeIcon(largeIcon(context))
            .setContentTitle("✦ SynthesisOne · Licencia activa")
            .setContentText(expiryLine)
            .setSubText("Activación automática")
            .setStyle(NotificationCompat.BigTextStyle().setBigContentTitle("Licencia activada ✓").bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setColor(themeAccent(context))
            .build()

        NotificationManagerCompat.from(context).notify(3100, notif)
        prefs.edit().putString("license_activation_notification_token", token).apply()
    }

    fun showPaymentNotification(context: Context, sender: String, body: String, synced: Boolean = false) {
        createChannels(context)

        try {
            val parsed = SmsParser.parse(body)
            if (parsed.amount == null) return

            val isIncoming = parsed.direction == "RECIBIDO"
            val isOutgoing = parsed.direction == "ENVIADO"
            val title = when {
                synced && isIncoming -> "Entrada sincronizada"
                synced && isOutgoing -> "Salida sincronizada"
                synced -> "Movimiento sincronizado"
                isIncoming -> "Entrada detectada"
                isOutgoing -> "Salida detectada"
                else -> "Movimiento detectado"
            }
            val amountText = "%.2f %s".format(parsed.amount, parsed.currency?.takeIf { it.isNotBlank() } ?: "—")
            val typeText = parsed.type.replace("_", " · ")
            val senderText = parsed.senderPhone?.takeIf { it.isNotBlank() } ?: sender
            val whenText = SimpleDateFormat("dd/MM/yyyy · HH:mm", Locale.getDefault()).format(Date())

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pi = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val details = buildString {
                append("Importe: ").append(when { isIncoming -> "+ "; isOutgoing -> "− "; else -> "" }).append(amountText).append('\n')
                append("Tipo: ").append(typeText).append('\n')
                append("Número: ").append(senderText).append('\n')
                append("Red: ").append(parsed.network ?: "—").append('\n')
                parsed.transactionId?.let { append("Operación: ").append(it).append('\n') }
                append(if (synced) "Aceptado por el backend: " else "Detectado: ").append(whenText)
                if (synced) append("\nEl SMS quedó aceptado para sincronización; esto no significa por sí solo que una compra o recarga externa se haya completado.")
            }

            val notif = NotificationCompat.Builder(context, CHANNEL_PAYMENTS)
                .setSmallIcon(appIcon())
                .setLargeIcon(largeIcon(context))
                .setContentTitle("${when { isIncoming -> "↓"; isOutgoing -> "↑"; else -> "•" }} $title · $amountText")
                .setContentText(if (synced) "$senderText · sincronización confirmada" else "$senderText · ${parsed.network ?: "Movimiento financiero"}")
                .setSubText("SynthesisOne")
                .setStyle(NotificationCompat.BigTextStyle().setBigContentTitle("$title · $amountText").bigText(details + "\n\nToca para abrir el historial."))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setColor(themeAccent(context))
                .build()

            val nm = context.getSystemService(NotificationManager::class.java)
            val notifId = stablePaymentNotificationId(parsed, sender, body)
            nm.notify(notifId, notif)
        } catch (_: Exception) {
            // Las notificaciones no deben romper el flujo de recepción de SMS.
        }
    }

    /** General local notice for results that have already been confirmed by the server. */
    fun showAppEventNotification(context: Context, title: String, details: String, eventKey: String, success: Boolean = true) {
        try {
            createChannels(context)
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val requestCode = (eventKey.hashCode() and 0x7fffffff).coerceAtLeast(1)
            val pi = PendingIntent.getActivity(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val color = if (success) themeAccent(context) else Color.parseColor("#FF5C7A")
            val notification = NotificationCompat.Builder(context, CHANNEL_PAYMENTS)
                .setSmallIcon(appIcon())
                .setLargeIcon(largeIcon(context))
                .setContentTitle(title)
                .setContentText(details.take(160))
                .setStyle(NotificationCompat.BigTextStyle().bigText(details))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setColor(color)
                .build()
            context.getSystemService(NotificationManager::class.java)
                .notify(4100 + (requestCode % 100000), notification)
        } catch (_: SecurityException) {
            // Notificaciones denegadas no deben afectar pagos ni persistencia local.
        } catch (_: Exception) {
            // Notificaciones complementarias nunca deben interrumpir el flujo principal.
        }
    }

    /**
     * Compatibility entry point for StoreStatusWorker. Keep the notification isolated
     * from payment/SMS processing: any failure here is swallowed by showAppEventNotification.
     * Details are deliberately not echoed verbatim because worker arguments may include
     * tokens or other sensitive values. A Boolean argument, when supplied, is treated as
     * the success flag. The same notification key updates the existing status notice.
     */
    fun showStoreStatusUpdate(context: Context, vararg workerValues: Any?) {
        val explicitResult = workerValues.filterIsInstance<Boolean>().lastOrNull()
        val success = explicitResult ?: true
        val details = if (success) {
            "La comprobación del estado de la tienda ha terminado. Abre SynthesisOne para consultar el estado actual."
        } else {
            "No se pudo confirmar el estado de la tienda. Comprueba la conexión y vuelve a intentarlo."
        }
        showAppEventNotification(
            context = context,
            title = "SynthesisOne · Estado de tienda",
            details = details,
            eventKey = "store-status-update",
            success = success
        )
    }

    fun updateSyncHealthNotification(context: Context, pendingCount: Int, failedCount: Int, lastError: String? = null) {
        try {
            createChannels(context)
            val manager = NotificationManagerCompat.from(context)
            val notificationId = 3101
            if (pendingCount <= 0 && failedCount <= 0) {
                manager.cancel(notificationId)
                return
            }
            val intent = Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP }
            val pi = PendingIntent.getActivity(context, notificationId, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val title = if (failedCount > 0) "SynthesisOne · sincronización requiere atención" else "SynthesisOne · movimientos pendientes"
            val details = buildString {
                append("En cola: $pendingCount · Con error: $failedCount")
                if (!lastError.isNullOrBlank()) append("\nÚltimo error: ").append(lastError.take(180))
                append("\nTus movimientos siguen guardados en el teléfono.")
            }
            val color = if (failedCount > 0) Color.parseColor("#FF1744") else Color.parseColor("#F0B64A")
            val notification = NotificationCompat.Builder(context, CHANNEL_SERVICE)
                .setSmallIcon(appIcon()).setContentTitle(title).setContentText("En cola: $pendingCount · Errores: $failedCount")
                .setStyle(NotificationCompat.BigTextStyle().bigText(details)).setContentIntent(pi)
                .setAutoCancel(false).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_STATUS)
                .setColor(color).build()
            manager.notify(notificationId, notification)
        } catch (_: SecurityException) {
            // El permiso de notificaciones es opcional; nunca interrumpir la recepción/sincronización.
        } catch (_: Exception) {
            // Las notificaciones de salud no deben romper la sincronización.
        }
    }

    fun updateDailyFlow(context: Context) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                createChannels(context)
                val summary = calculateDailyFlow(context)
                persistDailyFlow(context, summary)
                postDailyFlowNotification(context, summary)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun restoreDailyFlow(context: Context) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                createChannels(context)
                val summary = readDailyFlow(context) ?: calculateDailyFlow(context)
                persistDailyFlow(context, summary)
                postDailyFlowNotification(context, summary)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun buildServiceNotification(context: Context): android.app.Notification {
        createChannels(context)

        val intent = Intent(context, MainActivity::class.java)
        val pi = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(appIcon())
            .setLargeIcon(largeIcon(context))
            .setContentTitle("SynthesisOne activo")
            .setContentText("Monitoreando pagos en segundo plano")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "Servicio activo y monitoreando pagos en segundo plano"
                )
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
