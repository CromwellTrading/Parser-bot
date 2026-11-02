package com.synthesisone.app.service

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.synthesisone.app.MainActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Background-only store reconciler for customer-facing order state notifications.
 * Payment reconciliation/credit remains exclusively server-side. This worker only
 * reads authoritative state and notifies when an already-known ticket changes.
 */
class StoreStatusWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = workerMutex.withLock { withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(SyncService.KEY_DEVICE_ID, "").orEmpty()
        val tokens = listOf(
            prefs.getString(SyncService.KEY_STORE_TOKEN, "").orEmpty(),
            prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        ).filter { it.isNotBlank() }.distinct()
        if (tokens.isEmpty()) return@withContext Result.success()

        var body: String? = null
        var lastCode = 0
        for (token in tokens) {
            val response = requestHistory(token, deviceId)
            lastCode = response.first
            if (lastCode in 200..299) {
                body = response.second
                break
            }
            if (lastCode == 0 || lastCode >= 500) return@withContext Result.retry()
        }
        if (body == null) {
            // Invalid/revoked sessions aren't retried every few seconds. A newly
            // registered store session schedules another one-time check.
            return@withContext if (lastCode in 500..599 || lastCode == 0) Result.retry() else Result.success()
        }

        val json = runCatching { JSONObject(body!!) }.getOrNull() ?: return@withContext Result.retry()
        val entries = json.optJSONArray("entries") ?: JSONArray()
        val editor = prefs.edit()
        for (i in 0 until entries.length()) {
            val entry = entries.optJSONObject(i) ?: continue
            val source = entry.optString("source", "").uppercase()
            val id = entry.optString("id", "").trim()
            if (id.isBlank()) continue
            val review = entry.optBoolean("payment_review_required", false)
            val referenceType = entry.optString("reference_type", "").uppercase()
            val referenceId = entry.optString("reference_id", "").trim()
            val rawStatus = entry.optString("status", "UNKNOWN").uppercase()
            val key: String
            val status: String
            val notifyKey: String
            val sourceForNotice: String
            when {
                source == "ETECSA" -> {
                    key = "etecsa_order_status_$id"; status = rawStatus
                    notifyKey = id; sourceForNotice = "ETECSA"
                }
                source == "GAMEMARKET" -> {
                    key = "game_recharge_order_status_$id"; status = rawStatus
                    notifyKey = "game-$id"; sourceForNotice = "GAME MARKET"
                }
                source == "CART" -> {
                    key = "cart_order_status_$id"; status = rawStatus
                    notifyKey = "cart-$id"; sourceForNotice = "CARRITO"
                }
                source == "WALLET" -> {
                    key = "wallet_topup_status_$id"; status = if (review) "REVIEW" else rawStatus
                    notifyKey = "wallet-$id"; sourceForNotice = "WALLET"
                }
                source == "WALLET_MOVEMENT" && referenceType == "WALLET_TOPUP" && referenceId.isNotBlank() && rawStatus == "CREDIT" -> {
                    // Successful top-ups are represented in history by their CREDIT ledger movement.
                    // Reuse the top-up status key so the pending -> credited transition is one event.
                    key = "wallet_topup_status_$referenceId"; status = "COMPLETED"
                    notifyKey = "wallet-$referenceId"; sourceForNotice = "WALLET"
                }
                else -> continue
            }
            val previous = prefs.getString(key, "").orEmpty()
            if (previous.isNotBlank() && previous != status) {
                val amount = entry.optDouble("amount_cup", Double.NaN)
                val amountText = if (amount.isFinite()) " · ${amount.toLong()} CUP" else ""
                val title: String
                val message: String
                if (status == "REVIEW") {
                    title = "Pago en revisión"
                    message = "Detectamos un posible pago$amountText. Estamos verificándolo. No vuelvas a pagar; contacta con soporte si el estado no cambia."
                } else if (sourceForNotice == "WALLET" && status == "COMPLETED") {
                    title = "Wallet acreditada"
                    message = "Tu recarga fue confirmada y el saldo quedó disponible$amountText."
                } else {
                    val detail = when (status) {
                        "PAYMENT_RECEIVED_WAITING_DETAILS" -> "Pago recibido; faltan datos para continuar."
                        "SUBMITTING_TO_PROVIDER", "SUBMITTING_TO_SOKY", "PROCESSING" -> "Pago confirmado; la compra está en proceso."
                        "COMPLETED" -> "Tu compra se completó correctamente."
                        "FULFILLMENT_REVIEW", "REFUND_REQUIRED" -> "La compra requiere revisión. No vuelvas a pagar; contacta con soporte."
                        "EXPIRED" -> "El ticket expiró sin confirmación dentro del plazo. Si ya pagaste, contacta con soporte y facilita el recibo."
                        "CANCELED", "CANCELLED" -> "La operación fue cancelada."
                        "WAITING_PAYMENT" -> "La operación continúa en espera del pago."
                        else -> "El estado de tu operación cambió a $status."
                    }
                    title = when (status) {
                        "PAYMENT_RECEIVED_WAITING_DETAILS" -> "Pago recibido"
                        "SUBMITTING_TO_PROVIDER", "SUBMITTING_TO_SOKY", "PROCESSING" -> "Compra en proceso"
                        "COMPLETED" -> "Compra completada"
                        "FULFILLMENT_REVIEW", "REFUND_REQUIRED", "REVIEW" -> "Compra requiere atención"
                        "EXPIRED" -> "Ticket vencido"
                        "CANCELED", "CANCELLED" -> "Operación cancelada"
                        else -> "Actualización de compra"
                    }
                    message = detail
                }
                NotificationService.showStoreStatusUpdate(applicationContext, notifyKey, sourceForNotice, title, message)
            }
            editor.putString(key, status)
        }
        editor.putLong(KEY_LAST_SUCCESS_AT, System.currentTimeMillis()).apply()
        Result.success()
    } }

    private fun requestHistory(token: String, deviceId: String): Pair<Int, String> {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("${MainActivity.BACKEND_BASE_URL}/api/store/status").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10000
                readTimeout = 12000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                if (deviceId.isNotBlank()) setRequestProperty("X-Device-ID", deviceId)
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            code to body
        } catch (_: Exception) {
            0 to ""
        } finally {
            connection?.disconnect()
        }
    }

    companion object {
        private val workerMutex = Mutex()
        private const val PERIODIC_NAME = "synthesisone-store-status-poll"
        private const val ONCE_NAME = "synthesisone-store-status-refresh"
        private const val KEY_LAST_SUCCESS_AT = "store_status_worker_last_success_at"

        fun schedule(context: Context) {
            val app = context.applicationContext
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val periodic = PeriodicWorkRequestBuilder<StoreStatusWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints).build()
            WorkManager.getInstance(app).enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.UPDATE, periodic)
            refreshNow(app)
        }

        fun refreshNow(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = OneTimeWorkRequestBuilder<StoreStatusWorker>()
                .setConstraints(constraints).setInitialDelay(15, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(ONCE_NAME, ExistingWorkPolicy.KEEP, request)
        }

        fun seedStatus(context: Context, source: String, id: String, status: String) {
            if (id.isBlank() || status.isBlank()) return
            val normalizedSource = source.uppercase()
            val key = when (normalizedSource) {
                "WALLET" -> "wallet_topup_status_$id"
                "ETECSA" -> "etecsa_order_status_$id"
                "GAMEMARKET", "GAME MARKET" -> "game_recharge_order_status_$id"
                "CART" -> "cart_order_status_$id"
                else -> return
            }
            context.applicationContext.getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(key, status.uppercase()).apply()
            refreshNow(context)
        }
    }
}
