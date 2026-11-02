package com.synthesisone.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Telephony
import android.util.Log
import com.synthesisone.app.data.AppDatabase
import com.synthesisone.app.data.SmsEntity
import com.synthesisone.app.service.NotificationService
import com.synthesisone.app.service.SyncService
import com.synthesisone.app.utils.SmsParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.text.Normalizer
import java.util.Locale

class SmsReceiver : BroadcastReceiver() {

    private data class SmsGroup(val body: StringBuilder, var receivedAt: Long)

    companion object {
        const val TAG = "SynthesisOne_SMS"

        private val ALLOWED_SENDERS = setOf(
            // Pagos y transferencias
            "PAGOMOVIL", "PAGOXMOVIL", "TRANSFERMOVIL", "TRANSFERMOVILCUBA",
            "BANDEC", "BANMET", "BANCO METROPOLITANO", "BPA", "BANCO POPULAR DE AHORRO",
            // Recargas móviles y comunicaciones
            "CUBACEL", "ETECSA"
        )

        private fun normalizeSender(sender: String): String = Normalizer
            .normalize(sender, Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .uppercase(Locale.ROOT)
            .filter { it.isLetterOrDigit() }

        fun isTrustedSender(sender: String): Boolean {
            val normalized = normalizeSender(sender)
            return normalized.isNotBlank() && ALLOWED_SENDERS.any { allowed ->
                val candidate = normalizeSender(allowed)
                normalized == candidate || normalized.contains(candidate)
            }
        }
    }

    private fun stableEventKey(sender: String, receivedAt: Long, body: String): String {
        val seed = "${normalizeSender(sender)}\u001f$receivedAt\u001f${body.trim()}"
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // goAsync evita que Android cierre el proceso en cuanto termina onReceive,
        // mientras Room guarda los SMS. El lock es temporal y tiene un límite duro.
        val pendingResult = goAsync()
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$TAG:PersistSms").apply {
            setReferenceCounted(false)
            runCatching { acquire(9_000L) }
        }
        val appContext = context.applicationContext

        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            var savedAny = false
            try {
                val grouped = linkedMapOf<String, SmsGroup>()
                for (message in messages) {
                    val sender = message.originatingAddress ?: continue
                    val group = grouped.getOrPut(sender) { SmsGroup(StringBuilder(), message.timestampMillis) }
                    group.body.append(message.messageBody)
                    group.receivedAt = maxOf(group.receivedAt, message.timestampMillis)
                }

                val db = AppDatabase.getInstance(appContext)
                for ((sender, group) in grouped) {
                    val body = group.body.toString().trim()
                    if (body.isBlank()) continue
                    if (!isTrustedSender(sender)) {
                        Log.d(TAG, "SMS ignorado por remitente no autorizado: ${sender.take(60)}")
                        continue
                    }

                    try {
                        val parsed = SmsParser.parse(body, group.receivedAt)
                        val smsEntity = SmsEntity(
                            sender = sender,
                            body = body,
                            receivedAt = group.receivedAt,
                            direction = parsed.direction,
                            type = parsed.type,
                            network = parsed.network,
                            category = parsed.category,
                            amount = parsed.amount,
                            currency = parsed.currency,
                            senderPhone = parsed.senderPhone,
                            receiverPhone = parsed.receiverPhone,
                            receiverAccount = parsed.receiverAccount,
                            transactionId = parsed.transactionId,
                            balanceAfter = parsed.balanceAfter,
                            transactionAt = parsed.transactionAt,
                            note = parsed.note,
                            dedupeKey = stableEventKey(sender, group.receivedAt, body)
                        )
                        val id = db.smsDao().insert(smsEntity)
                        if (id < 0L) {
                            Log.i(TAG, "SMS duplicado ignorado; no se volverá a enviar al webhook")
                            continue
                        }
                        db.smsDao().markQueued(id)
                        savedAny = true
                        Log.i(TAG, "SMS persistido id=$id dirección=${parsed.direction ?: "UNKNOWN"} remitente=${sender.take(35)}")

                        // Alertas locales solo se emiten para eventos nuevos; una repetición del broadcast
                        // no produce una segunda notificación ni vuelve a poner en cola el webhook.
                        NotificationService.showPaymentNotification(appContext, sender, body)
                    } catch (error: Exception) {
                        Log.e(TAG, "Error persistiendo SMS de ${sender.take(35)}", error)
                    }
                }

                if (savedAny) {
                    NotificationService.updateDailyFlow(appContext)
                    runCatching { SyncService.syncNow(appContext) }
                        .onFailure { Log.e(TAG, "No se pudo arrancar la sincronización; los SMS siguen guardados en Room", it) }
                }
            } catch (error: Exception) {
                Log.e(TAG, "Falló el receptor SMS; revisar permisos/base de datos", error)
            } finally {
                runCatching { if (wakeLock.isHeld) wakeLock.release() }
                runCatching { pendingResult.finish() }
            }
        }
    }
}
