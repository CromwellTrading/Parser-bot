package com.synthesisone.app.service

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Network
import android.os.IBinder
import android.os.SystemClock
import com.synthesisone.app.BuildConfig
import android.util.Log
import com.synthesisone.app.data.AppDatabase
import com.synthesisone.app.data.SmsEntity
import com.synthesisone.app.utils.HmacUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class SyncService : Service() {

    companion object {
        private const val TAG = "SynthesisOne_SYNC"
        private const val NOTIF_ID = 1
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 5_000L
        private const val CONNECT_TIMEOUT = 30_000
        private const val READ_TIMEOUT = 30_000
        private const val BASE_URL = "https://parser-bot-9y8n.onrender.com"

        const val PREFS_NAME = "synthesisone_prefs"
        const val KEY_TOKEN = "client_token"
        // Separate credential slot for store-status jobs. It is intentionally not
        // aliased to the personal automation license token.
        const val KEY_STORE_TOKEN = "store_token"
        const val KEY_STORE_SESSION_SECRET = "store_session_secret"
        const val KEY_STORE_ONLY_SESSION = "store_only_session"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_LICENSE_STATE = "license_state"
        const val KEY_LICENSE_ACTIVATED_AT = "license_activated_at"
        const val KEY_LICENSE_EXPIRES_AT = "license_expires_at"
        const val KEY_LAST_SYNC_AT = "last_sync_at"
        const val KEY_LAST_SYNC_STATUS = "last_sync_status"
        const val KEY_LAST_SYNC_ERROR = "last_sync_error"
        const val KEY_ACTIVATION_ID = "activation_id"
        const val KEY_ACTIVATION_SECRET = "activation_secret"
        const val KEY_ACTIVATION_STATE = "activation_state"
        const val KEY_ACTIVATION_CREATED_AT = "activation_created_at"
        const val KEY_ACTIVATION_PAYMENT_STARTED_AT = "activation_payment_started_at"
        const val KEY_ACTIVATION_PAYMENT_DEADLINE_AT = "activation_payment_deadline_at"
        const val KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT = "activation_confirmation_deadline_at"
        const val KEY_ONBOARDING_LAST_SMS_ID = "onboarding_last_sms_id"

        private fun endpoint() = "$BASE_URL/api/sms/ingest"
        private fun onboardingSmsEndpoint() = "$BASE_URL/api/onboarding/sms"
        private fun onboardingStatusEndpoint() = "$BASE_URL/api/onboarding/status"
        private fun onboardingStartEndpoint() = "$BASE_URL/api/onboarding/start"

        fun scheduleActivationWake(context: Context, delayMs: Long = 60_000L) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getString(KEY_TOKEN, "").orEmpty().isNotBlank()) return
            val state = prefs.getString(KEY_ACTIVATION_STATE, "").orEmpty()
            if (state !in setOf("WAITING_PAYMENT", "WAITING_LATE_CONFIRMATION")) return
            val intent = Intent(context, com.synthesisone.app.receiver.ActivationWakeReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context, 3200, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delayMs.coerceAtLeast(15_000L), pi)
        }

        fun cancelActivationWake(context: Context) {
            val intent = Intent(context, com.synthesisone.app.receiver.ActivationWakeReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context, 3200, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pi)
        }

        fun syncNow(context: Context) {
            context.startForegroundService(Intent(context, SyncService::class.java))
        }
    }

    private data class Result(
        val success: Boolean,
        val code: Int? = null,
        val error: String? = null
    )

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val syncControl = Any()
    private var syncJob: Job? = null
    private var syncRequestedAgain = false
    private var automaticRetryJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate() {
        super.onCreate()
        NotificationService.createChannels(this)
        startForeground(NOTIF_ID, NotificationService.buildServiceNotification(this))
        registerNetworkCallback()
        scope.launch {
            while (isActive) {
                delay(15L * 60L * 1000L)
                if (getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_TOKEN, "").orEmpty().isNotBlank()) {
                    requestSync("maintenance")
                }
            }
        }
        Log.d(TAG, "✅ SyncService iniciado en foreground")
    }

    private fun registerNetworkCallback() {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.i(TAG, "Red disponible; reintentando automáticamente SMS pendientes")
                requestSync("network_available")
            }
            override fun onLost(network: Network) {
                Log.i(TAG, "Red perdida; conserva historial local y actualiza el estado offline")
                requestSync("network_lost")
            }
        }
        try {
            connectivity.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (error: Exception) {
            Log.e(TAG, "No se pudo registrar la escucha de red; el receiver de conectividad seguirá como respaldo", error)
        }
    }

    private fun requestSync(trigger: String) {
        synchronized(syncControl) {
            if (trigger != "automatic_retry" && trigger != "maintenance") {
                automaticRetryJob?.cancel()
                automaticRetryJob = null
            }
            syncRequestedAgain = true
            if (syncJob?.isActive != true) {
                syncJob = scope.launch {
                    while (true) {
                        synchronized(syncControl) { syncRequestedAgain = false }
                        try {
                            Log.d(TAG, "Iniciando sincronización (trigger=$trigger)")
                            sync()
                        } catch (error: Exception) {
                            Log.e(TAG, "Error de sincronización (${error.javaClass.simpleName}); se conservan los SMS locales", error)
                        }
                        val repeat = synchronized(syncControl) {
                            if (syncRequestedAgain) {
                                true
                            } else {
                                syncJob = null
                                false
                            }
                        }
                        if (!repeat) break
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        requestSync("start_command")
        return START_STICKY
    }

    private fun scheduleAutomaticRetry(delayMs: Long) {
        synchronized(syncControl) {
            automaticRetryJob?.cancel()
            automaticRetryJob = scope.launch {
                delay(delayMs)
                synchronized(syncControl) { automaticRetryJob = null }
                requestSync("automatic_retry")
            }
        }
    }

    private suspend fun sync() {
        if (!isOnline()) {
            Log.w(TAG, "Sin internet")
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString(KEY_LAST_SYNC_STATUS, "OFFLINE")
                .apply()
            val offlineDb = AppDatabase.getInstance(this)
            NotificationService.updateSyncHealthNotification(this, offlineDb.smsDao().countPendingAll(), offlineDb.smsDao().getFailed().size, "Sin conexión a Internet")
            return
        }

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val token = prefs.getString(KEY_TOKEN, null)
        val deviceId = prefs.getString(KEY_DEVICE_ID, null).orEmpty()

        // Antes de tener licencia, el único SMS que puede salir es el de la
        // sesión de activación. Este camino permite detectar el primer pago.
        if (token.isNullOrBlank()) {
            bootstrapSync(prefs, deviceId)
            return
        }

        // Verificar si la licencia fue revocada antes de sincronizar
        if (checkIfRevoked(token, deviceId, prefs)) {
            Log.w(TAG, "⛔ Licencia revocada — sincronización detenida")
            return
        }

        pollResellerStatusIfDue(token, deviceId, prefs)
        pollAdminResellerCountIfDue(token, deviceId, prefs)

        val db = AppDatabase.getInstance(this)
        val toSend = (db.smsDao().getPending() + db.smsDao().getFailed()).distinctBy { it.id }

        if (toSend.isEmpty()) {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_AT, System.currentTimeMillis())
                .putString(KEY_LAST_SYNC_STATUS, "IDLE")
                .remove(KEY_LAST_SYNC_ERROR)
                .apply()
            NotificationService.updateSyncHealthNotification(this, 0, 0, null)
            return
        }

        Log.d(TAG, "📋 Enviando: ${toSend.size} SMS")
        var automaticRetryDelayMs = 0L

        for (sms in toSend) {
            db.smsDao().markQueued(sms.id)

            var result = Result(false, error = "Sin intentos")
            var attempt = 0

            // Reintentos automáticos
            while (attempt < MAX_RETRIES) {
                attempt++
                Log.d(TAG, "🔄 Intento $attempt/$MAX_RETRIES para id=${sms.id}")
                result = send(sms, token, deviceId)
                if (result.success) break
                if (attempt < MAX_RETRIES) {
                    Log.w(TAG, "⏳ Reintentando en ${RETRY_DELAY_MS / 1000}s...")
                    delay(RETRY_DELAY_MS)
                }
            }

            val sentAt = System.currentTimeMillis()

            if (result.success) {
                db.smsDao().markSent(sms.id, sentAt)
                NotificationService.showPaymentNotification(this, sms.sender, sms.body, synced = true)
                prefs.edit()
                    .putLong(KEY_LAST_SYNC_AT, sentAt)
                    .putString(KEY_LAST_SYNC_STATUS, "OK")
                    .remove(KEY_LAST_SYNC_ERROR)
                    .apply()
                NotificationService.updateDailyFlow(this)
                Log.d(TAG, "✅ Enviado id=${sms.id} en intento $attempt — ${formatTime(sentAt)}")
            } else {
                db.smsDao().markError(sms.id, result.error)
                prefs.edit()
                    .putLong(KEY_LAST_SYNC_AT, sentAt)
                    .putString(KEY_LAST_SYNC_STATUS, "ERROR")
                    .putString(KEY_LAST_SYNC_ERROR, result.error)
                    .apply()
                Log.e(TAG, "❌ Falló id=${sms.id} tras $attempt intentos: ${result.error}")
                val retryable = result.code == null || result.code == 408 || result.code == 429 || result.code in 500..599
                if (retryable) {
                    val delayForSms = ((sms.attempts + 1).coerceIn(1, 10)) * 30_000L
                    automaticRetryDelayMs = maxOf(automaticRetryDelayMs, delayForSms)
                }
            }
        }

        // Keep local transaction history indefinitely for offline review. Cleanup, if ever added, must be explicit and user-controlled.
        val remaining = db.smsDao().countPendingAll()
        val remainingErrors = db.smsDao().getFailed().size
        val lastError = prefs.getString(KEY_LAST_SYNC_ERROR, null)
        NotificationService.updateSyncHealthNotification(this, remaining, remainingErrors, lastError)
        if (automaticRetryDelayMs > 0L) {
            Log.w(TAG, "Quedaron SMS pendientes; nuevo intento automático en ${automaticRetryDelayMs / 1000}s")
            scheduleAutomaticRetry(automaticRetryDelayMs)
        }
    }

    private fun pollResellerStatusIfDue(token: String, deviceId: String, prefs: android.content.SharedPreferences) {
        val now = System.currentTimeMillis()
        val last = prefs.getLong("so_reseller_status_poll_at", 0L)
        if (now - last < 15L * 60L * 1000L) return
        val response = authenticatedGet("$BASE_URL/api/game-market/reseller/status", token, deviceId) ?: return
        if (response.first !in 200..299) return
        val json = runCatching { JSONObject(response.second) }.getOrNull() ?: return
        val app = json.optJSONObject("application")
        val reseller = json.optJSONObject("reseller")
        val status = app?.optString("status", "")?.takeIf { it.isNotBlank() }
            ?: reseller?.optString("status", "not_reseller") ?: "not_reseller"
        val previous = prefs.getString("so_reseller_status_last_seen", "").orEmpty()
        if (previous.isNotBlank() && previous != status) {
            val note = app?.optString("review_note", "").orEmpty()
            val title: String
            val message: String
            val success: Boolean
            when (status) {
                "approved_awaiting_deposit" -> { title = "KYC SO Reseller aprobado"; message = "El KYC fue aprobado. El equipo todavía debe comprobar el depósito de trabajo de 50.000 CUP."; success = true }
                "active" -> { title = "SO Reseller activado"; message = "Tus precios especiales están activos. Abre Game Market con Internet para actualizarlos."; success = true }
                "changes_requested" -> { title = "SO Reseller · faltan correcciones"; message = note.ifBlank { "Abre Ajustes para consultar los documentos que debes corregir." }; success = false }
                "rejected" -> { title = "Solicitud SO Reseller revisada"; message = note.ifBlank { "Consulta el estado de tu solicitud en Ajustes." }; success = false }
                "pending_review" -> { title = "SO Reseller en revisión"; message = "La revisión manual suele responder en 24–48 horas."; success = true }
                "suspended", "expired" -> { title = "SO Reseller no activo"; message = "Tu estado actual es $status. Consulta Ajustes o soporte."; success = false }
                else -> { title = "Estado SO Reseller actualizado"; message = "Estado actual: $status"; success = status == "active" }
            }
            NotificationService.showAppEventNotification(this, title, message, "so-reseller-status-$status", success)
        }
        prefs.edit().putLong("so_reseller_status_poll_at", now).putString("so_reseller_status_last_seen", status).apply()
    }

    private fun pollAdminResellerCountIfDue(token: String, deviceId: String, prefs: android.content.SharedPreferences) {
        if (!prefs.getString("client_role", "client").equals("admin", true)) return
        val now = System.currentTimeMillis()
        val last = prefs.getLong("so_admin_reseller_count_poll_at", 0L)
        if (now - last < 15L * 60L * 1000L) return
        val response = authenticatedGet("$BASE_URL/api/game-market/admin/reseller/pending-count", token, deviceId) ?: return
        if (response.first !in 200..299) return
        val json = runCatching { JSONObject(response.second) }.getOrNull() ?: return
        val count = json.optInt("pending_count", 0)
        val seen = prefs.getInt("so_admin_reseller_pending_seen", -1)
        if (seen >= 0 && count > seen) {
            NotificationService.showAppEventNotification(this, "Nueva solicitud SO Reseller", "Hay ${count - seen} solicitud(es) pendiente(s) de revisión KYC.", "so-admin-reseller-$count", true)
        }
        prefs.edit().putLong("so_admin_reseller_count_poll_at", now).putInt("so_admin_reseller_pending_seen", count).apply()
    }

    private fun authenticatedGet(urlText: String, token: String, deviceId: String): Pair<Int, String>? {
        return try {
            val connection = (URL(urlText).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 6500
                readTimeout = 6500
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
                if (deviceId.isNotBlank()) setRequestProperty("X-Device-ID", deviceId)
            }
            try {
                val code = connection.responseCode
                val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                code to body
            } finally { connection.disconnect() }
        } catch (e: Exception) {
            Log.d(TAG, "Polling de estado omitido por red no disponible (${e.javaClass.simpleName})")
            null
        }
    }

    private suspend fun bootstrapSync(
        prefs: android.content.SharedPreferences,
        deviceId: String
    ) {
        val activationId = prefs.getString(KEY_ACTIVATION_ID, null).orEmpty()
        val activationSecret = prefs.getString(KEY_ACTIVATION_SECRET, null).orEmpty()
        val phone = prefs.getString("phone_number", null).orEmpty()
        val activationState = prefs.getString(KEY_ACTIVATION_STATE, "").orEmpty()
        val paymentStartedAt = prefs.getLong(KEY_ACTIVATION_PAYMENT_STARTED_AT, 0L)
        if (activationId.isBlank() || activationSecret.isBlank() || phone.isBlank() || deviceId.isBlank()) return
        if (activationState !in setOf("WAITING_PAYMENT", "WAITING_LATE_CONFIRMATION")) return
        if (paymentStartedAt <= 0L) return
        scheduleActivationWake(this, 60_000L)

        // Primero intenta recuperar el token por si el SMS anterior sí fue
        // procesado pero la respuesta HTTP se perdió.
        val recovered = fetchOnboardingStatus(activationId, activationSecret)
        if (recovered?.state != null) {
            prefs.edit().apply {
                putString(KEY_ACTIVATION_STATE, recovered.state)
                recovered.paymentStartedAt?.let { putLong(KEY_ACTIVATION_PAYMENT_STARTED_AT, it) }
                recovered.paymentDeadlineAt?.let { putLong(KEY_ACTIVATION_PAYMENT_DEADLINE_AT, it) }
                recovered.confirmationDeadlineAt?.let { putLong(KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, it) }
            }.apply()
        }
        if (recovered?.token != null) {
            saveAutoToken(prefs, recovered.token, deviceId, recovered.expiresAt)
            return
        }

        val db = AppDatabase.getInstance(this)
        val config = fetchBootstrapPaymentConfig() ?: return

        // Defensa en profundidad: aunque el backend vuelva a validar todo,
        // el cliente NO debe enviar al endpoint sin token ningún SMS que no
        // parezca ser exactamente el pago de activación configurado.
        val candidates = (db.smsDao().getPending() + db.smsDao().getFailed())
            .distinctBy { it.id }
            .filter {
                val createdAt = prefs.getLong(KEY_ACTIVATION_CREATED_AT, 0L)
                (createdAt <= 0L || it.receivedAt >= createdAt) &&
                    isLicenseBootstrapCandidate(it, config, phone)
            }
            .sortedByDescending { it.receivedAt }

        // No excluir el último ID si una versión anterior lo marcó aunque el POST
        // fallara: ese bug dejaba el pago de activación sin posibilidad de reintento.
        val sms = candidates.firstOrNull() ?: return

        val result = sendBootstrap(sms, activationId, activationSecret, phone, deviceId)

        if (result.token != null) {
            prefs.edit().putLong(KEY_ONBOARDING_LAST_SMS_ID, sms.id).apply()
            saveAutoToken(prefs, result.token, deviceId, result.expiresAt)
            db.smsDao().markSent(sms.id, System.currentTimeMillis())
            Log.d(TAG, "✅ Pago inicial detectado — token recibido automáticamente")
            sendBroadcast(Intent("com.synthesisone.app.LICENSE_ACTIVATED"))
        }
    }

    private data class BootstrapPaymentConfig(
        val amount: Double,
        val currency: String,
        val card: String
    )

    private fun fetchBootstrapPaymentConfig(): BootstrapPaymentConfig? {
        return try {
            val url = URL("$BASE_URL/api/onboarding/config")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 5_000
            conn.readTimeout = 5_000
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText().orEmpty()
            if (code !in 200..299) return null
            val root = JSONObject(body)
            if (!root.optBoolean("configured", false)) return null
            val payment = root.optJSONObject("payment") ?: return null
            val amount = if (payment.has("amount") && !payment.isNull("amount")) payment.optDouble("amount") else return null
            val currency = payment.optString("currency", "CUP").trim().uppercase()
            val card = payment.optString("card", "").filter { it.isDigit() || it.equals('X', true) }
            if (amount <= 0.0 || card.isBlank()) return null
            BootstrapPaymentConfig(amount, currency, card)
        } catch (_: Exception) {
            null
        }
    }

    private fun normalizeBootstrapCard(value: String?): String {
        return value.orEmpty().uppercase().filter { it.isDigit() || it == 'X' }
    }

    private fun bootstrapCardMatches(actualValue: String?, expectedValue: String?): Boolean {
        val actual = normalizeBootstrapCard(actualValue)
        val expected = normalizeBootstrapCard(expectedValue)
        if (actual.isBlank() || expected.isBlank() || actual.length != expected.length) return false
        for (i in expected.indices) {
            val e = expected[i]
            val a = actual[i]
            if (e != 'X' && a != 'X' && e != a) return false
        }
        return true
    }

    private fun normalizeBootstrapPhone(value: String?): String = value.orEmpty().filter { it.isDigit() }.let { digits ->
        if (digits.length == 10 && digits.startsWith("53")) digits.drop(2) else digits
    }

    private fun extractBootstrapTransferAmount(sms: SmsEntity): Double? {
        val text = sms.body
        val patterns = listOf(
            Regex("(?i)\\bMonto\\s*[:\\-]?\\s*([0-9.,]+)\\s*CUP"),
            Regex("(?i)\\bMonto\\s*[:\\-]?\\s*([0-9.,]+)"),
            Regex("(?i)\\bImporte\\s+(?:Recargado|Transferido)\\s*[:\\-]?\\s*([0-9.,]+)\\s*CUP")
        )
        for (pattern in patterns) {
            val raw = pattern.find(text)?.groupValues?.getOrNull(1) ?: continue
            val normalized = raw.replace(",", ".")
            normalized.toDoubleOrNull()?.let { return it }
        }
        return sms.amount
    }

    private fun isLicenseBootstrapCandidate(sms: SmsEntity, config: BootstrapPaymentConfig, registeredPhone: String): Boolean {
        if (!sms.direction.equals("ENVIADO", ignoreCase = true)) return false
        if (sms.type !in setOf("TARJETA_TARJETA", "MONEDERO_TARJETA")) return false
        if (sms.receiverAccount.isNullOrBlank()) return false
        if (!bootstrapCardMatches(sms.receiverAccount, config.card)) return false
        if (!sms.currency.equals(config.currency, ignoreCase = true)) return false
        if (!sms.senderPhone.isNullOrBlank() && normalizeBootstrapPhone(sms.senderPhone) != normalizeBootstrapPhone(registeredPhone)) return false
        val amount = extractBootstrapTransferAmount(sms) ?: return false
        return kotlin.math.abs(amount - config.amount) <= 0.01
    }

    private data class BootstrapResult(
        val token: String? = null,
        val expiresAt: Long? = null,
        val activated: Boolean = false,
        val state: String? = null,
        val paymentStartedAt: Long? = null,
        val paymentDeadlineAt: Long? = null,
        val confirmationDeadlineAt: Long? = null
    )

    private fun sendBootstrap(
        sms: SmsEntity,
        activationId: String,
        activationSecret: String,
        phone: String,
        deviceId: String
    ): BootstrapResult {
        return try {
            val payload = JSONObject().apply {
                put("activation_id", activationId)
                put("sender", sms.sender)
                put("body", sms.body)
                put("receivedAt", sms.receivedAt)
                if (sms.transactionAt != null) put("transactionAt", sms.transactionAt)
                put("smsId", sms.id.toString())
                put("deviceId", deviceId)
                put("phone_number", phone)
            }.toString()

            val sig = HmacUtils.sign(payload, activationSecret)
            val conn = URL(onboardingSmsEndpoint()).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Signature", sig)
            conn.setRequestProperty("X-Activation-Secret", activationSecret)
            conn.doOutput = true
            conn.connectTimeout = CONNECT_TIMEOUT
            conn.readTimeout = READ_TIMEOUT
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText().orEmpty()
            val json = runCatching { JSONObject(body) }.getOrNull()
            val token = json?.optString("token", "")?.takeIf { it.isNotBlank() }
            val expiresAt = parseIsoDate(json?.optJSONObject("client")?.optString("expires_at", null))
            BootstrapResult(token = token, expiresAt = expiresAt, activated = json?.optBoolean("activated", false) == true)
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo enviar SMS de activación (${e.javaClass.simpleName})")
            BootstrapResult()
        }
    }

    private fun saveActivationTiming(prefs: android.content.SharedPreferences, activation: JSONObject) {
        val state = activation.optString("status", "")
        val edit = prefs.edit()
        if (state.isNotBlank()) edit.putString(KEY_ACTIVATION_STATE, state)
        parseIsoDate(activation.optString("payment_started_at", ""))?.let { edit.putLong(KEY_ACTIVATION_PAYMENT_STARTED_AT, it) }
        parseIsoDate(activation.optString("payment_deadline_at", ""))?.let { edit.putLong(KEY_ACTIVATION_PAYMENT_DEADLINE_AT, it) }
        parseIsoDate(activation.optString("confirmation_deadline_at", ""))?.let { edit.putLong(KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, it) }
        edit.apply()
    }

    private fun parseIsoDate(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssZ"
        )
        for (fmt in formats) {
            runCatching {
                java.text.SimpleDateFormat(fmt, java.util.Locale.US).parse(iso)?.time
            }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun fetchOnboardingStatus(activationId: String, activationSecret: String): BootstrapResult? {
        return try {
            val url = URL("${onboardingStatusEndpoint()}?activation_id=${java.net.URLEncoder.encode(activationId, "UTF-8")}")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("X-Activation-Secret", activationSecret)
            conn.connectTimeout = 5_000
            conn.readTimeout = 5_000
            val code = conn.responseCode
            if (code !in 200..299) return null
            val body = conn.inputStream.bufferedReader().readText()
            val json = JSONObject(body)
            val activation = json.optJSONObject("activation") ?: return null
            val token = activation.optString("token", "").takeIf { it.isNotBlank() }
            val expiresAt = parseIsoDate(activation.optJSONObject("client")?.optString("expires_at", null))
            BootstrapResult(
                token = token,
                expiresAt = expiresAt,
                activated = activation.optString("status", "").equals("ACTIVATED", true),
                state = activation.optString("status", null),
                paymentStartedAt = parseIsoDate(activation.optString("payment_started_at", null)),
                paymentDeadlineAt = parseIsoDate(activation.optString("payment_deadline_at", null)),
                confirmationDeadlineAt = parseIsoDate(activation.optString("confirmation_deadline_at", null))
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun saveAutoToken(
        prefs: android.content.SharedPreferences,
        token: String,
        deviceId: String,
        expiresAt: Long?
    ) {
        val now = System.currentTimeMillis()
        prefs.edit().apply {
            putString(KEY_TOKEN, token)
            putString(KEY_DEVICE_ID, deviceId)
            putBoolean("activated", true)
            putString(KEY_LICENSE_STATE, "ACTIVE")
            putLong(KEY_LICENSE_ACTIVATED_AT, now)
            if (expiresAt != null) putLong(KEY_LICENSE_EXPIRES_AT, expiresAt)
            remove(KEY_LAST_SYNC_ERROR)
            putString(KEY_LAST_SYNC_STATUS, "LICENSE_ACTIVATED")
            remove(KEY_ACTIVATION_ID)
            remove(KEY_ACTIVATION_SECRET)
            remove(KEY_ACTIVATION_STATE)
            remove(KEY_ACTIVATION_CREATED_AT)
            remove(KEY_ACTIVATION_PAYMENT_STARTED_AT)
            remove(KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
            remove(KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
            remove(KEY_ONBOARDING_LAST_SMS_ID)
        }.apply()
        cancelActivationWake(this)
        NotificationService.showLicenseActivatedNotificationOnce(this, token)
    }

    /**
     * Verifica con el backend si el token/licencia fue revocado.
     * Si lo fue: limpia el token local, marca el estado como REVOKED,
     * notifica al resto de la app vía broadcast, y retorna true.
     * Si hay error de conexión, no bloquea la sincronización (retorna false).
     */
    private fun checkIfRevoked(
        token: String,
        deviceId: String,
        prefs: android.content.SharedPreferences
    ): Boolean {
        return try {
            val url = URL("$BASE_URL/api/auth/verify")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 5_000
            conn.readTimeout = 5_000

            val payload = JSONObject().apply {
                put("device_id", deviceId)
                put("phone_number", prefs.getString("phone_number", "").orEmpty())
            }.toString()
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(payload.toByteArray()) }
            val code = conn.responseCode

            if (code == 403) {
                val body = runCatching {
                    conn.errorStream?.bufferedReader()?.readText().orEmpty()
                }.getOrNull().orEmpty()

                val parsed = runCatching { JSONObject(body) }.getOrNull()
                val status = parsed?.optString("status", "")?.lowercase().orEmpty()

                // El backend devuelve status: "inactive" o "expired" en clientProfile.js
                // tratamos ambos como señal de que ya no debe sincronizar
                if (status == "inactive" || status == "expired" || body.lowercase().contains("revocad")) {
                    prefs.edit()
                        .putString(KEY_LICENSE_STATE, "REVOKED")
                        .remove(KEY_TOKEN)
                        .remove(KEY_ACTIVATION_ID)
                        .remove(KEY_ACTIVATION_SECRET)
                        .remove(KEY_ACTIVATION_STATE)
                        .remove(KEY_ACTIVATION_CREATED_AT)
                        .remove(KEY_ACTIVATION_PAYMENT_STARTED_AT)
                        .remove(KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
                        .remove(KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
                        .apply()
                    sendBroadcast(Intent("com.synthesisone.app.LICENSE_REVOKED"))
                    true
                } else {
                    false
                }
            } else {
                false
            }
        } catch (e: Exception) {
            // Error de conexión — no bloquea la sincronización, se reintenta la próxima vez
            Log.w(TAG, "No se pudo verificar estado de licencia (${e.javaClass.simpleName})")
            false
        }
    }

    private fun send(sms: SmsEntity, token: String, deviceId: String): Result {
        return try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val messageId = stableMessageId(sms)
            val payload = JSONObject().apply {
                put("sender", sms.sender)
                put("body", sms.body)
                put("receivedAt", sms.receivedAt)
                if (sms.transactionAt != null) put("transactionAt", sms.transactionAt)
                put("device_id", deviceId)
                put("phone_number", prefs.getString("phone_number", "").orEmpty())
                put("message_id", messageId)
                put("sms_status", sms.status)
                put("attempts", sms.attempts)
                put("app_version", BuildConfig.VERSION_NAME)
            }.toString()

            val sig = HmacUtils.sign(payload, token)
            val conn = URL(endpoint()).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("X-Signature", sig)
            conn.doOutput = true
            conn.connectTimeout = CONNECT_TIMEOUT
            conn.readTimeout = READ_TIMEOUT
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val resp = runCatching {
                (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText()
            }.getOrNull().orEmpty()

            // No registrar ni propagar el cuerpo de error: puede contener URLs, hosts
            // u otros detalles internos del servidor.
            Log.d(TAG, "📬 Respuesta HTTP: $code")
            if (code in 200..299) {
                Result(true, code)
            } else {
                Result(false, code, "No se pudo conectar con el servidor.")
            }
        } catch (e: Exception) {
            // El detalle técnico queda fuera de la UI y de SharedPreferences.
            Log.w(TAG, "Error enviando SMS (${e.javaClass.simpleName})")
            Result(false, error = "No se pudo conectar con el servidor.")
        }
    }

    private fun stableMessageId(sms: SmsEntity): String {
        val seed = "${sms.sender}\u001f${sms.receivedAt}\u001f${sms.body}"
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(seed.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun formatTime(ms: Long): String {
        return java.text.SimpleDateFormat("dd/MM/yy HH:mm:ss", java.util.Locale.getDefault())
            .format(java.util.Date(ms))
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (!prefs.getBoolean("monitoring_enabled", true)) {
                super.onTaskRemoved(rootIntent)
                return
            }
            val restartIntent = Intent(applicationContext, com.synthesisone.app.receiver.ServiceRestartReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                applicationContext,
                2002,
                restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + 5_000,
                pi
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error reprogramando SyncService (${e.javaClass.simpleName})")
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        val callback = networkCallback
        if (callback != null) {
            runCatching {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(callback)
            }
        }
        networkCallback = null
        automaticRetryJob?.cancel()
        automaticRetryJob = null
        scope.cancel()
        super.onDestroy()
    }
}
