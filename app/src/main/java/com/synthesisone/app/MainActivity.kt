package com.synthesisone.app

import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.Manifest
import android.view.animation.DecelerateInterpolator
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.*
import android.graphics.drawable.*
import android.os.*
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.view.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.synthesisone.app.data.AppDatabase
import com.synthesisone.app.data.SmsEntity
import com.synthesisone.app.receiver.DailyReportReceiver
import com.synthesisone.app.service.NotificationService
import com.synthesisone.app.service.SyncService
import com.synthesisone.app.service.StoreStatusWorker
import com.synthesisone.app.utils.SmsParser
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.io.File
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    companion object {
        var BG       = Color.parseColor("#070A12")
        var SURFACE  = Color.parseColor("#101522")
        var SURFACE2 = Color.parseColor("#171C2B")
        var RED      = Color.parseColor("#8357FF") // Primary SO violet
        var PURPLE   = Color.parseColor("#19D6C5") // Secondary cyan/teal
        var GREEN    = Color.parseColor("#35E6A5")
        var ERR      = Color.parseColor("#FF5C7A")
        var MUTED    = Color.parseColor("#7D879F")
        var TEXT     = Color.parseColor("#F3F5FF")
        var TEXT2    = Color.parseColor("#A4ADC5")
        var BLUE     = Color.parseColor("#5CCEFF")
        const val BACKEND_BASE_URL = "https://parser-bot-9y8n.onrender.com"
        private const val REQUEST_EXPORT_CSV = 7410
        private const val REQUEST_APP_UNLOCK = 7411
        private const val REQUEST_PROFILE_PHOTO = 7412
        private const val REQUEST_GAME_IMAGE = 7413
        private const val REQUEST_RESELLER_ID_FRONT = 7414
        private const val REQUEST_RESELLER_ID_BACK = 7415
        private const val REQUEST_RESELLER_SELFIE = 7416
        private const val REQUEST_APP_UPDATE_APK = 7417
        private const val REQUEST_INSTALL_PERMISSION = 7418
        private const val PREF_SELECTED_PAYMENT_DESTINATION = "so_selected_payment_destination_id"
        private const val PREF_PROFILE_AVATAR_URL = "so_profile_avatar_url"
        private const val PREF_PROFILE_SYNC_PENDING = "so_profile_sync_pending"
        private const val PREF_PROFILE_AVATAR_PENDING = "so_profile_avatar_pending"
        private const val PREF_PROFILE_DISPLAY_NAME_PUBLIC = "so_profile_display_name_public"
        private const val PREF_PROFILE_AVATAR_PUBLIC = "so_profile_avatar_public"
        private const val PREF_PROFILE_AGE_PUBLIC = "so_profile_age_public"
        private const val PREF_PROFILE_LOCATION_PUBLIC = "so_profile_location_public"
        private const val PREF_RESELLER_ID_FRONT_URI = "so_reseller_id_front_uri"
        private const val PREF_RESELLER_ID_BACK_URI = "so_reseller_id_back_uri"
        private const val PREF_RESELLER_SELFIE_URI = "so_reseller_selfie_uri"
        private const val PREF_RESELLER_STATUS_LAST_SEEN = "so_reseller_status_last_seen"
        private const val PREF_RESELLER_DEPOSIT_LAST_SEEN = "so_reseller_deposit_payment_status_last_seen"
        private const val PREF_ADMIN_RESELLER_PENDING_SEEN = "so_admin_reseller_pending_seen"
        private const val SO_SUPPORT_WHATSAPP = "5359190241"
        private const val APP_LOCK_BACKGROUND_AT = "app_lock_background_at"
        private const val PREF_HIDE_SENSITIVE = "hide_sensitive_data"
        private const val PREF_SO_ASSISTANT_FLOATING = "so_assistant_floating_enabled"
        private const val PREF_SO_ASSISTANT_TUTOR_SEEN = "so_assistant_first_visit_tutor_seen"
        private const val PREF_SO_ASSISTANT_SEEN_INSIGHTS = "so_assistant_seen_insight_ids"
        private const val PREF_SO_ASSISTANT_CONTEXT_TIPS = "so_assistant_context_tips_seen"
        private const val PREF_SO_ASSISTANT_SPONTANEOUS = "so_assistant_spontaneous_enabled"
        private const val PREF_SO_ASSISTANT_SPONTANEOUS_DAY = "so_assistant_spontaneous_day"
        private const val SO_ASSISTANT_INSIGHTS_POLL_MS = 180_000L
        private const val PREF_APP_LOCK = "app_lock_enabled"
        private const val PREF_THEME = "so_theme"
        private const val PREF_LAYOUT_STYLE = "so_layout_style"
        private const val PREF_LAYOUT_SYNC_PENDING = "so_layout_sync_pending"
        private const val PREF_PROFILE_NAME = "so_profile_name"
        private const val PREF_PROFILE_USERNAME = "so_profile_username"
        private const val PREF_PROFILE_PHOTO_URI = "so_profile_photo_uri"
        private const val PREF_PROFILE_PROVINCE = "so_profile_province"
        private const val PREF_PROFILE_MUNICIPALITY = "so_profile_municipality"
        private const val PREF_PROFILE_AGE = "so_profile_age"
        private const val PREF_GAME_CATALOG = "so_game_catalog_json"
        private const val PREF_RATE_USD_CUP = "so_rate_usd_cup"
        private const val PREF_RATE_USD_SALDO = "so_rate_usd_saldo"
        private const val PREF_MARKET_MARGIN = "so_market_margin_pct"
        private const val PREF_MARKET_ROUNDING = "so_market_rounding_cup"
        private const val PREF_MARKET_OFFER_SORT = "so_market_offer_sort"
        private const val PREF_REWARDS_FIRST_INSTALL_MS = "so_rewards_first_install_ms"
        private const val PREF_REWARDS_DASHBOARD_CACHE = "so_rewards_dashboard_cache"
        private const val PREF_REWARDS_WELCOME_STARTED_AT = "so_rewards_welcome_started_at"
        private const val PREF_REWARDS_FEATURE_AVAILABLE = "so_rewards_feature_available"
        private const val PREF_CART_FEATURE_AVAILABLE = "so_cart_feature_available"
        private const val PREF_CART_ITEMS = "so_store_cart_items"
        private const val PREF_CART_IDEMPOTENCY_KEY = "so_store_cart_idempotency_key"
        fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
    }

    private val PERMISSIONS = arrayOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.POST_NOTIFICATIONS
    )
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())
    private var currentFilter = "ALL"
    private var managementPeriod = "TODAY"
    private var managementDirection = "ALL"
    private var managementType = "ALL"
    private var managementHistoryExpanded = false
    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var rootFrame: FrameLayout
    private lateinit var smsList: LinearLayout
    private lateinit var econContainer: LinearLayout
    private lateinit var smsCountLabel: TextView
    private var activationCountdownView: TextView? = null
    private var supportScreenActive = false
    private var supportRefreshInFlight = false
    private var supportMessagesContainer: LinearLayout? = null
    private var supportMessagesScroll: ScrollView? = null
    private var supportStatusView: TextView? = null
    private var supportPollRunnable: Runnable? = null
    private var assistantScreenActive = false
    private var assistantMessagesContainer: LinearLayout? = null
    private var assistantMessagesScroll: ScrollView? = null
    private var assistantStatusView: TextView? = null
    private val assistantHistory = mutableListOf<Pair<String, String>>()
    private var assistantHistoryOwner = ""
    private var assistantAlertView: View? = null
    private var assistantAlertDismiss: Runnable? = null
    private var assistantLauncherView: View? = null
    private var assistantHeaderAvatarFrame: View? = null
    private var assistantHeaderMoodBadge: TextView? = null
    private var assistantMoodView: TextView? = null
    private var assistantSpontaneousRunnable: Runnable? = null
    private var assistantDashboardSection = "home"
    private var assistantInsightsPollInFlight = false
    private var assistantInsightsLastPollAt = 0L
    private var smsRefreshInFlight = false
    private var smsRefreshQueued = false
    private var lastRenderedSmsSignature = "__NOT_RENDERED__"
    private var lastLicenseStatusCheckAt = 0L
    private var lastOnboardingStatusCheckAt = 0L
    private var licenseStatusCheckInFlight = false
    private var dashboardOverview: LinearLayout? = null
    private var dashboardHealth: LinearLayout? = null
    private var dashboardOverviewInFlight = false
    private var dashboardLastRefreshAt = 0L
    private var dashboardRenderSignature = ""
    private var dashboardRecent: LinearLayout? = null
    private var dashboardRecentInFlight = false
    private var dashboardRecentSignature = ""
    private var pendingCsvContent: String? = null
    private var appLockPromptRunning = false
    private var profilePhotoPreview: ImageView? = null
    private var pendingGameEditorImageUri: String? = null
    private var pendingGameEditorPreview: ImageView? = null
    private var gameCatalog: List<GameCatalogItem> = emptyList()
    private var marketSectionView: LinearLayout? = null
    private var networkStatusBanner: TextView? = null
    private var resellerStatusPollAt = 0L
    private var welcomeCountdownRunnable: Runnable? = null
    private var welcomePromoCard: LinearLayout? = null
    private var welcomePromoCountdownView: TextView? = null
    private var rewardsDialogShowing = false
    private var selectedActivationDestinationId: String = ""
    private var startupUpdateCheckDone = false
    private var awaitingInstallPermission = false
    private var pendingUpdateInstallPrompt = false
    private var pendingDownloadedUpdate: File? = null
    private var rewardsDialog: AlertDialog? = null
    private var cartDialog: AlertDialog? = null
    private val resellerPhotoStatusViews = mutableMapOf<Int, TextView>()
    private val resellerPhotoPreviewViews = mutableMapOf<Int, ImageView>()
    private val resellerPhotoCardViews = mutableMapOf<Int, View>()
    private val resellerPhotoButtonViews = mutableMapOf<Int, Button>()

    private data class ManagementStats(
        val from: Long,
        val to: Long,
        val totalIn: Double,
        val totalOut: Double,
        val countIn: Int,
        val countOut: Int,
        val transfersIn: Double,
        val transfersOut: Double,
        val transferCountIn: Int,
        val transferCountOut: Int,
        val uniqueCounterparties: Int,
        val counterparties: List<CounterpartyStat>,
        val history: List<Pair<SmsEntity, SmsParser.ParsedSms>>
    ) {
        val net: Double get() = totalIn - totalOut
        val operationCount: Int get() = countIn + countOut
        val volume: Double get() = totalIn + totalOut
    }

    private data class CounterpartyStat(
        val phone: String,
        val amount: Double,
        val count: Int
    )

    // Catálogo y ofertas modelados para presentar la respuesta central del backend; no se guardan precios en caché local.
    private data class GameOfferItem(
        val id: String = UUID.randomUUID().toString(),
        val title: String,
        val description: String = "",
        val priceCup: Long = 0L,
        val priceSaldo: Long = 0L,
        val baseUsd: Double? = null, // Coste interno opcional; nunca se muestra al comprador.
        val autoPricing: Boolean = false,
        val active: Boolean = true,
        val category: String = "Paquete",
        val available: Boolean = true,
        val published: Boolean = true,
        val packageData: JSONObject = JSONObject(),
        val resellerPriceCup: Long? = null,
        val resellerPriceSaldo: Long? = null,
        val providerConnected: Boolean = false
    )

    private data class GameCatalogItem(
        val name: String,
        val subtitle: String,
        val monogram: String,
        val accent: Int,
        val deepAccent: Int,
        val badge: String,
        val imageUrl: String? = null,
        val id: String = "game-" + name.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "-").trim('-'),
        val imageUri: String? = null,
        val offers: List<GameOfferItem> = emptyList(),
        val description: String = subtitle,
        val thumbnailPath: String? = null,
        val isActive: Boolean = true
    )

    /** Purpose-drawn navigation icons: larger visual footprint, consistent line weight and a soft SO glow. */
    private class NavigationGlyphView(context: Context, private val glyph: String) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            style = Paint.Style.STROKE
        }
        private val path = Path()
        var tint: Int = Color.parseColor("#7D879F")
            set(value) { field = value; invalidate() }

        init { setLayerType(View.LAYER_TYPE_SOFTWARE, null) }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val side = minOf(width, height).toFloat().coerceAtLeast(1f)
            canvas.save()
            canvas.translate((width - side) / 2f, (height - side) / 2f)
            canvas.scale(side / 36f, side / 36f)
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(25, Color.red(tint), Color.green(tint), Color.blue(tint))
            paint.setShadowLayer(7f, 0f, 0f, Color.argb(90, Color.red(tint), Color.green(tint), Color.blue(tint)))
            canvas.drawCircle(18f, 18f, 16f, paint)
            paint.clearShadowLayer()
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2.1f
            paint.color = tint
            when (glyph) {
                "home" -> {
                    path.reset(); path.moveTo(5f, 16f); path.lineTo(18f, 5f); path.lineTo(31f, 16f)
                    path.moveTo(8f, 14f); path.lineTo(8f, 29f); path.lineTo(15f, 29f); path.lineTo(15f, 21f)
                    path.lineTo(21f, 21f); path.lineTo(21f, 29f); path.lineTo(28f, 29f); path.lineTo(28f, 14f)
                    canvas.drawPath(path, paint)
                }
                "activity" -> {
                    canvas.drawCircle(18f, 18f, 12.5f, paint)
                    path.reset(); path.moveTo(18f, 10f); path.lineTo(18f, 18f); path.lineTo(24f, 21f)
                    canvas.drawPath(path, paint)
                    paint.style = Paint.Style.FILL; canvas.drawCircle(18f, 18f, 1.7f, paint)
                }
                "cash" -> {
                    canvas.drawRoundRect(RectF(4.5f, 8f, 31.5f, 28f), 4f, 4f, paint)
                    path.reset(); path.moveTo(5f, 13f); path.lineTo(31f, 13f)
                    canvas.drawPath(path, paint)
                    paint.style = Paint.Style.FILL; canvas.drawCircle(23f, 21f, 2.2f, paint)
                }
                "market" -> {
                    path.reset(); path.moveTo(9f, 11f); path.cubicTo(5f, 11f, 4f, 15f, 4f, 18f)
                    path.lineTo(4f, 23f); path.cubicTo(4f, 28f, 8f, 30f, 11f, 27f)
                    path.lineTo(15f, 23f); path.lineTo(21f, 23f); path.lineTo(25f, 27f)
                    path.cubicTo(28f, 30f, 32f, 28f, 32f, 23f); path.lineTo(32f, 18f)
                    path.cubicTo(32f, 15f, 31f, 11f, 27f, 11f); path.close()
                    canvas.drawPath(path, paint)
                    path.reset(); path.moveTo(10f, 15f); path.lineTo(10f, 21f); path.moveTo(7f, 18f); path.lineTo(13f, 18f)
                    canvas.drawPath(path, paint)
                    paint.style = Paint.Style.FILL; canvas.drawCircle(24f, 16.5f, 1.7f, paint); canvas.drawCircle(27f, 20f, 1.7f, paint)
                }
                else -> {
                    canvas.drawCircle(18f, 18f, 9f, paint)
                    canvas.drawCircle(18f, 18f, 3.7f, paint)
                    for (i in 0..7) {
                        val angle = Math.PI * i / 4.0
                        canvas.drawLine(
                            18f + (10.0 * kotlin.math.cos(angle)).toFloat(),
                            18f + (10.0 * kotlin.math.sin(angle)).toFloat(),
                            18f + (14.0 * kotlin.math.cos(angle)).toFloat(),
                            18f + (14.0 * kotlin.math.sin(angle)).toFloat(), paint
                        )
                    }
                }
            }
            canvas.restore()
        }
    }

    private val gameThumbnailCache = Collections.synchronizedMap(mutableMapOf<String, Bitmap>())

    // No local/demo catalog fallback: sellable products must come from the backend/provider.

    private val activationTicker = object : Runnable {
        override fun run() {
            val view = activationCountdownView ?: return
            val state = prefs.getString(SyncService.KEY_ACTIVATION_STATE, "").orEmpty()
            if (state !in setOf("WAITING_PAYMENT", "WAITING_LATE_CONFIRMATION")) {
                return
            }
            val now = System.currentTimeMillis()
            val deadline = prefs.getLong(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT, 0L)
            val confirmationDeadline = prefs.getLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, 0L)
            val remainingPayment = (deadline - now).coerceAtLeast(0L)
            val remainingConfirmation = (confirmationDeadline - now).coerceAtLeast(0L)
            if (now < deadline) {
                view.text = "⏳ ${formatCountdown(remainingPayment)}"
                view.postDelayed(this, 1_000L)
            } else if (now < confirmationDeadline) {
                view.text = "📩 Pago realizado / esperando confirmación · ${formatCountdown(remainingConfirmation)}"
                view.postDelayed(this, 1_000L)
            } else {
                // La sesión ya terminó. Deja la pantalla en un estado reutilizable
                // y vuelve a mostrar el botón para iniciar un nuevo intento.
                prepareActivationRetryState()
                activationCountdownView = null
                handler.removeCallbacks(this)
                if (!isFinishing) {
                    handler.post { showActivation(showRetryNotice = true) }
                }
            }
        }
    }

    private data class VerificationResult(
        val ok: Boolean,
        val rawBody: String = "",
        val licenseState: String? = null,
        val expiresAt: Long? = null
    )

    private data class PaymentDestination(
        val id: String,
        val label: String,
        val card: String,
        val confirmationPhone: String
    )

    private data class AppRelease(
        val versionCode: Long,
        val versionName: String,
        val releaseNotes: String,
        val publishedAt: String,
        val sha256: String,
        val sizeBytes: Long,
        val downloadEndpoint: String = "/api/app-updates/download"
    )

    private data class PaymentConfig(
        val amount: Double?,
        val currency: String,
        val card: String?,
        val confirmationPhone: String?,
        val durationDays: Int,
        val priceType: String,
        val automationEnabled: Boolean,
        val automationMessage: String,
        val destinationId: String = "",
        val destinations: List<PaymentDestination> = emptyList()
    )

    private data class BackendResponse(val code: Int, val body: String)

    private data class LicenseSnapshot(
        val state: String,
        val activatedAt: Long,
        val expiresAt: Long,
        val deviceId: String,
        val lastSyncAt: Long,
        val lastSyncStatus: String,
        val lastSyncError: String?
    )

    private val refreshRunnable = object : Runnable {
        override fun run() {
            // No volver a reconstruir una lista que no está montada en pantalla.
            if (::smsList.isInitialized && smsList.isAttachedToWindow) refreshSms()
            val now = System.currentTimeMillis()
            val onlineNow = isDeviceOnline()
            networkStatusBanner?.let { banner ->
                val warning = Color.parseColor(if (isLightPalette()) "#995B00" else "#FFC56E")
                val statusColor = if (onlineNow) GREEN else warning
                val statusFill = if (isLightPalette()) blendSurfaceColor(SURFACE2, statusColor, 0.10f) else Color.parseColor(if (onlineNow) "#0F2926" else "#302419")
                val statusEdge = if (isLightPalette()) blendSurfaceColor(statusColor, SURFACE2, 0.38f) else Color.parseColor(if (onlineNow) "#245E53" else "#75542B")
                banner.text = if (onlineNow) "● CONECTADO · los movimientos se sincronizan automáticamente" else "● MODO OFFLINE · historial local disponible; wallet y ofertas desactivadas"
                banner.setTextColor(statusColor)
                banner.background = roundedBackground(statusFill, 11, statusEdge, 1)
            }
            if (!onlineNow && marketSectionView?.visibility == View.VISIBLE) {
                marketSectionView?.removeAllViews()
                marketSectionView?.addView(buildOfflineFeatureCard("Game Market", "Las ofertas solo se consultan con conexión activa. Tus pagos e historial local siguen disponibles."))
            }
            if (prefs.getString(SyncService.KEY_TOKEN, "").orEmpty().isNotBlank() && isDeviceOnline() && now - resellerStatusPollAt >= 60_000L) {
                resellerStatusPollAt = now
                pollResellerStatus(showNotifications = true)
                if (prefs.getString("client_role", "client").equals("admin", true)) pollAdminResellerCount()
            }
            if (prefs.getString(SyncService.KEY_TOKEN, "").orEmpty().isNotBlank() && onlineNow && now - assistantInsightsLastPollAt >= SO_ASSISTANT_INSIGHTS_POLL_MS) {
                assistantInsightsLastPollAt = now
                pollProactiveAssistantInsights()
            }
            if (dashboardOverview?.isAttachedToWindow == true && now - dashboardLastRefreshAt >= 12_000L) {
                dashboardLastRefreshAt = now
                refreshDashboardOverview()
                refreshDashboardRecent()
            }
            if (prefs.getString(SyncService.KEY_TOKEN, "").orEmpty().isBlank()) {
                if (now - lastOnboardingStatusCheckAt >= 12_000L) {
                    lastOnboardingStatusCheckAt = now
                    checkOnboardingStatus()
                }
            } else if (now - lastLicenseStatusCheckAt >= 60_000L) {
                lastLicenseStatusCheckAt = now
                checkLicenseStatus()
            }
            handler.postDelayed(this, 3_000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Apply the saved palette before AppCompat creates its native dialogs, popups and pickers.
        val firstRunTheme = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREF_THEME, "violet").orEmpty()
        applyNativeTheme(firstRunTheme)
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.contains(PREF_REWARDS_FIRST_INSTALL_MS)) {
            val firstInstall = runCatching { packageManager.getPackageInfo(packageName, 0).firstInstallTime }.getOrDefault(System.currentTimeMillis())
            prefs.edit().putLong(PREF_REWARDS_FIRST_INSTALL_MS, firstInstall.takeIf { it > 0L } ?: System.currentTimeMillis()).apply()
        }
        if (!prefs.contains(PREF_LAYOUT_STYLE)) prefs.edit().putString(PREF_LAYOUT_STYLE, "hybrid").apply()
        applyThemePalette()
        loadGameCatalogFromPrefs()
        if (!prefs.contains(PREF_RATE_USD_CUP)) prefs.edit().putInt(PREF_RATE_USD_CUP, 1050).apply()
        if (!prefs.contains(PREF_RATE_USD_SALDO)) prefs.edit().putInt(PREF_RATE_USD_SALDO, 380).apply()
        if (!prefs.contains(PREF_MARKET_ROUNDING)) prefs.edit().putInt(PREF_MARKET_ROUNDING, 5).apply()
        updateSystemBars()
        supportActionBar?.hide()
        rootFrame = FrameLayout(this).apply { setBackgroundColor(BG) }
        setContentView(rootFrame)

        NotificationService.createChannels(this)
        ensureDeviceId()
        ensureLicenseDefaults()

        val savedPhone = prefs.getString("phone_number", "").orEmpty()
        when {
            isStoreOnlySession() -> showDashboard()
            !isValidPhone(savedPhone) -> showPhoneOnboarding()
            !isDeviceOnline() && (prefs.getString(SyncService.KEY_TOKEN, "").orEmpty().isNotBlank() || prefs.getBoolean("activated", false) || hasLocalSmsHistory()) -> {
                // Offline read-only access does not renew or validate a license; it only exposes device-local history.
                showDashboard()
            }
            !isLicenseActive() -> showActivation()
            else -> showDashboard()
        }
    }

    private fun applyNativeTheme(theme: String) {
        val style = when (theme) {
            "light" -> R.style.SynthesisOneThemeLight
            "red" -> R.style.SynthesisOneThemeRed
            "green" -> R.style.SynthesisOneThemeGreen
            "cyan" -> R.style.SynthesisOneThemeCyan
            "gold" -> R.style.SynthesisOneThemeGold
            "ocean" -> R.style.SynthesisOneThemeOcean
            else -> R.style.SynthesisOneThemeDark
        }
        setTheme(style)
    }

    private fun isLightPalette(): Boolean = prefs.getString(PREF_THEME, "violet").orEmpty() == "light"

    private fun luminanceComponent(value: Int): Double {
        val c = value / 255.0
        return if (c <= 0.04045) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
    }

    /** Pick readable text for a filled accent surface (including red/green/cyan themes). */
    private fun contrastingTextColor(background: Int): Int {
        val luminance = 0.2126 * luminanceComponent(Color.red(background)) +
            0.7152 * luminanceComponent(Color.green(background)) +
            0.0722 * luminanceComponent(Color.blue(background))
        val whiteContrast = 1.05 / (luminance + 0.05)
        val darkText = Color.parseColor("#142033")
        val darkContrast = (luminance + 0.05) / (luminanceComponent(Color.red(darkText)) * 0.2126 +
            luminanceComponent(Color.green(darkText)) * 0.7152 + luminanceComponent(Color.blue(darkText)) * 0.0722 + 0.05)
        return if (whiteContrast >= darkContrast) Color.WHITE else darkText
    }

    private fun updateSystemBars() {
        // The root and window backgrounds must follow the selected palette too. Otherwise the
        // uncovered area behind the bottom navigation can retain the old theme's light surface.
        window.statusBarColor = BG
        window.navigationBarColor = BG
        window.setBackgroundDrawable(ColorDrawable(BG))
        if (::rootFrame.isInitialized) rootFrame.setBackgroundColor(BG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) window.navigationBarDividerColor = BG
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        val lightPalette = isLightPalette()
        var flags = window.decorView.systemUiVisibility
        flags = if (lightPalette) {
            flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        } else {
            flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv() and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
        }
        window.decorView.systemUiVisibility = flags
    }

    private fun applyThemePalette() {
        when (prefs.getString(PREF_THEME, "violet")) {
            "light" -> {
                BG = Color.parseColor("#F3F5FB"); SURFACE = Color.parseColor("#FFFFFF"); SURFACE2 = Color.parseColor("#E8ECF5")
                RED = Color.parseColor("#6543D6"); PURPLE = Color.parseColor("#007F91"); GREEN = Color.parseColor("#087B50")
                ERR = Color.parseColor("#C43451"); MUTED = Color.parseColor("#778198"); TEXT = Color.parseColor("#172033")
                TEXT2 = Color.parseColor("#566178"); BLUE = Color.parseColor("#176CC2")
            }
            "red" -> {
                BG = Color.parseColor("#10090F"); SURFACE = Color.parseColor("#1B111A"); SURFACE2 = Color.parseColor("#291822")
                RED = Color.parseColor("#FF426D"); PURPLE = Color.parseColor("#FF94A7"); GREEN = Color.parseColor("#4DE0A5")
                ERR = Color.parseColor("#FF426D"); MUTED = Color.parseColor("#9A7F8D"); TEXT = Color.parseColor("#FFF3F7")
                TEXT2 = Color.parseColor("#D1B8C3"); BLUE = Color.parseColor("#78BEFF")
            }
            "green" -> {
                BG = Color.parseColor("#06100D"); SURFACE = Color.parseColor("#0C1B15"); SURFACE2 = Color.parseColor("#14271F")
                RED = Color.parseColor("#25B981"); PURPLE = Color.parseColor("#62DFC0"); GREEN = Color.parseColor("#43E5A3")
                ERR = Color.parseColor("#FF657A"); MUTED = Color.parseColor("#718F82"); TEXT = Color.parseColor("#F0FFF7")
                TEXT2 = Color.parseColor("#A6C9B8"); BLUE = Color.parseColor("#71D5ED")
            }
            "cyan" -> {
                BG = Color.parseColor("#071017"); SURFACE = Color.parseColor("#101D28"); SURFACE2 = Color.parseColor("#172B38")
                RED = Color.parseColor("#19BFD1"); PURPLE = Color.parseColor("#51E4ED"); GREEN = Color.parseColor("#4AE3AD")
                ERR = Color.parseColor("#FF6689"); MUTED = Color.parseColor("#718E9A"); TEXT = Color.parseColor("#F1FCFF")
                TEXT2 = Color.parseColor("#A5C4D0"); BLUE = Color.parseColor("#5CCEFF")
            }
            "gold" -> {
                BG = Color.parseColor("#120F08"); SURFACE = Color.parseColor("#211A0E"); SURFACE2 = Color.parseColor("#302514")
                RED = Color.parseColor("#E8AC3B"); PURPLE = Color.parseColor("#F3D48A"); GREEN = Color.parseColor("#79D9A4")
                ERR = Color.parseColor("#FF7185"); MUTED = Color.parseColor("#A08B63"); TEXT = Color.parseColor("#FFF8E8")
                TEXT2 = Color.parseColor("#D9CBAA"); BLUE = Color.parseColor("#91C9F5")
            }
            "ocean" -> {
                BG = Color.parseColor("#07121F"); SURFACE = Color.parseColor("#0D2032"); SURFACE2 = Color.parseColor("#143049")
                RED = Color.parseColor("#2587E8"); PURPLE = Color.parseColor("#4EA7FF"); GREEN = Color.parseColor("#36D6BA")
                ERR = Color.parseColor("#FF6D87"); MUTED = Color.parseColor("#7390A8"); TEXT = Color.parseColor("#F1F8FF")
                TEXT2 = Color.parseColor("#A8C1D8"); BLUE = Color.parseColor("#63D3FF")
            }
            else -> {
                BG = Color.parseColor("#070A12"); SURFACE = Color.parseColor("#101522"); SURFACE2 = Color.parseColor("#171C2B")
                RED = Color.parseColor("#8357FF"); PURPLE = Color.parseColor("#19D6C5"); GREEN = Color.parseColor("#35E6A5")
                ERR = Color.parseColor("#FF5C7A"); MUTED = Color.parseColor("#7D879F"); TEXT = Color.parseColor("#F3F5FF")
                TEXT2 = Color.parseColor("#A4ADC5"); BLUE = Color.parseColor("#5CCEFF")
            }
        }
    }

    private fun cubaMunicipalities(): LinkedHashMap<String, List<String>> = linkedMapOf(
        "Pinar del Río" to listOf("Consolación del Sur", "Guane", "La Palma", "Los Palacios", "Mantua", "Minas de Matahambre", "Pinar del Río", "San Juan y Martínez", "San Luis", "Sandino", "Viñales"),
        "Artemisa" to listOf("Alquízar", "Artemisa", "Bahía Honda", "Bauta", "Caimito", "Candelaria", "Guanajay", "Güira de Melena", "Mariel", "San Antonio de los Baños", "San Cristóbal"),
        "La Habana" to listOf("Arroyo Naranjo", "Boyeros", "Centro Habana", "Cerro", "Cotorro", "Diez de Octubre", "Guanabacoa", "Habana del Este", "Habana Vieja", "La Lisa", "Marianao", "Playa", "Plaza de la Revolución", "Regla", "San Miguel del Padrón"),
        "Mayabeque" to listOf("Batabanó", "Bejucal", "Güines", "Jaruco", "Madruga", "Melena del Sur", "Nueva Paz", "Quivicán", "San José de las Lajas", "San Nicolás", "Santa Cruz del Norte"),
        "Matanzas" to listOf("Calimete", "Cárdenas", "Ciénaga de Zapata", "Colón", "Jagüey Grande", "Jovellanos", "Limonar", "Los Arabos", "Martí", "Matanzas", "Pedro Betancourt", "Perico", "Unión de Reyes"),
        "Cienfuegos" to listOf("Abreus", "Aguada de Pasajeros", "Cienfuegos", "Cruces", "Cumanayagua", "Lajas", "Palmira", "Rodas"),
        "Villa Clara" to listOf("Caibarién", "Camajuaní", "Cifuentes", "Corralillo", "Encrucijada", "Manicaragua", "Placetas", "Quemado de Güines", "Ranchuelo", "Remedios", "Sagua la Grande", "Santa Clara", "Santo Domingo"),
        "Sancti Spíritus" to listOf("Cabaiguán", "Fomento", "Jatibonico", "La Sierpe", "Sancti Spíritus", "Taguasco", "Trinidad", "Yaguajay"),
        "Ciego de Ávila" to listOf("Baraguá", "Bolivia", "Chambas", "Ciego de Ávila", "Ciro Redondo", "Florencia", "Majagua", "Morón", "Primero de Enero", "Venezuela"),
        "Camagüey" to listOf("Camagüey", "Céspedes", "Esmeralda", "Florida", "Guáimaro", "Jimaguayú", "Minas", "Najasa", "Nuevitas", "Santa Cruz del Sur", "Sibanicú", "Sierra de Cubitas", "Vertientes"),
        "Las Tunas" to listOf("Amancio", "Colombia", "Jesús Menéndez", "Jobabo", "Las Tunas", "Majibacoa", "Manatí", "Puerto Padre"),
        "Granma" to listOf("Bartolomé Masó", "Bayamo", "Buey Arriba", "Campechuela", "Cauto Cristo", "Guisa", "Jiguaní", "Manzanillo", "Media Luna", "Niquero", "Pilón", "Río Cauto", "Yara"),
        "Holguín" to listOf("Antilla", "Báguanos", "Banes", "Cacocum", "Calixto García", "Cueto", "Frank País", "Gibara", "Holguín", "Mayarí", "Moa", "Rafael Freyre", "Sagua de Tánamo", "Urbano Noris"),
        "Santiago de Cuba" to listOf("Contramaestre", "Guamá", "Mella", "Palma Soriano", "San Luis", "Santiago de Cuba", "Segundo Frente", "Songo-La Maya", "Tercer Frente"),
        "Guantánamo" to listOf("Baracoa", "Caimanera", "El Salvador", "Guantánamo", "Imías", "Maisí", "Manuel Tames", "Niceto Pérez", "San Antonio del Sur", "Yateras"),
        "Isla de la Juventud" to listOf("Isla de la Juventud")
    )

    private fun openImagePicker(requestCode: Int) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        runCatching { startActivityForResult(intent, requestCode) }
            .onFailure { showSoToast("No se pudo abrir la galería", Toast.LENGTH_LONG) }
    }

    private fun persistImageUri(uri: android.net.Uri): String {
        runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        return uri.toString()
    }

    private fun createProfileAvatar(sizeDp: Int, clickable: Boolean = false): ImageView {
        val avatar = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, sizeDp), dp(this@MainActivity, sizeDp)).apply {
                if (clickable) marginStart = dp(this@MainActivity, 7)
            }
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(SURFACE2); setStroke(dp(this@MainActivity, 1), RED) }
            clipToOutline = true
            contentDescription = "Foto de perfil"
        }
        val uri = prefs.getString(PREF_PROFILE_PHOTO_URI, null)
        if (!uri.isNullOrBlank()) {
            runCatching { avatar.setImageURI(android.net.Uri.parse(uri)) }
                .onFailure {
                    avatar.setImageResource(android.R.drawable.ic_menu_myplaces)
                    val remoteUrl = prefs.getString(PREF_PROFILE_AVATAR_URL, "").orEmpty()
                    if (remoteUrl.startsWith("https://")) loadGameThumbnail(remoteUrl, avatar, View(this))
                }
        } else {
            avatar.setImageResource(android.R.drawable.ic_menu_myplaces)
            avatar.setColorFilter(TEXT2)
            val remoteUrl = prefs.getString(PREF_PROFILE_AVATAR_URL, "").orEmpty()
            if (remoteUrl.startsWith("https://")) loadGameThumbnail(remoteUrl, avatar, View(this))
        }
        if (clickable) {
            avatar.isClickable = true; avatar.isFocusable = true
            avatar.setOnClickListener { showConfig() }
        }
        return avatar
    }


    private fun loadGameCatalogFromPrefs() {
        // Game offers and prices are intentionally not cached on-device: stale or reseller-only
        // prices must never be shown offline. Keep personal settings/history local, not market offers.
        gameCatalog = emptyList()
        prefs.edit().remove(PREF_GAME_CATALOG).apply()
    }

    private fun saveGameCatalog() {
        // The server is the source of truth. Remove legacy client-side catalogs left by older builds.
        prefs.edit().remove(PREF_GAME_CATALOG).apply()
    }

    private fun isCatalogAdmin(): Boolean = prefs.getString("client_role", "client").equals("admin", true)

    private fun formatCatalogPrice(value: Long): String = if (value <= 0L) "—" else value.toString().reversed().chunked(3).joinToString(" ").reversed()

    private fun normalizeMarketSearch(value: String): String =
        java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .lowercase(Locale.ROOT)


    // ══════════════════════════════════════════════════════════════════════════
    // PRIMER PASO — TELÉFONO DEL CLIENTE
    // ══════════════════════════════════════════════════════════════════════════
    private fun showPhoneOnboarding() {
        stopSupportPolling()
        rootFrame.removeAllViews()

        val screen = FrameLayout(this).apply {
            setBackgroundColor(BG)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val scroll = ScrollView(this).apply {
            setBackgroundColor(BG)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,96),
                dp(this@MainActivity,28), dp(this@MainActivity,80))
        }

        layout.addView(txt("SYNTHESISONE", 11f, RED, bold=true, ls=0.15f, bot=10))
        layout.addView(txt("Antes de comenzar", 28f, TEXT, bold=true, bot=8))
        layout.addView(txt(
            "Indica el número de teléfono que usarás para recibir y enviar transferencias. Este será el número principal con el que identificaremos tus pagos.",
            14f, TEXT2, bot=28
        ))
        layout.addView(gradientDivider())

        layout.addView(lbl("NÚMERO DE TELÉFONO"))
        val phoneIn = inp("Ej: 5XXXXXXX", maxLen=11, numeric=true).apply {
            setText(prefs.getString("phone_number", ""))
            requestFocus()
        }
        layout.addView(phoneIn)
        layout.addView(txt(
            "Usaremos este número para comprobar que una transferencia o un pago de licencia corresponde a tu cuenta.",
            12f, TEXT2, bot=20
        ))

        val status = txt("", 13f, ERR, bot=8)
        layout.addView(status)

        val continueBtn = btn("CONTINUAR")
        layout.addView(continueBtn)
        continueBtn.setOnClickListener {
            val canonical = normalizeClientPhone(phoneIn.text.toString())
            if (!isValidPhone(canonical)) {
                status.text = "⚠️ Introduce un número móvil válido."
                return@setOnClickListener
            }

            continueBtn.isEnabled = false
            continueBtn.text = "REGISTRANDO..."
            status.setTextColor(TEXT2)
            status.text = "Preparando la activación automática..."

            prefs.edit().putString("phone_number", canonical).apply()
            uiScope.launch {
                val result = withContext(Dispatchers.IO) { registerOnboarding(canonical) }
                if (result.ok) {
                    requestPerms()
                    if (result.existingActive) {
                        showSoToast("✅ Licencia activa recuperada", Toast.LENGTH_LONG)
                        showDashboard()
                    } else {
                        showActivation()
                    }
                } else {
                    status.setTextColor(ERR)
                    status.text = result.error ?: "❌ No se pudo conectar con el servidor. Necesitas internet para preparar la activación automática."
                    continueBtn.isEnabled = true
                    continueBtn.text = "CONTINUAR"
                }
            }
        }

        val freeStoreBtn = btn("🛍 CONTINUAR GRATIS A GAME MARKET").apply {
            setTextColor(GREEN)
            background = roundedBackground(SURFACE2, 12, GREEN, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(this@MainActivity, 10)
            }
        }
        layout.addView(freeStoreBtn)
        freeStoreBtn.setOnClickListener {
            startFreeStoreSession(phoneIn.text.toString(), freeStoreBtn, status)
        }
        layout.addView(txt("Puedes comprar en la tienda oficial sin pagar una licencia. Necesitamos un móvil válido para asociar tu sesión de tienda.", 11f, TEXT2, top = 7, bot = 10))

        scroll.addView(layout)
        screen.addView(scroll)

        // Burbuja flotante de ayuda: queda siempre visible en este primer paso.
        val infoBubble = TextView(this).apply {
            text = "❗"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#2A2838"))
                setStroke(dp(this@MainActivity, 1), RED)
            }
            elevation = dp(this@MainActivity, 10).toFloat()
            contentDescription = "¿Por qué necesito mi teléfono?"
            setOnClickListener {
                ThemedAppCompatAlertDialogBuilder(this@MainActivity)
                    .setTitle("¿Por qué necesitamos tu teléfono?")
                    .setMessage(
                        "El número sirve para identificar el teléfono del cliente al que deben llegar las transferencias. " +
                            "También permite al servidor comprobar que un pago de licencia corresponde a ese cliente y, cuando esté implementada esa automatización, activar el token correcto. " +
                            "El número se guarda en la configuración de la app y se envía al servidor junto con la información de licencia/sincronización."
                    )
                    .setPositiveButton("ENTENDIDO", null)
                    .show()
            }
            layoutParams = FrameLayout.LayoutParams(dp(this@MainActivity, 56), dp(this@MainActivity, 56)).apply {
                gravity = Gravity.BOTTOM or Gravity.END
                marginEnd = dp(this@MainActivity, 20)
                bottomMargin = dp(this@MainActivity, 24)
            }
        }
        screen.addView(infoBubble)

        rootFrame.addView(screen)
    }

    private fun normalizeClientPhone(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        return when {
            digits.length == 10 && digits.startsWith("53") -> digits.drop(2)
            digits.length == 8 && digits.startsWith("5") -> digits
            else -> digits
        }
    }

    private fun isValidPhone(phone: String): Boolean {
        return phone.length == 8 && phone.startsWith("5") && phone.all { it.isDigit() }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODAL DE PAGO
    // ══════════════════════════════════════════════════════════════════════════
    private fun showPaymentModal() {
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(180, 0, 0, 0))
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity,24), dp(this@MainActivity,28), dp(this@MainActivity,24), dp(this@MainActivity,24))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#13131F"))
                cornerRadius = dp(this@MainActivity,14).toFloat()
            }
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            ).apply {
                marginStart = dp(this@MainActivity,24)
                marginEnd   = dp(this@MainActivity,24)
            }
            elevation = dp(this@MainActivity,8).toFloat()
        }

        // Header
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val headerTitle = txt("COMPRAR LICENCIA", 13f, GREEN, bold=true, ls=0.10f)
        headerTitle.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        val closeBtn = txt("✕", 18f, MUTED).apply {
            setPadding(dp(this@MainActivity,8),0,0,0)
            setOnClickListener { rootFrame.removeView(overlay) }
        }
        headerRow.addView(headerTitle)
        headerRow.addView(closeBtn)
        card.addView(headerRow)
        card.addView(space(4))
        card.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity,1)).apply {
                topMargin = dp(this@MainActivity,8)
                bottomMargin = dp(this@MainActivity,16)
            }
            setBackgroundColor(SURFACE2)
        })

        // Precio
        val priceCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16))
            background = GradientDrawable().apply {
                colors = intArrayOf(
                    Color.argb(60, Color.red(GREEN), Color.green(GREEN), Color.blue(GREEN)),
                    SURFACE2
                )
                gradientType = GradientDrawable.LINEAR_GRADIENT
                orientation = GradientDrawable.Orientation.TOP_BOTTOM
                cornerRadius = dp(this@MainActivity,10).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(this@MainActivity,20) }
        }
        val priceLbl = txt("Cargando precio…", 32f, GREEN, bold=true).apply { gravity = Gravity.CENTER_HORIZONTAL }
        val priceEq  = txt("", 14f, TEXT2).apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(0,4,0,0) }
        val priceSub = txt("Licencia configurada en el servidor", 11f, MUTED).apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(0,6,0,0) }
        priceCard.addView(priceLbl)
        priceCard.addView(priceEq)
        priceCard.addView(priceSub)
        card.addView(priceCard)
        val automationNotice = txt("Comprobando disponibilidad del servicio…", 12f, BLUE, bold=true, top=0, bot=14).apply {
            setPadding(dp(this@MainActivity,12), dp(this@MainActivity,12), dp(this@MainActivity,12), dp(this@MainActivity,12))
            background = roundedBackground(SURFACE2, 10, Color.TRANSPARENT, 0)
        }
        card.addView(automationNotice)

        val registeredPhone = prefs.getString("phone_number", "").orEmpty()
        if (registeredPhone.isNotBlank()) {
            val phoneBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(this@MainActivity,14), dp(this@MainActivity,12), dp(this@MainActivity,14), dp(this@MainActivity,12))
                background = GradientDrawable().apply {
                    setColor(SURFACE2)
                    cornerRadius = dp(this@MainActivity,8).toFloat()
                }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(this@MainActivity,16) }
            }
            phoneBox.addView(txt("TELÉFONO REGISTRADO", 10f, MUTED, bold=true, ls=0.10f, bot=4))
            phoneBox.addView(txt(registeredPhone, 16f, TEXT, bold=true).apply { typeface = Typeface.MONOSPACE })
            phoneBox.addView(txt("Este número se usará para asociar el pago a tu cliente.", 11f, TEXT2, top=6))
            card.addView(phoneBox)
        }

        // Método 1 — Tarjeta BPA
        card.addView(txt("TRANSFERENCIA TARJETA BPA", 10f, MUTED, bold=true, ls=0.10f, bot=8))
        val bpaCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity,14), dp(this@MainActivity,14), dp(this@MainActivity,14), dp(this@MainActivity,14))
            background = GradientDrawable().apply {
                setColor(SURFACE2)
                cornerRadius = dp(this@MainActivity,8).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(this@MainActivity,16) }
        }
        bpaCard.addView(txt("TARJETA RECEPTORA DE LA LICENCIA", 10f, MUTED, bot=4))
        val bpaAccountView = txt("Cargando…", 16f, TEXT, bold=true).apply {
            typeface = Typeface.MONOSPACE
        }
        bpaCard.addView(bpaAccountView)
        bpaCard.addView(btn("COPIAR NÚMERO DE TARJETA").apply {
            textSize = 9f; isAllCaps = false; layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 36)).apply { topMargin = dp(this@MainActivity, 6) }
            setOnClickListener { copyPaymentValue("Tarjeta receptora", bpaAccountView.text.toString().takeUnless { it == "Cargando…" || it == "No configurada" }.orEmpty()) }
        })
        bpaCard.addView(txt("NÚMERO PARA CONFIRMACIÓN", 10f, MUTED, top=14, bot=4))
        val confirmationPhoneView = txt("Cargando…", 16f, TEXT, bold=true).apply {
            typeface = Typeface.MONOSPACE
        }
        bpaCard.addView(confirmationPhoneView)
        bpaCard.addView(btn("COPIAR NÚMERO DE CONFIRMACIÓN").apply {
            textSize = 9f; isAllCaps = false; layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 36)).apply { topMargin = dp(this@MainActivity, 6) }
            setOnClickListener { copyPaymentValue("Número de confirmación", confirmationPhoneView.text.toString().takeUnless { it == "Cargando…" || it == "No configurado" }.orEmpty()) }
        })
        bpaCard.addView(txt("Usa esta tarjeta únicamente con el número de confirmación que aparece junto a ella.", 11f, TEXT2, top=6))
        card.addView(bpaCard)
        var activationDestinations: List<PaymentDestination> = emptyList()
        val changeDestinationBtn = btn("ELEGIR OTRA CUENTA RECEPTORA").apply {
            textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, PURPLE, 1)
            setOnClickListener {
                choosePaymentDestination(activationDestinations, selectedActivationDestinationId) { selected ->
                    selectedActivationDestinationId = selected.id
                    bpaAccountView.text = selected.card
                    confirmationPhoneView.text = selected.confirmationPhone
                }
            }
        }
        card.addView(changeDestinationBtn)
        card.addView(txt(
            "⚠️ Para activar la licencia, el pago debe enviarse exactamente a la tarjeta seleccionada y usando su número de confirmación asociado. No mezcles datos de cuentas diferentes.",
            12f, TEXT2
        ).apply { setPadding(0, 0, 0, dp(this@MainActivity, 14)) })

        // Nota final
        card.addView(txt(
            "✅ Después del pago, mantén la app con permisos de SMS. Detectaremos el mensaje automáticamente y activaremos tu licencia sin que tengas que copiar el token.",
            12f, TEXT2
        ).apply { setPadding(0,0,0,dp(this@MainActivity,16)) })

        val startPaymentBtn = btn("💳  HARÉ EL PAGO — INICIAR 5 MIN")
        startPaymentBtn.isEnabled = false
        startPaymentBtn.setOnClickListener {
            startPaymentBtn.isEnabled = false
            startPaymentBtn.text = "COMPROBANDO SERVICIO…"
            uiScope.launch {
                val phone = prefs.getString("phone_number", "").orEmpty()
                val latest = withContext(Dispatchers.IO) { fetchPaymentConfig(phone) }
                if (latest == null || !latest.automationEnabled) {
                    val message = latest?.automationMessage ?: "No se pudo comprobar la disponibilidad. No realices el pago hasta confirmarlo."
                    automationNotice.text = "⛔ $message"
                    automationNotice.setTextColor(ERR)
                    startPaymentBtn.text = "AUTOMATIZACIÓN NO DISPONIBLE"
                    startPaymentBtn.isEnabled = false
                    return@launch
                }
                startPaymentBtn.text = "INICIANDO VENTANA..."
                val ok = withContext(Dispatchers.IO) { startPaymentWindow(selectedActivationDestinationId) }
                if (ok) {
                    rootFrame.removeView(overlay)
                    showActivation()
                } else {
                    startPaymentBtn.isEnabled = true
                    startPaymentBtn.text = "💳  HARÉ EL PAGO — INICIAR 5 MIN"
                    showSoToast("No se pudo iniciar la ventana de pago. Revisa tu conexión o el estado del servidor.", Toast.LENGTH_LONG)
                }
            }
        }
        card.addView(startPaymentBtn)
        card.addView(txt(
            "El contador empieza solamente cuando pulses este botón. Ver el precio o cerrar la ventana no inicia el tiempo.",
            11f, MUTED
        ).apply { setPadding(0, dp(this@MainActivity,6), 0, dp(this@MainActivity,14)) })

        // Botón cerrar
        val closeFullBtn = btn("CERRAR")
        closeFullBtn.setOnClickListener { rootFrame.removeView(overlay) }
        card.addView(closeFullBtn)

        overlay.addView(card)

        // Cerrar al tocar fuera
        overlay.setOnClickListener { rootFrame.removeView(overlay) }
        card.setOnClickListener { /* consumir el click para no cerrar */ }

        rootFrame.addView(overlay)

        uiScope.launch {
            val config = withContext(Dispatchers.IO) { fetchPaymentConfig(registeredPhone) }
            if (config != null) {
                priceLbl.text = config.amount?.let { "${formatCupAmount(it)} ${config.currency}" } ?: "Precio no configurado"
                priceEq.text = "Duración: ${config.durationDays} días"
                priceSub.text = if (config.priceType.equals("renewal", true)) "RENOVACIÓN · precio para clientes existentes" else "PRIMER PAGO · licencia nueva"
                activationDestinations = config.destinations
                selectedActivationDestinationId = config.destinationId.ifBlank { config.destinations.firstOrNull()?.id.orEmpty() }
                val selectedDestination = config.destinations.firstOrNull { it.id == selectedActivationDestinationId }
                bpaAccountView.text = selectedDestination?.card ?: config.card ?: "No configurada"
                confirmationPhoneView.text = selectedDestination?.confirmationPhone ?: config.confirmationPhone ?: "No configurado"
                changeDestinationBtn.visibility = if (config.destinations.size > 1) View.VISIBLE else View.GONE
                if (config.automationEnabled) {
                    automationNotice.text = "✅ ${config.automationMessage}"
                    automationNotice.setTextColor(GREEN)
                } else {
                    automationNotice.text = "⛔ ${config.automationMessage}"
                    automationNotice.setTextColor(ERR)
                }
                startPaymentBtn.isEnabled = config.automationEnabled && config.amount != null && !config.card.isNullOrBlank()
                if (!config.automationEnabled) startPaymentBtn.text = "AUTOMATIZACIÓN NO DISPONIBLE"
            } else {
                priceLbl.text = "Servidor no disponible"
                priceEq.text = "Revisa tu conexión"
                automationNotice.text = "⛔ No se pudo comprobar que el pago automático esté disponible. No pagues todavía."
                automationNotice.setTextColor(ERR)
                startPaymentBtn.isEnabled = false
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PANTALLA DE ACTIVACIÓN
    // ══════════════════════════════════════════════════════════════════════════
    private fun showActivation(prefillToken: String = "", showRetryNotice: Boolean = false) {
        stopSupportPolling()
        handler.removeCallbacks(activationTicker)
        activationCountdownView = null

        val currentActivationState = prefs.getString(SyncService.KEY_ACTIVATION_STATE, "").orEmpty()
        val currentConfirmationDeadline = prefs.getLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, 0L)
        val localSessionExpired = currentActivationState in setOf("WAITING_PAYMENT", "WAITING_LATE_CONFIRMATION") &&
            currentConfirmationDeadline > 0L && System.currentTimeMillis() >= currentConfirmationDeadline
        if (localSessionExpired) {
            prepareActivationRetryState()
        }

        rootFrame.removeAllViews()
        val scroll = ScrollView(this).apply { setBackgroundColor(BG) }
        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,72),
                dp(this@MainActivity,28), dp(this@MainActivity,48))
        }

        // Logo / nombre de la app
        layout.addView(txt("SYNTHESISONE", 11f, RED, bold=true, ls=0.15f, bot=8))
        layout.addView(txt("Tu asistente financiero inteligente", 24f, TEXT, bold=true, bot=6))
        layout.addView(txt("Automatiza el control de tus finanzas a través de tus SMS bancarios.", 14f, TEXT2, bot=28))
        layout.addView(gradientDivider())
        val automationNotice = txt("Comprobando disponibilidad de la activación automática…", 12f, BLUE, bold=true, top=12, bot=12).apply {
            setPadding(dp(this@MainActivity,12), dp(this@MainActivity,12), dp(this@MainActivity,12), dp(this@MainActivity,12))
            background = roundedBackground(SURFACE2, 10, Color.TRANSPARENT, 0)
        }
        layout.addView(automationNotice)
        layout.addView(space(12))
        var activationBuyButton: Button? = null

        val activationState = prefs.getString(SyncService.KEY_ACTIVATION_STATE, "").orEmpty()
        val paymentStartedAt = prefs.getLong(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT, 0L)
        val paymentDeadlineAt = prefs.getLong(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT, 0L)
        val confirmationDeadlineAt = prefs.getLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, 0L)

        if (activationState in setOf("WAITING_PAYMENT", "WAITING_LATE_CONFIRMATION") && paymentStartedAt > 0L && paymentDeadlineAt > 0L) {
            val waitingCard = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(this@MainActivity,18), dp(this@MainActivity,18), dp(this@MainActivity,18), dp(this@MainActivity,18))
                background = GradientDrawable().apply { setColor(SURFACE2); cornerRadius = dp(this@MainActivity,12).toFloat() }
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity,14) }
            }
            val title = txt(if (activationState == "WAITING_LATE_CONFIRMATION") "CONFIRMACIÓN DEL PAGO" else "PAGO EN ESPERA", 11f, GREEN, bold=true, ls=0.10f, bot=6)
            val detail = txt(
                if (activationState == "WAITING_LATE_CONFIRMATION")
                    "El tiempo para realizar el pago terminó. Estamos esperando el SMS de confirmación del banco. Si pagaste dentro de los 5 minutos, el sistema podrá validarlo automáticamente si el SMS incluye la hora de la operación."
                else
                    "La ventana de pago está activa. Puedes cerrar la app; el servidor y el teléfono conservarán la sesión y seguiremos esperando el SMS." ,
                12f, TEXT2, bot=10
            )
            val timer = txt("⏳ 05:00", 24f, TEXT, bold=true, bot=10).apply { gravity = Gravity.CENTER }
            waitingCard.addView(title)
            waitingCard.addView(timer)
            waitingCard.addView(detail)
            val target = TextView(this).apply {
                text = "Sesión activa hasta: ${formatDateTime(confirmationDeadlineAt)}"
                textSize = 11f; setTextColor(MUTED)
            }
            waitingCard.addView(target)
            layout.addView(waitingCard)
            activationCountdownView = timer
            handler.removeCallbacks(activationTicker)
            handler.post(activationTicker)
        } else {
            activationCountdownView = null
            if (localSessionExpired || showRetryNotice || activationState.equals("EXPIRED", true)) {
                layout.addView(txt(
                    "⌛ La ventana de confirmación ya finalizó. Puedes iniciar un nuevo intento de pago cuando quieras. El intento anterior no se reutiliza.",
                    12f, TEXT2, bot=14
                ))
            }
            val retryMode = localSessionExpired || showRetryNotice || activationState.equals("EXPIRED", true)
            val buyBtn = btn(if (retryMode) "🔄  REINTENTAR PAGO — NUEVA VENTANA" else "🛒  COMPRAR LICENCIA — ACTIVACIÓN AUTOMÁTICA")
            activationBuyButton = buyBtn
            buyBtn.isEnabled = false
            buyBtn.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(this@MainActivity, 8) }
            buyBtn.setOnClickListener {
                val phone = prefs.getString("phone_number", "").orEmpty()
                if (!isValidPhone(phone)) {
                    showPhoneOnboarding()
                    return@setOnClickListener
                }
                buyBtn.isEnabled = false
                buyBtn.text = "COMPROBANDO DISPONIBILIDAD…"
                uiScope.launch {
                    val currentConfig = withContext(Dispatchers.IO) { fetchPaymentConfig(phone) }
                    if (currentConfig == null || !currentConfig.automationEnabled) {
                        automationNotice.text = "⛔ ${currentConfig?.automationMessage ?: "No se pudo comprobar la disponibilidad. No realices el pago."}"
                        automationNotice.setTextColor(ERR)
                        buyBtn.text = "AUTOMATIZACIÓN NO DISPONIBLE"
                        buyBtn.isEnabled = false
                        return@launch
                    }
                    if (prefs.getString(SyncService.KEY_ACTIVATION_ID, "").orEmpty().isBlank() ||
                        prefs.getString(SyncService.KEY_ACTIVATION_STATE, "").orEmpty() == "EXPIRED") {
                        val result = withContext(Dispatchers.IO) { registerOnboarding(phone) }
                        if (!result.ok) {
                            showSoToast(result.error ?: "No se pudo preparar la activación automática", Toast.LENGTH_LONG)
                            buyBtn.text = if (retryMode) "🔄  REINTENTAR PAGO — NUEVA VENTANA" else "🛒  COMPRAR LICENCIA — ACTIVACIÓN AUTOMÁTICA"
                            buyBtn.isEnabled = true
                            return@launch
                        }
                        if (result.existingActive) {
                            showDashboard()
                            return@launch
                        }
                    }
                    requestPerms()
                    showPaymentModal()
                }
            }
            layout.addView(buyBtn)
        }

        // La compra de licencia es opcional para la tienda oficial. Este acceso
        // debe estar visible también si el usuario no quiere iniciar un pago.
        val freeStoreStatus = txt("", 11f, ERR, top = 4, bot = 5)
        val freeStoreBtn = btn("🛍  ENTRAR A GAME MARKET SIN LICENCIA").apply {
            setTextColor(GREEN)
            background = roundedBackground(SURFACE2, 12, GREEN, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(this@MainActivity, 8)
                bottomMargin = dp(this@MainActivity, 4)
            }
            setOnClickListener {
                startFreeStoreSession(prefs.getString("phone_number", "").orEmpty(), this, freeStoreStatus)
            }
        }
        layout.addView(freeStoreBtn)
        layout.addView(freeStoreStatus)
        layout.addView(txt("La tienda oficial funciona sin licencia. La automatización financiera personal sí requiere una licencia activa.", 10.5f, TEXT2, bot = 6))

        // Enlace secundario "ya tengo token"
        val activateLink = TextView(this).apply {
            text = "¿Ya tienes un token? Activar licencia →"
            textSize = 13f
            setTextColor(BLUE)
            gravity = Gravity.CENTER
            setPadding(0, dp(this@MainActivity,12), 0, dp(this@MainActivity,28))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener { showActivationForm() }
        }
        layout.addView(activateLink)

        layout.addView(gradientDivider())
        layout.addView(space(24))

        // ── Descripción de funcionalidades ────────────────────────────────────
        layout.addView(txt("¿QUÉ PUEDES HACER CON SYNTHESISONE?", 10f, MUTED, bold=true, ls=0.12f, bot=20))

        data class Feature(val icon: String, val title: String, val desc: String)
        val features = listOf(
            Feature("📩", "Lectura automática de SMS", "Captura y procesa en tiempo real los mensajes de tus bancos y operadores de pago."),
            Feature("💳", "Control de tarjetas", "Vincula hasta 3 tarjetas y monitorea cada movimiento al instante."),
            Feature("💰", "Gestión de monedero", "Controla tu saldo MiTransfer y mantén un historial de transferencias."),
            Feature("📊", "Reportes diarios", "Recibe un resumen automático de tus ingresos y gastos cada día."),
            Feature("🔔", "Notificaciones inteligentes", "Alertas instantáneas para cada transacción importante."),
            Feature("☁️", "Sincronización en la nube", "Tus datos se sincronizan de forma segura con el servidor para respaldo y análisis."),
            Feature("🔐", "Licencia por dispositivo", "Acceso seguro vinculado a tu teléfono. Nadie más puede usar tu cuenta."),
            Feature("⚡", "Actualización cada 4 segundos", "La información de tus transacciones se refresca de forma continua sin intervención manual.")
        )

        for (f in features) {
            val featureCard = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(this@MainActivity,14), dp(this@MainActivity,14),
                    dp(this@MainActivity,14), dp(this@MainActivity,14))
                background = GradientDrawable().apply {
                    setColor(SURFACE2)
                    cornerRadius = dp(this@MainActivity,10).toFloat()
                }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(this@MainActivity,10) }
            }
            val iconTxt = txt(f.icon, 22f, TEXT).apply {
                layoutParams = LinearLayout.LayoutParams(
                    dp(this@MainActivity,40), ViewGroup.LayoutParams.WRAP_CONTENT
                )
                gravity = Gravity.CENTER
            }
            val textCol = ll().apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            textCol.addView(txt(f.title, 13f, TEXT, bold=true, bot=3))
            textCol.addView(txt(f.desc, 12f, TEXT2))
            featureCard.addView(iconTxt)
            featureCard.addView(space(10, horiz=true))
            featureCard.addView(textCol)
            layout.addView(featureCard)
        }

        layout.addView(space(12))
        layout.addView(lockedFeatureCard())
        layout.addView(space(16))
        layout.addView(txt(
            "La duración y el precio se determinan desde el servidor y la licencia queda vinculada a tu dispositivo.",
            12f, MUTED, bot=4
        ).apply { gravity = Gravity.CENTER })

        scroll.addView(layout)
        rootFrame.addView(scroll)
        uiScope.launch {
            val phone = prefs.getString("phone_number", "").orEmpty()
            val config = withContext(Dispatchers.IO) { fetchPaymentConfig(phone) }
            if (isFinishing || !automationNotice.isAttachedToWindow) return@launch
            if (config == null) {
                automationNotice.text = "⛔ No se pudo comprobar la disponibilidad. No realices el pago hasta tener confirmación."
                automationNotice.setTextColor(ERR)
                activationBuyButton?.isEnabled = false
            } else if (!config.automationEnabled) {
                automationNotice.text = "⛔ ${config.automationMessage}"
                automationNotice.setTextColor(ERR)
                activationBuyButton?.isEnabled = false
                activationBuyButton?.text = "AUTOMATIZACIÓN NO DISPONIBLE"
            } else {
                val typeLabel = if (config.priceType.equals("renewal", true)) "Renovación" else "Primer pago"
                automationNotice.text = "✅ ${config.automationMessage}\n$typeLabel: ${config.amount?.let { formatCupAmount(it) } ?: "—"} ${config.currency}"
                automationNotice.setTextColor(GREEN)
                activationBuyButton?.isEnabled = config.amount != null && !config.card.isNullOrBlank()
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FORMULARIO DE ACTIVACIÓN (token + tarjetas)
    // ══════════════════════════════════════════════════════════════════════════
    private fun showActivationForm(prefillToken: String = "") {
        handler.removeCallbacks(activationTicker)
        activationCountdownView = null
        rootFrame.removeAllViews()
        val scroll = ScrollView(this).apply { setBackgroundColor(BG) }
        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,60),
                dp(this@MainActivity,28), dp(this@MainActivity,48))
        }

        layout.addView(futuristicBackButton("←  VOLVER") { showActivation() })

        layout.addView(txt("SYNTHESISONE", 11f, RED, bold=true, ls=0.15f, bot=8))
        layout.addView(txt("Activa tu licencia", 26f, TEXT, bold=true, bot=6))
        layout.addView(txt("Introduce tu token de acceso para continuar", 14f, TEXT2, bot=24))
        layout.addView(gradientDivider())
        layout.addView(txt("La licencia queda vinculada a este dispositivo.", 12f, TEXT2, bot=10))
        layout.addView(txt("Teléfono registrado: ${prefs.getString("phone_number", "")}", 12f, BLUE, bold=true, bot=10))

        val autoStatus = txt("", 12f, TEXT2, bot=18)
        val activationId = prefs.getString(SyncService.KEY_ACTIVATION_ID, "").orEmpty()
        if (activationId.isNotBlank()) {
            autoStatus.text = when (prefs.getString(SyncService.KEY_ACTIVATION_STATE, "WAITING_PAYMENT")) {
                "ACTIVATED" -> "✅ Pago detectado. Preparando tu licencia..."
                else -> "🟢 Activación automática preparada. Realiza el pago y la app detectará el SMS."
            }
        } else {
            autoStatus.text = "⚠️ La activación automática aún no está preparada."
            autoStatus.setTextColor(ERR)
        }
        layout.addView(autoStatus)

        layout.addView(lbl("TOKEN DE LICENCIA"))
        val tokenIn = inp("Pega tu token aquí").apply { if (prefillToken.isNotEmpty()) setText(prefillToken) }
        layout.addView(tokenIn)

        val savedCard1 = prefs.getString("card1", "").orEmpty().split("-")
        val savedCard2 = prefs.getString("card2", "").orEmpty().split("-")
        val savedCard3 = prefs.getString("card3", "").orEmpty().split("-")

        layout.addView(lbl("TARJETAS VINCULADAS (hasta 3)", top=24))
        layout.addView(txt("Primeros 4 y últimos 4 dígitos de cada tarjeta", 12f, TEXT2, bot=12))
        val c1a = inp("Tarjeta 1 — primeros 4", maxLen=4, numeric=true).apply { setText(savedCard1.getOrNull(0).orEmpty()) }
        val c1b = inp("Tarjeta 1 — últimos 4", maxLen=4, numeric=true).apply { setText(savedCard1.getOrNull(1).orEmpty()) }
        val c2a = inp("Tarjeta 2 — primeros 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard2.getOrNull(0).orEmpty()) }
        val c2b = inp("Tarjeta 2 — últimos 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard2.getOrNull(1).orEmpty()) }
        val c3a = inp("Tarjeta 3 — primeros 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard3.getOrNull(0).orEmpty()) }
        val c3b = inp("Tarjeta 3 — últimos 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard3.getOrNull(1).orEmpty()) }
        layout.addView(row2(c1a, c1b)); layout.addView(row2(c2a, c2b)); layout.addView(row2(c3a, c3b))

        layout.addView(lbl("NÚMERO DE MONEDERO", top=24))
        layout.addView(txt("Tu número de teléfono del monedero MiTransfer", 12f, TEXT2, bot=12))
        val walletIn = inp("Ej: 5359190241", maxLen=10, numeric=true).apply { setText(prefs.getString("wallet", "").orEmpty()) }
        layout.addView(walletIn)

        val statusMsg = txt("", 13f, ERR)
        layout.addView(statusMsg)

        val btn = btn("ACTIVAR LICENCIA")
        layout.addView(space(8)); layout.addView(btn)

        btn.setOnClickListener {
            val token = tokenIn.text.toString().trim()
            val c1aV = c1a.text.toString().trim()
            val c1bV = c1b.text.toString().trim()
            if (token.isEmpty()) { statusMsg.text = "⚠️ El token es obligatorio"; return@setOnClickListener }
            if (c1aV.length != 4 || c1bV.length != 4) { statusMsg.text = "⚠️ Vincula al menos una tarjeta (4+4 dígitos)"; return@setOnClickListener }
            btn.isEnabled = false; btn.text = "Verificando..."; statusMsg.text = ""
            val phone = prefs.getString("phone_number", "").orEmpty()
            if (!isValidPhone(phone)) {
                statusMsg.text = "⚠️ Primero debes registrar un número de teléfono válido"
                btn.isEnabled = true
                btn.text = "ACTIVAR LICENCIA"
                return@setOnClickListener
            }
            val card1 = "$c1aV-$c1bV"
            val card2 = if (c2a.text.length==4 && c2b.text.length==4) "${c2a.text}-${c2b.text}" else ""
            val card3 = if (c3a.text.length==4 && c3b.text.length==4) "${c3a.text}-${c3b.text}" else ""
            val wallet = walletIn.text.toString().trim()
            prefs.edit().putString("phone_number", phone).apply()
            uiScope.launch {
                val verification = withContext(Dispatchers.IO) { verifyToken(token, phone, card1, card2, card3, wallet) }
                when {
                    verification.ok -> {
                        val now = System.currentTimeMillis()
                        val deviceId = ensureDeviceId()
                        val expiresAt = verification.expiresAt ?: (now + (30L * 24 * 60 * 60 * 1000))
                        val state = verification.licenseState?.takeIf { it.isNotBlank() } ?: "ACTIVE"
                        prefs.edit().apply {
                            putString(SyncService.KEY_TOKEN, token)
                            putBoolean(SyncService.KEY_STORE_ONLY_SESSION, false)
                            putString(SyncService.KEY_DEVICE_ID, deviceId)
                            putString(SyncService.KEY_LICENSE_STATE, state)
                            putLong(SyncService.KEY_LICENSE_ACTIVATED_AT, now)
                            putLong(SyncService.KEY_LICENSE_EXPIRES_AT, expiresAt)
                            putString("phone_number", phone)
                            putString("card1", card1)
                            if (card2.isNotBlank()) putString("card2", card2) else remove("card2")
                            if (card3.isNotBlank()) putString("card3", card3) else remove("card3")
                            if (wallet.isNotEmpty()) putString("wallet", wallet) else remove("wallet")
                            putBoolean("activated", true)
                            remove(SyncService.KEY_ACTIVATION_ID)
                            remove(SyncService.KEY_ACTIVATION_SECRET)
                            remove(SyncService.KEY_ACTIVATION_STATE)
                            remove(SyncService.KEY_ACTIVATION_CREATED_AT)
                            remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
                            putLong(SyncService.KEY_LAST_SYNC_AT, 0L)
                            putString(SyncService.KEY_LAST_SYNC_STATUS, "PENDING")
                            remove(SyncService.KEY_LAST_SYNC_ERROR)
                        }.apply()
                        requestPerms()
                        DailyReportReceiver.schedule(this@MainActivity)
                        NotificationService.updateDailyFlow(this@MainActivity)
                        showDashboard()
                    }
                    verification.licenseState == "USED" -> showTokenInUse(token)
                    verification.licenseState == "REVOKED" -> showTokenRevoked(token)
                    verification.licenseState == "INVALID" -> {
                        statusMsg.text = "❌ Token inválido o no existe"
                        btn.isEnabled = true
                        btn.text = "ACTIVAR LICENCIA"
                    }
                    else -> {
                        statusMsg.text = "❌ Error de conexión. Verifica tu internet."
                        btn.isEnabled = true
                        btn.text = "ACTIVAR LICENCIA"
                    }
                }
            }
        }
        val lockedManagement = lockedFeatureCard()
        layout.addView(space(18))
        layout.addView(lockedManagement)
        scroll.addView(layout); rootFrame.addView(scroll)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PANTALLA TOKEN EN USO
    // ══════════════════════════════════════════════════════════════════════════
    private fun showTokenInUse(token: String) {
        rootFrame.removeAllViews()
        val scroll = ScrollView(this).apply { setBackgroundColor(BG) }
        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,80),
                dp(this@MainActivity,28), dp(this@MainActivity,48))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        val iconBg = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity,80), dp(this@MainActivity,80)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(this@MainActivity,24)
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(30, 255, 23, 68))
            }
        }
        val iconTxt = txt("🔒", 32f, ERR).apply { gravity = Gravity.CENTER }
        iconBg.addView(iconTxt)
        layout.addView(iconBg)

        layout.addView(txt("Token en uso", 26f, TEXT, bold=true, bot=12).apply { gravity=Gravity.CENTER_HORIZONTAL })
        layout.addView(txt("Este token ya está activo en otro dispositivo.", 14f, TEXT2, bot=8).apply { gravity=Gravity.CENTER_HORIZONTAL })
        layout.addView(txt("Si eres el propietario, contacta al administrador para recuperar tu acceso.", 14f, TEXT2, bot=40).apply { gravity=Gravity.CENTER_HORIZONTAL })

        val tokenBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16))
            background = GradientDrawable().apply { setColor(SURFACE2); cornerRadius=dp(this@MainActivity,8).toFloat() }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity,32)
            }
        }
        tokenBox.addView(lbl("TU TOKEN"))
        tokenBox.addView(txt(token.take(32) + "...", 11f, MUTED).apply { typeface = Typeface.MONOSPACE })
        layout.addView(tokenBox)

        val backBtn = btn("← INTENTAR CON OTRO TOKEN")
        backBtn.setOnClickListener {
            prefs.edit()
                .remove(SyncService.KEY_ACTIVATION_ID)
                .remove(SyncService.KEY_ACTIVATION_SECRET)
                .remove(SyncService.KEY_ACTIVATION_STATE)
                .remove(SyncService.KEY_ACTIVATION_CREATED_AT)
            .remove(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT)
            .remove(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
            .remove(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
                .remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
                .apply()
            showActivationForm()
        }
        layout.addView(backBtn)

        scroll.addView(layout); rootFrame.addView(scroll)
    }

    private fun showTokenRevoked(token: String) {
    rootFrame.removeAllViews()
    val scroll = ScrollView(this).apply { setBackgroundColor(BG) }
    val layout = ll().apply {
        setPadding(dp(this@MainActivity,28), dp(this@MainActivity,80),
            dp(this@MainActivity,28), dp(this@MainActivity,48))
        gravity = Gravity.CENTER_HORIZONTAL
    }

    val iconBg = FrameLayout(this).apply {
        layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity,80), dp(this@MainActivity,80)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(this@MainActivity,24)
        }
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.argb(30, 255, 23, 68))
        }
    }
    val iconTxt = txt("🚫", 32f, ERR).apply { gravity = Gravity.CENTER }
    iconBg.addView(iconTxt)
    layout.addView(iconBg)

    layout.addView(txt("Licencia revocada", 26f, ERR, bold=true, bot=12).apply { gravity=Gravity.CENTER_HORIZONTAL })
    layout.addView(txt("Esta licencia ha sido revocada por el administrador.", 14f, TEXT2, bot=8).apply { gravity=Gravity.CENTER_HORIZONTAL })
    layout.addView(txt("Contacta al administrador para obtener una nueva licencia.", 14f, TEXT2, bot=40).apply { gravity=Gravity.CENTER_HORIZONTAL })

    val tokenBox = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16), dp(this@MainActivity,16))
        background = GradientDrawable().apply { setColor(SURFACE2); cornerRadius=dp(this@MainActivity,8).toFloat() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(this@MainActivity,32)
        }
    }
    tokenBox.addView(lbl("TOKEN REVOCADO"))
    tokenBox.addView(txt(token.take(32) + "...", 11f, ERR).apply { typeface = Typeface.MONOSPACE })
    layout.addView(tokenBox)

    val backBtn = btn("← INTENTAR CON OTRO TOKEN")
    backBtn.setOnClickListener {
        // Conservamos teléfono y tarjetas: son datos del cliente, no de la licencia.
        prefs.edit()
            .remove(SyncService.KEY_TOKEN)
            .remove(SyncService.KEY_ACTIVATION_ID)
            .remove(SyncService.KEY_ACTIVATION_SECRET)
            .remove(SyncService.KEY_ACTIVATION_STATE)
            .remove(SyncService.KEY_ACTIVATION_CREATED_AT)
            .remove(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT)
            .remove(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
            .remove(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
            .remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
            .putBoolean("activated", false)
            .putString(SyncService.KEY_LICENSE_STATE, "PENDING")
            .remove(SyncService.KEY_LICENSE_ACTIVATED_AT)
            .remove(SyncService.KEY_LICENSE_EXPIRES_AT)
            .apply()
        showActivation()
    }
    layout.addView(backBtn)

    scroll.addView(layout); rootFrame.addView(scroll)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DASHBOARD
    // ══════════════════════════════════════════════════════════════════════════
    private fun showDashboard(guidedSettings: Boolean = false) {
        clearAssistantFloatingUi()
        rootFrame.setBackgroundColor(BG)
        window.setBackgroundDrawable(ColorDrawable(BG))
        updateSystemBars()
        val storeOnlyMode = isStoreOnlySession()
        stopSupportPolling()
        handler.removeCallbacks(activationTicker)
        activationCountdownView = null
        rootFrame.removeAllViews()
        lastRenderedSmsSignature = "__NOT_RENDERED__"
        dashboardRenderSignature = ""
        dashboardRecentSignature = ""
        dashboardOverview = null
        dashboardHealth = null
        dashboardRecent = null

        val dashboardScroll = androidx.core.widget.NestedScrollView(this).apply {
            setBackgroundColor(BG)
            isNestedScrollingEnabled = true
            isFillViewport = false
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply { bottomMargin = dp(this@MainActivity, 96) }
        }
        val root = ll().apply {
            setBackgroundColor(BG)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // Compact SO header: identity and a clear page title, no oversized blank space.
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 18), dp(this@MainActivity, 18), dp(this@MainActivity, 13))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(blendSurfaceColor(SURFACE2, RED, 0.10f), BG))
        }
        val topRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val logo = TextView(this).apply {
            text = "S"; textSize = 22f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(RED, PURPLE)).apply { cornerRadius = dp(this@MainActivity, 15).toFloat() }
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 46), dp(this@MainActivity, 46)).apply { marginEnd = dp(this@MainActivity, 11) }
        }
        val brand = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        brand.addView(txt("SYNTHESIS ONE", 12f, TEXT, bold=true, ls=0.09f))
        val profileHandle = prefs.getString(PREF_PROFILE_USERNAME, "").orEmpty().trim().removePrefix("@")
        val profileDisplayName = prefs.getString(PREF_PROFILE_NAME, "").orEmpty().trim()
        val profileSubline = when {
            profileDisplayName.isNotBlank() && profileHandle.isNotBlank() -> "$profileDisplayName · @$profileHandle"
            profileHandle.isNotBlank() -> "@$profileHandle"
            profileDisplayName.isNotBlank() -> profileDisplayName
            else -> "FINANCIAL CONTROL SYSTEM"
        }
        brand.addView(txt(profileSubline, 8f, MUTED, bold=true, ls=0.05f, top=4))
        val hideDataBtn = txt(if (prefs.getBoolean(PREF_HIDE_SENSITIVE, false)) "◉" else "◎", 20f, TEXT2).apply {
            contentDescription = "Mostrar u ocultar datos sensibles"
            setPadding(dp(this@MainActivity, 9), dp(this@MainActivity, 6), dp(this@MainActivity, 9), dp(this@MainActivity, 6))
            setOnClickListener {
                val hide = !prefs.getBoolean(PREF_HIDE_SENSITIVE, false)
                prefs.edit().putBoolean(PREF_HIDE_SENSITIVE, hide).apply()
                text = if (hide) "◉" else "◎"
                lastRenderedSmsSignature = "__NOT_RENDERED__"
                dashboardRecentSignature = ""
                refreshSms(); refreshEcon(); refreshDashboardRecent()
                showSoToast(if (hide) "Datos sensibles ocultos" else "Datos sensibles visibles", Toast.LENGTH_SHORT)
            }
        }
        val configBtn = txt("⚙", 21f, TEXT2).apply {
            contentDescription = "Ajustes"
            setPadding(dp(this@MainActivity, 9), dp(this@MainActivity, 6), dp(this@MainActivity, 4), dp(this@MainActivity, 6))
            setOnClickListener { showConfig() }
        }
        val headerAvatar = createProfileAvatar(36, clickable = !storeOnlyMode)
        topRow.addView(logo); topRow.addView(brand); topRow.addView(headerAvatar); topRow.addView(hideDataBtn); topRow.addView(configBtn)
        header.addView(topRow)
        val pageTitle = txt("Resumen financiero", 24f, TEXT, bold=true, top=16, bot=3)
        header.addView(pageTitle)
        val pageSubtitle = txt("Tu actividad financiera, en una sola vista.", 11.5f, TEXT2)
        header.addView(pageSubtitle)
        val onlineAtCreation = isDeviceOnline()
        val initialStatusColor = if (onlineAtCreation) GREEN else Color.parseColor(if (isLightPalette()) "#995B00" else "#FFC56E")
        val initialStatusFill = if (isLightPalette()) blendSurfaceColor(SURFACE2, initialStatusColor, 0.10f) else Color.parseColor(if (onlineAtCreation) "#0F2926" else "#302419")
        val initialStatusEdge = if (isLightPalette()) blendSurfaceColor(initialStatusColor, SURFACE2, 0.38f) else Color.parseColor(if (onlineAtCreation) "#245E53" else "#75542B")
        networkStatusBanner = txt(
            if (onlineAtCreation) "● CONECTADO · los movimientos se sincronizan automáticamente" else "● MODO OFFLINE · historial local disponible; wallet y ofertas desactivadas",
            9f, initialStatusColor, bold=true
        ).apply {
            setPadding(dp(this@MainActivity, 11), dp(this@MainActivity, 9), dp(this@MainActivity, 11), dp(this@MainActivity, 9))
            background = roundedBackground(initialStatusFill, 11, initialStatusEdge, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 12) }
            contentDescription = if (onlineAtCreation) "Conexión activa" else "Modo offline, historial local disponible"
        }
        networkStatusBanner?.setOnClickListener {
            if (!isDeviceOnline()) showAssistantProactiveAlert(
                "Modo sin conexión",
                "Puedes consultar el historial guardado en este dispositivo. Wallet, pagos y ofertas requieren recuperar una conexión verificada. No intentes transferir mientras no puedas confirmar el estado del servicio.",
                showWhatsApp = false
            ) else showAssistantProactiveAlert(
                "Conexión disponible",
                "La conexión está activa. Antes de transferir, comprueba siempre que el ticket y el método de pago sigan vigentes.",
                showWhatsApp = false
            )
        }
        header.addView(networkStatusBanner)
        root.addView(header)
        bootstrapRewardsIfOnline()

        val homeSection = ll().apply {
            setPadding(dp(this@MainActivity, 16), 0, dp(this@MainActivity, 16), dp(this@MainActivity, 24))
        }

        val overviewCard = ll().apply {
            setPadding(dp(this@MainActivity, 17), dp(this@MainActivity, 17), dp(this@MainActivity, 17), dp(this@MainActivity, 16))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                if (isLightPalette()) intArrayOf(SURFACE, blendSurfaceColor(SURFACE2, RED, 0.10f), SURFACE)
                else intArrayOf(blendSurfaceColor(SURFACE2, RED, 0.24f), SURFACE, BG)).apply {
                cornerRadius = dp(this@MainActivity, if (selectedLayoutStyle() == "minimal") 16 else 23).toFloat()
                setStroke(dp(this@MainActivity, 1), blendSurfaceColor(RED, MUTED, if (isLightPalette()) 0.42f else 0.18f, 190))
            }
            elevation = dp(this@MainActivity, 3).toFloat()
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, dp(this@MainActivity, 3), 0, dp(this@MainActivity, 10))
            }
        }
        dashboardOverview = overviewCard
        homeSection.addView(overviewCard)
        homeSection.addView(buildWelcomeCountdownCard())

        val quickRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity, 10)
            }
        }
        val syncBtn = btn("⟳  SINCRONIZAR").apply {
            textSize = 10f
            isAllCaps = false
            setTextColor(TEXT)
            setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7))
            background = roundedBackground(SURFACE, 13, RED, 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 44), 1f).apply { marginEnd = dp(this@MainActivity, 8) }
            setOnClickListener { clickedView ->
                if (!clickedView.isEnabled) return@setOnClickListener
                clickedView.isEnabled = false
                (clickedView as? TextView)?.text = "SINCRONIZANDO…"
                prefs.edit().putString(SyncService.KEY_LAST_SYNC_STATUS, "SYNCING").apply()
                SyncService.syncNow(this@MainActivity)
                NotificationService.updateDailyFlow(this@MainActivity)
                clickedView.postDelayed({
                    if (!isFinishing) {
                        clickedView.isEnabled = true
                        (clickedView as? TextView)?.text = "⟳  SINCRONIZAR"
                        refreshSms(); refreshEcon(); refreshDashboardOverview(force = true); refreshDashboardRecent()
                    }
                }, 1200L)
            }
        }
        val supportButton = btn("✦  ASISTENTE IA").apply {
            textSize = 10f
            isAllCaps = false
            setTextColor(TEXT)
            setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7))
            background = roundedBackground(SURFACE, 13, PURPLE, 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 44), 1f)
            setOnClickListener { showAiAssistant() }
        }
        quickRow.addView(syncBtn); quickRow.addView(supportButton)
        homeSection.addView(quickRow)

        val healthCard = ll().apply {
            setPadding(dp(this@MainActivity, 15), dp(this@MainActivity, 13), dp(this@MainActivity, 15), dp(this@MainActivity, 13))
            background = roundedBackground(SURFACE, 17, blendSurfaceColor(RED, MUTED, 0.35f), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity, 10)
            }
        }
        dashboardHealth = healthCard
        homeSection.addView(healthCard)

        val serviceStatus = txt("Comprobando disponibilidad automática…", 10f, TEXT2).apply {
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 8), dp(this@MainActivity, 12), dp(this@MainActivity, 8))
            background = roundedBackground(SURFACE2, 12, blendSurfaceColor(RED, MUTED, 0.30f), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity, 10)
            }
        }
        homeSection.addView(serviceStatus)

        val licenseTitle = txt("TU LICENCIA", 9f, MUTED, bold=true, ls=0.12f, top=4, bot=1)
        homeSection.addView(licenseTitle)
        homeSection.addView(buildLicenseCard())

        val adminAutomationHost = ll().apply {
            visibility = View.GONE
            setPadding(0, dp(this@MainActivity, 2), 0, dp(this@MainActivity, 8))
        }
        homeSection.addView(adminAutomationHost)

        val recentCard = ll().apply {
            setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 14), dp(this@MainActivity, 14), dp(this@MainActivity, 12))
            background = roundedBackground(SURFACE, 18, Color.parseColor("#252D42"), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(this@MainActivity, 2); bottomMargin = dp(this@MainActivity, 10)
            }
        }
        val recentHead = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        recentHead.addView(txt("Actividad reciente", 15f, TEXT, bold=true).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val recentViewAll = txt("VER TODO  ›", 9f, RED, bold=true, ls=.04f).apply {
            setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 6), dp(this@MainActivity, 2), dp(this@MainActivity, 6))
        }
        recentHead.addView(recentViewAll)
        recentCard.addView(recentHead)
        recentCard.addView(txt("Últimos movimientos registrados en este dispositivo", 10f, MUTED, top=3, bot=8))
        val recentRows = ll().apply { orientation = LinearLayout.VERTICAL }
        dashboardRecent = recentRows
        recentCard.addView(recentRows)
        homeSection.addView(recentCard)

        val activitySection = ll().apply {
            visibility = View.GONE
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 8), dp(this@MainActivity, 16), dp(this@MainActivity, 24))
        }
        activitySection.addView(txt("CENTRO DE ACTIVIDAD", 9f, PURPLE, bold=true, ls=.13f, bot=4))
        activitySection.addView(txt("Movimientos y sincronización", 21f, TEXT, bold=true, bot=3))
        activitySection.addView(txt("Filtra por estado y toca una operación para ver sus detalles.", 11f, TEXT2, bot=12))
        val smsSection = ll()
        buildSmsSection(smsSection)
        activitySection.addView(smsSection)

        econContainer = ll().apply {
            visibility = View.GONE
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 8), dp(this@MainActivity, 16), dp(this@MainActivity, 24))
        }

        val marketSection = ll().apply {
            visibility = View.GONE
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 8), dp(this@MainActivity, 16), dp(this@MainActivity, 26))
        }
        marketSectionView = marketSection
        var selectedMarketGame: GameCatalogItem? = null
        fun renderMarket() {
            marketSection.removeAllViews()
            if (!isDeviceOnline()) {
                marketSection.addView(buildOfflineFeatureCard("Game Market", "Las ofertas de Game Market y sus precios no se muestran sin conexión. El historial de pagos guardado en este teléfono sigue disponible."))
                return
            }
            val selected = selectedMarketGame
            if (selected == null) {
                marketSection.addView(buildGameMarketSection(
                    games = gameCatalog,
                    onGameSelected = { game ->
                        selectedMarketGame = game
                        pageTitle.text = game.name
                        pageSubtitle.text = "Catálogo de recargas · Vista previa"
                        renderMarket()
                    },
                    onCatalogChanged = {
                        selectedMarketGame = null
                        renderMarket()
                    }
                ))
            } else {
                marketSection.addView(buildGameDetailSection(selected,
                    onBack = {
                        selectedMarketGame = null
                        pageTitle.text = "Game Market"
                        pageSubtitle.text = "Catálogo de recargas y servicios de juegos."
                        renderMarket()
                    },
                    onOffersChanged = {
                        selectedMarketGame = gameCatalog.firstOrNull { it.id == selected.id }
                        renderMarket()
                    }
                ))
            }
        }

        root.addView(homeSection)
        root.addView(activitySection)
        root.addView(econContainer)
        root.addView(marketSection)
        dashboardScroll.addView(root)
        rootFrame.addView(dashboardScroll)

        // Fixed bottom navigation keeps the main destinations one tap away.
        val bottomNav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 6), dp(this@MainActivity, 7), dp(this@MainActivity, 5))
            background = roundedBackground(SURFACE, if (selectedLayoutStyle() == "minimal") 18 else 24, blendSurfaceColor(RED, MUTED, if (isLightPalette()) 0.38f else 0.18f), 1)
            elevation = dp(this@MainActivity, 16).toFloat()
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 84), Gravity.BOTTOM).apply {
                setMargins(dp(this@MainActivity, 12), 0, dp(this@MainActivity, 12), dp(this@MainActivity, 6))
            }
        }
        val navItems = linkedMapOf<String, LinearLayout>()
        fun makeNavItem(key: String, icon: String, label: String): LinearLayout {
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 4), dp(this@MainActivity, 5), dp(this@MainActivity, 4))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
                    setMargins(dp(this@MainActivity, 2), 0, dp(this@MainActivity, 2), 0)
                }
                isClickable = true
                isFocusable = true
                contentDescription = label
            }
            item.addView(NavigationGlyphView(this@MainActivity, key).apply {
                layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 38), dp(this@MainActivity, 38))
                tint = MUTED
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            })
            item.addView(txt(label, 9.5f, TEXT2, bold=true, top=1).apply { gravity = Gravity.CENTER; includeFontPadding = false; maxLines = 1 })
            item.tag = key
            item.setOnClickListener {
                when (key) {
                    "home" -> selectDashboardSection("home", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
                    "activity" -> selectDashboardSection("activity", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
                    "cash" -> selectDashboardSection("cash", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
                    "market" -> {
                        if (!isDeviceOnline()) {
                            showSoToast("Game Market requiere conexión. Tu historial local sigue disponible.", Toast.LENGTH_LONG)
                            return@setOnClickListener
                        }
                        renderMarket()
                        selectDashboardSection("market", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
                    }
                    "settings" -> showConfig()
                }
            }
            navItems[key] = item
            bottomNav.addView(item)
            return item
        }
        if (!storeOnlyMode) {
            makeNavItem("home", "◆", "Inicio")
            makeNavItem("activity", "◷", "Actividad")
            makeNavItem("cash", "▤", "Caja")
        }
        makeNavItem("market", "◎", "Juegos")
        makeNavItem("settings", "⚙", "Ajustes")
        if (!storeOnlyMode) {
            recentViewAll.setOnClickListener {
                selectDashboardSection("activity", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
            }
        }
        rootFrame.addView(bottomNav)
        selectDashboardSection(if (storeOnlyMode) "market" else "home", pageTitle, pageSubtitle, homeSection, activitySection, econContainer, marketSection, navItems)
        installAssistantFloatingLauncher()
        scheduleFirstVisitAssistantTutor()
        if (guidedSettings) {
            navItems["settings"]?.let { settingsTarget ->
                pulseAssistantGuideTarget(settingsTarget)
                showAssistantProactiveAlert("SO Assistant · Paso 1 de 2", "Primero abrimos Ajustes. Después resaltaré la tarjeta SO Reseller.", showWhatsApp = false)
                handler.postDelayed({
                    if (!isFinishing && !isDestroyed) showConfig(guideToReseller = true)
                }, 1300L)
            }
        }

        if (!storeOnlyMode) {
            loadDashboardAccountControls(serviceStatus, adminAutomationHost)
            // Personal financial automation is only started by an active paid license.
            runCatching { SyncService.syncNow(this) }
            refreshRemoteProfileCache()
            refreshSms()
            refreshDashboardOverview(force = true)
            refreshDashboardRecent()
        }
        refreshRemoteGameCatalog { renderMarket() }
        if (!startupUpdateCheckDone) {
            startupUpdateCheckDone = true
            handler.postDelayed({ if (!isFinishing && !isDestroyed) checkForAppUpdate(showIfCurrent = false) }, 1400L)
        }
    }

    private fun selectDashboardSection(
        section: String,
        pageTitle: TextView,
        pageSubtitle: TextView,
        homeSection: LinearLayout,
        activitySection: LinearLayout,
        cashSection: LinearLayout,
        marketSection: LinearLayout,
        navItems: Map<String, LinearLayout>
    ) {
        assistantDashboardSection = section
        homeSection.visibility = if (section == "home") View.VISIBLE else View.GONE
        activitySection.visibility = if (section == "activity") View.VISIBLE else View.GONE
        cashSection.visibility = if (section == "cash") View.VISIBLE else View.GONE
        marketSection.visibility = if (section == "market") View.VISIBLE else View.GONE
        val labels = when (section) {
            "activity" -> "Centro de actividad" to "Todos tus movimientos y estados de sincronización."
            "cash" -> "Libro de caja" to "Evolución del flujo de dinero por período."
            "market" -> "Game Market" to "Catálogo de recargas y servicios de juegos."
            else -> "Resumen financiero" to "Tu actividad financiera, en una sola vista."
        }
        pageTitle.text = labels.first
        pageSubtitle.text = labels.second
        navItems.forEach { (key, view) ->
            val active = key == section
            view.background = if (active) roundedBackground(blendSurfaceColor(SURFACE2, RED, 0.18f), 15, RED, 1)
                else ColorDrawable(Color.TRANSPARENT)
            val col = if (active) TEXT else MUTED
            for (i in 0 until view.childCount) {
                when (val child = view.getChildAt(i)) {
                    is TextView -> child.setTextColor(col)
                    is NavigationGlyphView -> child.tint = col
                }
            }
        }
        if (section == "activity") refreshSms()
        if (section == "cash") refreshEcon()
        if (section == "home") {
            refreshDashboardOverview()
            refreshDashboardRecent()
        }
        showAssistantContextualTip(section)
        if (section == "home") scheduleAssistantSpontaneousPresence()
    }

    private fun loadGameCatalogImage(item: GameCatalogItem, imageView: ImageView, fallback: View) {
        val local = item.imageUri
        if (!local.isNullOrBlank()) {
            val key = "local:$local"
            imageView.tag = key
            runCatching {
                imageView.setImageURI(android.net.Uri.parse(local))
                imageView.visibility = View.VISIBLE
                fallback.visibility = View.GONE
            }.onFailure {
                imageView.visibility = View.GONE
                fallback.visibility = View.VISIBLE
            }
        } else {
            loadGameThumbnail(item.imageUrl, imageView, fallback)
        }
    }

    private fun loadGameThumbnail(url: String?, imageView: ImageView, fallback: View) {
        if (url.isNullOrBlank()) return
        val cached = synchronized(gameThumbnailCache) { gameThumbnailCache[url] }
        if (cached != null) {
            imageView.setImageBitmap(cached)
            imageView.visibility = View.VISIBLE
            fallback.visibility = View.GONE
            return
        }
        imageView.tag = url
        uiScope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 4500
                        readTimeout = 4500
                        instanceFollowRedirects = true
                        setRequestProperty("User-Agent", "SynthesisOne-GameCatalog/1.0")
                    }
                    try {
                        connection.inputStream.use { BitmapFactory.decodeStream(it) }
                    } finally {
                        connection.disconnect()
                    }
                }.getOrNull()
            }
            if (bitmap != null) {
                synchronized(gameThumbnailCache) { gameThumbnailCache[url] = bitmap }
                if (imageView.tag == url) {
                    imageView.setImageBitmap(bitmap)
                    imageView.visibility = View.VISIBLE
                    fallback.visibility = View.GONE
                }
            }
        }
    }

    private fun buildGameMarketSection(
        games: List<GameCatalogItem>,
        onGameSelected: (GameCatalogItem) -> Unit,
        onCatalogChanged: () -> Unit
    ): LinearLayout {
        val section = ll()
        section.addView(txt("GAME MARKET", 9f, PURPLE, bold=true, ls=.15f, bot=5))
        section.addView(txt("Recargas y servicios", 22f, TEXT, bold=true, bot=4))
        section.addView(txt("Busca por nombre, categoría o paquete.", 11f, TEXT2, bot=7))
        section.addView(btn("🎯  MISIONES · CUPONES · REFERIDOS").apply {
            textSize = 10f; isAllCaps = false
            setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, PURPLE, 1)
            visibility = View.VISIBLE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { bottomMargin = dp(this@MainActivity, 8) }
            setOnClickListener { openRewardsEntry() }
        })
        section.addView(btn("▣  MI WALLET · SALDO Y RECARGAS").apply {
            textSize = 10f; isAllCaps = false
            setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, Color.parseColor("#2E806B"), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { bottomMargin = dp(this@MainActivity, 10) }
            setOnClickListener { openWalletPanel() }
        })
        section.addView(btn("🛒  MI CARRITO · ${loadLocalCartItems().length()} OFERTAS").apply {
            textSize = 10f; isAllCaps = false
            setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, PURPLE, 1)
            visibility = View.VISIBLE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { bottomMargin = dp(this@MainActivity, 10) }
            setOnClickListener { openStoreCartEntry() }
        })
        val storeAnnouncementsHost = ll().apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 8) }
        }
        section.addView(storeAnnouncementsHost)
        loadStoreAnnouncements(storeAnnouncementsHost)
        section.addView(txt("BUSCAR POR NOMBRE", 9f, PURPLE, bold=true, ls=.10f, top=3, bot=4))

        // Search and category filters are deliberately placed near the top so users can find ETECSA or a game without scrolling the catalogue.
        val search = inp("Escribe un juego, ETECSA o un paquete…", maxLen = 90).apply {
            textSize = 13f
            setSingleLine(true)
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
            background = roundedBackground(SURFACE, 13, blendSurfaceColor(RED, MUTED, 0.34f), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 50)).apply { bottomMargin = dp(this@MainActivity, 8) }
            contentDescription = "Buscar juego o paquete por nombre"
        }
        section.addView(search)

        var selectedFilter = "ALL"
        val filterRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val filterViews = linkedMapOf<String, TextView>()
        var rerender: (() -> Unit)? = null
        fun addFilter(key: String, label: String) {
            val view = txt(label, 9f, TEXT2, bold=true).apply {
                setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 8), dp(this@MainActivity, 12), dp(this@MainActivity, 8))
                background = roundedBackground(SURFACE2, 18, Color.parseColor("#30384E"), 1)
                setOnClickListener {
                    selectedFilter = key
                    filterViews.forEach { (filterKey, chipView) ->
                        val active = filterKey == selectedFilter
                        val activeFill = RED
                        chipView.setTextColor(if (active) contrastingTextColor(activeFill) else TEXT2)
                        chipView.background = roundedBackground(if (active) activeFill else SURFACE2, 18, if (active) RED else blendSurfaceColor(MUTED, SURFACE2, 0.24f), 1)
                    }
                    rerender?.invoke()
                }
            }
            filterViews[key] = view
            filterRow.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = dp(this@MainActivity, 7)
            })
        }
        addFilter("ALL", "TODO")
        addFilter("ETECSA", "ETECSA")
        filterViews.forEach { (key, view) ->
            val active = key == selectedFilter
            val activeFill = RED
            view.setTextColor(if (active) contrastingTextColor(activeFill) else TEXT2)
            view.background = roundedBackground(if (active) activeFill else SURFACE2, 18, if (active) RED else blendSurfaceColor(MUTED, SURFACE2, 0.24f), 1)
        }
        val filterScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            clipToPadding = false
            addView(filterRow)
        }
        section.addView(filterScroll)

        if (prefs.getString("so_market_price_tier", "normal").equals("reseller", true)) {
            section.addView(txt("✦  SO RESELLER · PRECIOS ESPECIALES ACTIVOS", 9f, GREEN, bold=true, ls=.05f, bot=12).apply {
                setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 7), dp(this@MainActivity, 10), dp(this@MainActivity, 7))
                val resellerFill = if (isLightPalette()) blendSurfaceColor(SURFACE2, GREEN, 0.11f) else Color.parseColor("#12352F")
                val resellerEdge = if (isLightPalette()) blendSurfaceColor(GREEN, SURFACE2, 0.40f) else Color.parseColor("#257C68")
                background = roundedBackground(resellerFill, 10, resellerEdge, 1)
            })
        } else {
            section.addView(space(6))
        }

        val hero = FrameLayout(this).apply {
            val heroColors = if (isLightPalette()) intArrayOf(SURFACE, blendSurfaceColor(SURFACE2, RED, 0.12f), SURFACE2)
                else intArrayOf(blendSurfaceColor(SURFACE2, RED, 0.28f), SURFACE, blendSurfaceColor(SURFACE2, PURPLE, 0.14f))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, heroColors).apply {
                cornerRadius = dp(this@MainActivity, if (selectedLayoutStyle() == "minimal") 15 else 20).toFloat()
                setStroke(dp(this@MainActivity, 1), blendSurfaceColor(RED, MUTED, if (isLightPalette()) 0.38f else 0.20f, 210))
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 126)).apply {
                bottomMargin = dp(this@MainActivity, 13)
            }
            clipToOutline = true
        }
        val glow = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(blendSurfaceColor(RED, PURPLE, 0.50f, if (isLightPalette()) 25 else 45))
            }
            layoutParams = FrameLayout.LayoutParams(dp(this@MainActivity, 170), dp(this@MainActivity, 170), Gravity.END or Gravity.CENTER_VERTICAL).apply {
                rightMargin = dp(this@MainActivity, -38)
            }
        }
        hero.addView(glow)
        val heroText = ll().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 14), dp(this@MainActivity, 16), dp(this@MainActivity, 14))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        heroText.addView(txt("TU PRÓXIMA RECARGA", 8f, RED, bold=true, ls=.12f, bot=5))
        heroText.addView(txt("Juega. Recarga.\nSigue avanzando.", 20f, TEXT, bold=true, bot=6))
        heroText.addView(txt("Ofertas disponibles y precios claros", 9f, TEXT2))
        hero.addView(heroText)
        section.addView(hero)

        // Provider health tools stay admin-only and are backed by the real upstream API.
        if (isCatalogAdmin()) section.addView(buildRechargeGamesAdminTools())

        // Admin entry stays above catalog rows; it must never be buried after hundreds of items.
        if (isCatalogAdmin()) {
            section.addView(btn("⚙  ADMINISTRAR CATÁLOGO Y OFERTAS").apply {
                textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, RED, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 48)).apply { bottomMargin = dp(this@MainActivity, 12) }
                setOnClickListener { showGameCatalogAdmin(onCatalogChanged) }
            })
        }


        val catalogHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(this@MainActivity, 9), 0, dp(this@MainActivity, 7))
        }
        catalogHeader.addView(txt("CATÁLOGO", 9f, TEXT2, bold=true, ls=.12f).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val countView = txt("0", 8f, MUTED, bold=true).apply {
            setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 5), dp(this@MainActivity, 8), dp(this@MainActivity, 5))
            background = pillBackground(PURPLE, 22)
        }
        catalogHeader.addView(countView)
        section.addView(catalogHeader)
        val grid = ll()
        section.addView(grid)

        rerender = {
            val query = normalizeMarketSearch(search.text?.toString().orEmpty().trim())
            // El endpoint de admin ya trae todos los registros; no ocultamos juegos en la interfaz.
            val base = games
            val visible = base.filter { game ->
                val gameSearchable = buildString {
                    append(game.name).append(' ')
                    append(game.subtitle).append(' ')
                    append(game.description).append(' ')
                    append(game.badge).append(' ')
                    game.offers.forEach { offer ->
                        append(offer.title).append(' ')
                        append(offer.description).append(' ')
                        append(offer.category).append(' ')
                    }
                }
                val isEtecsa = gameSearchable.contains("etecsa", true) || normalizeMarketSearch(game.subtitle).contains("telecomunic")
                val filterMatches = selectedFilter != "ETECSA" || isEtecsa
                filterMatches && (query.isBlank() || normalizeMarketSearch(gameSearchable).contains(query))
            }
            countView.text = "${visible.size} ${if (visible.size == 1) "RESULTADO" else "RESULTADOS"}"
            grid.removeAllViews()
            if (visible.isEmpty()) {
                val empty = ll().apply {
                    setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 18), dp(this@MainActivity, 14), dp(this@MainActivity, 18))
                    background = roundedBackground(SURFACE, 14, Color.parseColor("#29354B"), 1)
                }
                val catalogUnavailable = base.isEmpty()
                empty.addView(txt(
                    when {
                        catalogUnavailable -> "No se pudo cargar el catálogo"
                        query.isBlank() && selectedFilter == "ETECSA" -> "ETECSA todavía no tiene ofertas publicadas."
                        else -> "No encontramos resultados"
                    }, 13f, TEXT, bold=true, bot=4))
                empty.addView(txt(
                    when {
                        catalogUnavailable -> "No pudimos cargar las ofertas ahora. Comprueba tu conexión e inténtalo de nuevo; no mostraremos precios inventados ni compras de prueba."
                        selectedFilter == "ETECSA" -> "Las ofertas se mostrarán aquí cuando estén disponibles."
                        else -> "Prueba con otro nombre, paquete o categoría."
                    }, 10f, TEXT2))
                if (catalogUnavailable) empty.addView(btn("REINTENTAR CARGA DEL CATÁLOGO").apply {
                    textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, PURPLE, 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 42)).apply { topMargin = dp(this@MainActivity, 10) }
                    setOnClickListener {
                        isEnabled = false
                        text = "CONSULTANDO…"
                        refreshRemoteGameCatalog { onCatalogChanged() }
                    }
                })
                if (isCatalogAdmin()) empty.addView(btn("AÑADIR / REVISAR CATÁLOGO").apply {
                    textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, PURPLE, 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 42)).apply { topMargin = dp(this@MainActivity, 10) }
                    setOnClickListener { showGameCatalogAdmin(onCatalogChanged) }
                })
                grid.addView(empty)
            } else {
                visible.chunked(2).forEachIndexed { rowIndex, rowGames ->
                    val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP }
                    rowGames.forEachIndexed { colIndex, item ->
                        val tile = buildGameCatalogTile(item) { onGameSelected(item) }
                        row.addView(tile, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                            if (colIndex == 0) marginEnd = dp(this@MainActivity, 7) else marginStart = dp(this@MainActivity, 7)
                        })
                    }
                    if (rowGames.size == 1) row.addView(View(this@MainActivity), LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(this@MainActivity, 7) })
                    grid.addView(row)
                    if (rowIndex < (visible.size + 1) / 2 - 1) grid.addView(space(12))
                }
            }
        }
        var pendingSearchRender: Runnable? = null
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                pendingSearchRender?.let { search.removeCallbacks(it) }
                val task = Runnable { rerender?.invoke() }
                pendingSearchRender = task
                search.postDelayed(task, 140L)
            }
            override fun afterTextChanged(s: android.text.Editable?) = Unit
        })
        rerender?.invoke()
        section.addView(txt("Los precios aparecen en CUP y Saldo Móvil. Las operaciones de compra se habilitarán cuando el servicio correspondiente esté disponible.", 10f, MUTED, top=10, bot=8))
        return section
    }

    private fun buildGameCatalogTile(item: GameCatalogItem, onClick: () -> Unit): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBackground(SURFACE, 17, blendSurfaceColor(RED, MUTED, if (isLightPalette()) 0.38f else 0.25f), 1)
            isClickable = true
            isFocusable = true
            clipToOutline = true
            setOnClickListener { onClick() }
        }
        val thumb = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(item.accent, item.deepAccent, BG)).apply {
                cornerRadius = dp(this@MainActivity, 15).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 116)).apply {
                setMargins(dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 5), 0)
            }
            clipToOutline = true
        }
        val orbit = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(34, 255, 255, 255))
                setStroke(dp(this@MainActivity, 1), Color.argb(50, 255, 255, 255))
            }
            layoutParams = FrameLayout.LayoutParams(dp(this@MainActivity, 92), dp(this@MainActivity, 92), Gravity.END or Gravity.TOP).apply {
                rightMargin = dp(this@MainActivity, -18); topMargin = dp(this@MainActivity, -18)
            }
        }
        thumb.addView(orbit)
        val monogram = TextView(this).apply {
            text = item.monogram
            textSize = if (item.monogram.length >= 4) 22f else 29f
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
            letterSpacing = .02f
            setShadowLayer(dp(this@MainActivity, 9).toFloat(), 0f, dp(this@MainActivity, 2).toFloat(), Color.argb(150, 0, 0, 0))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        thumb.addView(monogram)
        val coverImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(item.accent, item.deepAccent))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        thumb.addView(coverImage)
        loadGameCatalogImage(item, coverImage, monogram)
        val badge = TextView(this).apply {
            text = item.badge
            textSize = 7f
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = .06f
            gravity = Gravity.CENTER
            setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 4), dp(this@MainActivity, 7), dp(this@MainActivity, 4))
            background = roundedBackground(Color.argb(105, 9, 10, 20), 12, Color.argb(80, 255, 255, 255), 1)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
                setMargins(dp(this@MainActivity, 8), dp(this@MainActivity, 8), 0, 0)
            }
        }
        thumb.addView(badge)
        card.addView(thumb)

        val details = ll().apply { setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 11)) }
        details.addView(txt(item.name, 12f, TEXT, bold=true, bot=4))
        details.addView(txt(item.subtitle, 9f, TEXT2, bot=8))
        val linkRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        linkRow.addView(txt("VER CATÁLOGO", 8f, RED, bold=true, ls=.04f).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        linkRow.addView(txt("↗", 14f, item.accent, bold=true))
        details.addView(linkRow)
        card.addView(details)
        return card
    }

    private fun isOfferConnectedToProvider(offer: GameOfferItem): Boolean {
        // provider_connected is set from authoritative database provider columns by the backend.
        // Do not trust a client-editable package_data marker to make an offer buyable.
        return offer.providerConnected || offer.packageData.optJSONObject("etecsa") != null
    }

    private fun isLegacyEtecsaCatalogItem(game: GameCatalogItem): Boolean {
        val name = game.name.trim()
        val id = game.id.trim()
        return name.startsWith("ETECSA", ignoreCase = true) ||
            id.equals("etecsa-live", ignoreCase = true) ||
            id.matches(Regex("(?i)^etecsa(?:[-_/].*)?$")) ||
            game.badge.contains("ETECSA", ignoreCase = true)
    }

    /**
     * Conservative client-side classification: never removes or rewrites catalog rows.
     * Unknown provider naming stays under "Otros paquetes" and remains visible in "Todas".
     */
    private fun marketOfferGroup(offer: GameOfferItem): String {
        val raw = buildString {
            append(offer.category).append(' ')
            append(offer.title).append(' ')
            append(offer.description).append(' ')
            // Providers often put product type/category fields inside package_data. Reading the
            // entire JSON as text avoids assuming a fixed provider schema across 300+ games.
            append(offer.packageData.toString())
        }
        val value = normalizeMarketSearch(raw)
        val subscriptionPattern = Regex("\\b(battle\\s*passes?|elite\\s*passes?|premium\\s*passes?|monthly\\s*cards?|weekly\\s*cards?|month\\s*passes?|subscription|suscripciones?|suscripcion|membresias?|membresia|membership|mensualidades?|mensual|monthly|weekly|bendiciones?|blessings?|welkin|moon\\s*(pass|blessing)|pases?|passes?)\\b")
        if (subscriptionPattern.containsMatchIn(value)) return "PASSES"

        val currencyPattern = Regex("\\b(diamantes?|diamonds?|cod\\s*points|cp|uc|tokens?|monedas?|coins?|gems?|gemas?|crystals?|cristales|primogems?|stellar\\s*jade|shards?|creditos?|credits?|gold|rubies|recargas?|top\\s*up|topup|points?)\\b")
        if (currencyPattern.containsMatchIn(value)) return "CURRENCY"
        return "OTHER"
    }

    private fun marketOfferGroupLabel(offer: GameOfferItem): String = when (marketOfferGroup(offer)) {
        "PASSES" -> "PASES Y MEMBRESÍAS"
        "CURRENCY" -> "MONEDAS Y RECARGAS"
        else -> "OTROS PAQUETES"
    }

    private fun mobileLegendsDiamondCount(offer: GameOfferItem): Long? {
        val provider = offer.packageData.optJSONObject("rechargegames")
        val searchable = listOf(
            offer.title,
            offer.description,
            provider?.optString("product_name", "").orEmpty(),
            provider?.optString("product_title", "").orEmpty(),
            provider?.optString("name", "").orEmpty(),
            provider?.optString("package_name", "").orEmpty(),
            provider?.optString("product_key", "").orEmpty()
        ).joinToString(" ")
        val match = Regex("(?i)(\\d[\\d.,]*)\\s*(?:diamonds?|diamantes?)").find(searchable) ?: return null
        val quantity = match.groupValues.getOrNull(1)?.replace(Regex("[^0-9]"), "")?.toLongOrNull() ?: return null
        return quantity.takeIf { it in 1L..1_000_000L }
    }

    private fun buildMobileLegendsValueAdvisor(offers: List<GameOfferItem>, regionLabel: String?): View? {
        val comparable = offers.filter { it.active && it.available }
            .mapNotNull { offer -> mobileLegendsDiamondCount(offer)?.let { quantity -> offer to quantity } }
        if (comparable.size < 2) return null
        val bestCup = comparable.filter { it.first.priceCup > 0L }
            .minByOrNull { it.first.priceCup.toDouble() / it.second }
        if (bestCup == null) return null
        val secondCup = comparable.filter { it.first.id != bestCup.first.id && it.first.priceCup > 0L }
            .minByOrNull { it.first.priceCup.toDouble() / it.second }
        val card = ll().apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 11), dp(this@MainActivity, 13), dp(this@MainActivity, 11))
            background = roundedBackground(SURFACE2, 14, PURPLE, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 10) }
        }
        card.addView(txt("✦  SO ASSISTANT · COMPARADOR DE DIAMANTES", 8f, PURPLE, bold = true, ls = .05f, bot = 5))
        val regionText = regionLabel?.takeIf { it.isNotBlank() }?.let { " en $it" }.orEmpty()
        card.addView(txt(
            "Mejor relación precio/cantidad$regionText: ${bestCup.first.title} — ${formatCatalogPrice(bestCup.first.priceCup)} CUP por ${bestCup.second} diamantes.",
            10f, TEXT, bold = true, bot = 4
        ))
        val comparisonText = if (secondCup != null) {
            val bestRate = bestCup.first.priceCup.toDouble() / bestCup.second
            val nextRate = secondCup.first.priceCup.toDouble() / secondCup.second
            val advantage = if (nextRate > 0 && bestRate < nextRate) ((1.0 - bestRate / nextRate) * 100.0) else 0.0
            if (advantage >= 0.5) "Aproximadamente ${String.format(Locale.getDefault(), "%.1f", advantage)} % menos CUP por diamante que la siguiente alternativa comparable."
            else "Las alternativas comparables tienen un coste por diamante muy parecido."
        } else "La comparación usa únicamente paquetes disponibles de esta misma región y con cantidad de diamantes identificable."
        card.addView(txt(comparisonText, 9f, TEXT2))
        return card
    }

    private fun buildGameDetailSection(item: GameCatalogItem, onBack: () -> Unit, onOffersChanged: () -> Unit = {}): LinearLayout {
        val section = ll()
        section.addView(futuristicBackButton("←  VOLVER AL CATÁLOGO", onBack))
        val banner = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(item.accent, item.deepAccent, Color.parseColor("#0D111B"))).apply {
                cornerRadius = dp(this@MainActivity, 22).toFloat()
                setStroke(dp(this@MainActivity, 1), Color.argb(110, 255, 255, 255))
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 178)).apply {
                bottomMargin = dp(this@MainActivity, 15)
            }
            clipToOutline = true
        }
        val monogram = TextView(this).apply {
            text = item.monogram
            textSize = if (item.monogram.length >= 4) 40f else 53f
            setTextColor(Color.WHITE)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
            setShadowLayer(dp(this@MainActivity, 10).toFloat(), 0f, dp(this@MainActivity, 3).toFloat(), Color.argb(160, 0, 0, 0))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        banner.addView(monogram)
        val coverImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(item.accent, item.deepAccent))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        banner.addView(coverImage)
        loadGameCatalogImage(item, coverImage, monogram)
        banner.addView(txt(item.badge, 8f, Color.WHITE, bold=true, ls=.1f).apply {
            setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 7), dp(this@MainActivity, 10), dp(this@MainActivity, 7))
            background = roundedBackground(Color.argb(95, 8, 10, 18), 12, Color.argb(90, 255, 255, 255), 1)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
                setMargins(dp(this@MainActivity, 12), dp(this@MainActivity, 12), 0, 0)
            }
        })
        section.addView(banner)
        section.addView(txt(item.name, 22f, TEXT, bold=true, bot=4))
        section.addView(txt(item.subtitle, 11f, TEXT2, bot=18))

        // The shop view never presents a non-purchasable/manual row as a real offer,
        // including when the administrator is browsing the storefront. Legacy rows remain
        // available in the separate administration screens for cleanup.
        val visibleOffers = item.offers
            .filter { it.published }
            .filter { isOfferConnectedToProvider(it) }

        val offersHeader = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        offersHeader.addView(txt("OFERTAS", 10f, TEXT, bold=true, ls=.13f).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val availableCount = visibleOffers.count { it.active && it.available }
        offersHeader.addView(txt(if (availableCount > 0) "$availableCount DISPONIBLES" else "SIN OFERTAS", 8f, if (availableCount > 0) GREEN else MUTED, bold=true).apply {
            setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 5), dp(this@MainActivity, 8), dp(this@MainActivity, 5))
            background = pillBackground(if (availableCount > 0) GREEN else MUTED, 20)
        })
        section.addView(offersHeader)
        section.addView(space(9))

        fun offerRegionName(offer: GameOfferItem): String? {
            val provider = offer.packageData.optJSONObject("rechargegames")
            val region = provider?.optString("region_name", "").orEmpty().trim()
                .ifBlank { provider?.optString("region_slug", "").orEmpty().trim() }
            if (region.isNotBlank()) return region
            return null
        }

        // The provider catalog exposes one region group per region/server market. Selecting it
        // filters package cards and prices before checkout; it is not the in-game numeric server ID.
        val regionOptions = visibleOffers.mapNotNull { offerRegionName(it) }.distinct()
        val hasRegionSelector = regionOptions.size > 1
        var selectedRegion = regionOptions.firstOrNull()
        var regionSpinner: Spinner? = null
        if (hasRegionSelector) {
            section.addView(txt("REGIÓN / SERVIDOR DE RECARGA", 8f, PURPLE, bold = true, top = 2, bot = 5))
            regionSpinner = Spinner(this).apply {
                adapter = darkSpinnerAdapter(regionOptions)
                setSelection(0, false)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(this@MainActivity, 10)
                }
                contentDescription = "Selecciona la región del paquete para ver sus precios"
            }
            section.addView(regionSpinner)
            section.addView(txt("Los precios y paquetes cambian según la región seleccionada.", 9f, TEXT2, bot = 8))
        }

        val offerControls = ll().apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 10), dp(this@MainActivity, 12), dp(this@MainActivity, 8))
            background = roundedBackground(SURFACE, 14, Color.parseColor("#30384E"), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 8); bottomMargin = dp(this@MainActivity, 10) }
        }
        offerControls.addView(txt("FILTRAR Y ORDENAR OFERTAS", 9f, PURPLE, bold=true, ls=.08f, bot=6))
        offerControls.addView(txt("Separación orientativa según los metadatos/nombre de cada producto. Lo no identificado continúa en «Todas».", 9f, TEXT2, bot=5))
        val categoryOptions = listOf("Todas las ofertas", "Monedas y recargas", "Pases y mensualidades", "Otros paquetes")
        val categorySpinner = Spinner(this).apply {
            adapter = darkSpinnerAdapter(categoryOptions)
            setSelection(0, false)
            contentDescription = "Filtrar por tipo de oferta"
        }
        offerControls.addView(txt("TIPO DE OFERTA", 8f, TEXT2, bold=true, top=2, bot=2))
        offerControls.addView(categorySpinner)
        val sortOptions = listOf(
            "Precio CUP · menor a mayor",
            "Precio CUP · mayor a menor",
            "Precio Saldo Móvil · menor a mayor",
            "Precio Saldo Móvil · mayor a menor",
            "Nombre · A a Z",
            "Nombre · Z a A"
        )
        val initialOfferSort = prefs.getInt(PREF_MARKET_OFFER_SORT, 0).coerceIn(0, sortOptions.lastIndex)
        val sortSpinner = Spinner(this).apply {
            adapter = darkSpinnerAdapter(sortOptions)
            setSelection(initialOfferSort, false)
            contentDescription = "Ordenar ofertas por precio o nombre"
        }
        offerControls.addView(txt("ORDENAR POR", 8f, TEXT2, bold=true, top=4, bot=2))
        offerControls.addView(sortSpinner)
        section.addView(offerControls)

        var selectedOfferGroup = "ALL"
        var selectedOfferSort = initialOfferSort
        val offerCardsContainer = ll()
        section.addView(offerCardsContainer)
        fun renderOfferCards(regionFilter: String? = null) {
            offerCardsContainer.removeAllViews()
            val offersForRegion = if (hasRegionSelector && !regionFilter.isNullOrBlank()) {
                visibleOffers.filter { offerRegionName(it) == regionFilter }
            } else visibleOffers
            val categoryFilteredOffers = offersForRegion.filter { offer ->
                when (selectedOfferGroup) {
                    "CURRENCY" -> marketOfferGroup(offer) == "CURRENCY"
                    "PASSES" -> marketOfferGroup(offer) == "PASSES"
                    "OTHER" -> marketOfferGroup(offer) == "OTHER"
                    else -> true
                }
            }
            val sortedOffers = categoryFilteredOffers.sortedWith(Comparator { a, b ->
                val comparison = when (selectedOfferSort) {
                    0, 1 -> {
                        val av = a.priceCup
                        val bv = b.priceCup
                        when {
                            (av > 0) != (bv > 0) -> if (av > 0) -1 else 1
                            av <= 0 && bv <= 0 -> normalizeMarketSearch(a.title).compareTo(normalizeMarketSearch(b.title))
                            else -> (if (selectedOfferSort == 0) av.compareTo(bv) else bv.compareTo(av))
                        }
                    }
                    2, 3 -> {
                        val av = a.priceSaldo
                        val bv = b.priceSaldo
                        when {
                            (av > 0) != (bv > 0) -> if (av > 0) -1 else 1
                            av <= 0 && bv <= 0 -> normalizeMarketSearch(a.title).compareTo(normalizeMarketSearch(b.title))
                            else -> (if (selectedOfferSort == 2) av.compareTo(bv) else bv.compareTo(av))
                        }
                    }
                    4 -> normalizeMarketSearch(a.title).compareTo(normalizeMarketSearch(b.title))
                    5 -> normalizeMarketSearch(b.title).compareTo(normalizeMarketSearch(a.title))
                    else -> a.priceCup.compareTo(b.priceCup)
                }
                if (comparison == 0) normalizeMarketSearch(a.title).compareTo(normalizeMarketSearch(b.title)) else comparison
            })

            val isMobileLegends = item.name.contains("mobile legends", true) || item.name.contains("mobile legend", true)
            if (isMobileLegends && selectedOfferGroup in setOf("ALL", "CURRENCY")) {
                buildMobileLegendsValueAdvisor(offersForRegion, regionFilter)?.let { advisor -> offerCardsContainer.addView(advisor) }
            }

            if (sortedOffers.isEmpty()) {
                val emptyOffer = ll().apply {
                    gravity = Gravity.CENTER
                    setPadding(dp(this@MainActivity, 22), dp(this@MainActivity, 26), dp(this@MainActivity, 22), dp(this@MainActivity, 26))
                    background = roundedBackground(SURFACE, 18, blendSurfaceColor(RED, MUTED, 0.32f), 1)
                    minimumHeight = dp(this@MainActivity, 145)
                }
                emptyOffer.addView(txt("✦", 28f, RED, bold=true, bot=7))
                emptyOffer.addView(txt(if (offersForRegion.isEmpty()) "No hay ofertas disponibles" else "No hay ofertas de este tipo", 13f, TEXT, bold=true, bot=5))
                emptyOffer.addView(txt(
                    if (offersForRegion.isEmpty() && isCatalogAdmin()) "No hay ofertas conectadas para esta región. Usa Administración de catálogo para revisar los registros o actualiza el catálogo del proveedor."
                    else if (offersForRegion.isEmpty()) "Las ofertas aparecerán aquí cuando estén disponibles."
                    else "Cambia el filtro a «Todas las ofertas» para revisar el catálogo completo.",
                    10f, TEXT2
                ))
                offerCardsContainer.addView(emptyOffer)
                return
            }

            sortedOffers.forEach { offer ->
                val card = ll().apply {
                    setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 13), dp(this@MainActivity, 14), dp(this@MainActivity, 13))
                    background = roundedBackground(SURFACE, 16, Color.parseColor("#2A3043"), 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 9) }
                }
                val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val titleColumn = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
                titleColumn.addView(txt(offer.title, 13f, TEXT, bold=true))
                titleColumn.addView(txt(marketOfferGroupLabel(offer), 7f, TEXT2, bold=true, top=3))
                head.addView(titleColumn)
                if (isMobileLegends && offer.active && offer.available && offer.priceCup > 0L &&
                    mobileLegendsDiamondCount(offer) != null &&
                    offersForRegion.filter { it.active && it.available && it.priceCup > 0L && mobileLegendsDiamondCount(it) != null }
                        .minByOrNull { it.priceCup.toDouble() / (mobileLegendsDiamondCount(it) ?: Long.MAX_VALUE).coerceAtLeast(1L) }?.id == offer.id) {
                    head.addView(txt("✦ MEJOR VALOR", 7f, GREEN, bold=true).apply { setPadding(dp(this@MainActivity, 6), dp(this@MainActivity, 4), dp(this@MainActivity, 6), dp(this@MainActivity, 4)) })
                }
                head.addView(txt(if (!offer.available) "AGOTADO" else "DISPONIBLE", 7f, if (offer.available) GREEN else MUTED, bold=true))
                card.addView(head)
                if (offer.description.isNotBlank()) card.addView(txt(offer.description, 10f, TEXT2, top=3, bot=8)) else card.addView(space(6))
                val prices = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                prices.addView(catalogOfferPrice("CUP", if (offer.priceCup > 0) "${formatCatalogPrice(offer.priceCup)} CUP" else "—"), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                prices.addView(space(8, horiz=true))
                prices.addView(catalogOfferPrice("SALDO MÓVIL", if (offer.priceSaldo > 0) formatCatalogPrice(offer.priceSaldo) else "—"), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                card.addView(prices)

                val isEtecsaOffer = offer.packageData.optJSONObject("etecsa") != null
                val isAutomaticProviderOffer = isOfferConnectedToProvider(offer)
                if (offer.available && (isEtecsaOffer || isAutomaticProviderOffer)) {
                    card.addView(btn("COMPRAR / CONTINUAR").apply {
                        textSize = 10f; isAllCaps = false
                        setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 11, RED, 1)
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 42)).apply { topMargin = dp(this@MainActivity, 9) }
                        setOnClickListener { beginOfferCheckout(item, offer) }
                    })
                    if (prefs.getBoolean(PREF_CART_FEATURE_AVAILABLE, false)) {
                        card.addView(btn("＋ AÑADIR AL CARRITO").apply {
                            textSize = 10f; isAllCaps = false
                            setTextColor(TEXT); background = roundedBackground(SURFACE2, 11, PURPLE, 1)
                            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 40)).apply { topMargin = dp(this@MainActivity, 6) }
                            setOnClickListener { beginOfferAddToCart(item, offer) }
                        })
                    }
                }
                offerCardsContainer.addView(card)
            }
        }
        renderOfferCards(selectedRegion)
        categorySpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectedOfferGroup = when (position) { 1 -> "CURRENCY"; 2 -> "PASSES"; 3 -> "OTHER"; else -> "ALL" }
                renderOfferCards(selectedRegion)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        sortSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectedOfferSort = position.coerceIn(0, sortOptions.lastIndex)
                prefs.edit().putInt(PREF_MARKET_OFFER_SORT, selectedOfferSort).apply()
                renderOfferCards(selectedRegion)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        regionSpinner?.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectedRegion = regionOptions.getOrNull(position)
                renderOfferCards(selectedRegion)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        if (isCatalogAdmin() && item.id != "etecsa-live") {
            val manageOffers = btn("＋  AÑADIR / EDITAR OFERTAS").apply {
                textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, RED, 1)
                setOnClickListener { showGameOffersAdmin(item.id) { onOffersChanged() } }
            }
            section.addView(manageOffers)
        }
        section.addView(txt("Las ofertas y los precios se actualizan con la información disponible. El estado de cada pedido cambia cuando se confirma el pago; no se muestran compras de demostración.", 9f, MUTED, top=12, bot=8))
        return section
    }

    private fun catalogOfferPrice(label: String, value: String): View {
        val cell = ll().apply {
            setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 8), dp(this@MainActivity, 10), dp(this@MainActivity, 8))
            background = roundedBackground(SURFACE2, 11, Color.TRANSPARENT, 0)
        }
        cell.addView(txt(label, 8f, TEXT2, bold=true, bot=4))
        cell.addView(txt(value.ifBlank { "—" }, 12f, if (value.isBlank() || value == "—") MUTED else GREEN, bold=true))
        return cell
    }

    private fun showGameCatalogAdmin(onChanged: () -> Unit) {
        if (!isDeviceOnline()) { showSoToast("La administración del catálogo requiere conexión.", Toast.LENGTH_LONG); return }
        if (!isCatalogAdmin()) {
            showSoToast("Solo los administradores pueden editar el catálogo.", Toast.LENGTH_LONG)
            return
        }
        val content = ll().apply {
            setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 12), dp(this@MainActivity, 14), dp(this@MainActivity, 14))
            setBackgroundColor(BG)
        }
        val scroll = ScrollView(this).apply {
            addView(content)
            setBackgroundColor(BG)
            isFillViewport = true
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (resources.displayMetrics.heightPixels * 0.68f).toInt())
        }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Administrar Game Market").setView(scroll).setNegativeButton("Cerrar", null).create()
        var catalogFilterQuery = ""

        fun refreshRows() {
            content.removeAllViews()
            content.addView(txt("CATÁLOGO OFICIAL · ADMINISTRACIÓN", 9f, RED, bold=true, ls=.12f, bot=4))
            content.addView(txt("Los cambios se validan y guardan de forma segura. El coste USD es información interna y nunca se muestra al comprador.", 10f, TEXT2, bot=10))

            content.addView(txt("TASAS DE REFERENCIA (ADMIN)", 9f, PURPLE, bold=true, ls=.09f, top=8, bot=5))
            val ratesCard = ll().apply { background = roundedBackground(SURFACE2, 12, Color.parseColor("#2A3043"), 1); setPadding(dp(this@MainActivity, 11), dp(this@MainActivity, 10), dp(this@MainActivity, 11), dp(this@MainActivity, 10)) }
            ratesCard.addView(txt("Configura tasas independientes para clientes normales y reseller. Las tasas se introducen manualmente y las compras automáticas aún no están activadas.", 9f, TEXT2, bot=8))
            val tiers = listOf("Cliente normal" to "normal", "SO Reseller" to "reseller")
            val tierSpinner = Spinner(this@MainActivity).apply {
                adapter = darkSpinnerAdapter(tiers.map { it.first })
                background = roundedBackground(SURFACE2, 9, Color.parseColor("#35405A"), 1)
            }
            ratesCard.addView(lbl("GRUPO DE PRECIOS", top=2)); ratesCard.addView(tierSpinner)
            val usdCupInput = inp("", maxLen=14).apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL; setText(prefs.getString("so_rate_usd_cup_normal", prefs.getInt(PREF_RATE_USD_CUP, 1050).toString())) }
            val usdSaldoInput = inp("", maxLen=14).apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL; setText(prefs.getString("so_rate_usd_saldo_normal", prefs.getInt(PREF_RATE_USD_SALDO, 380).toString())) }
            val marginInput = inp("", maxLen=8).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                setText(prefs.getString("so_market_margin_normal", prefs.getString(PREF_MARKET_MARGIN, "0").orEmpty()))
            }
            val roundingInput = inp("Paso de redondeo CUP (ej. 5)", maxLen=5, numeric=true).apply { setText(prefs.getInt("so_market_rounding_cup_normal", prefs.getInt(PREF_MARKET_ROUNDING, 5)).toString()) }
            val saldoRoundingInput = inp("Paso de redondeo Saldo Móvil", maxLen=5, numeric=true).apply { setText(prefs.getInt("so_market_rounding_saldo_normal", 1).toString()) }
            val roundingModeOptions = listOf("Hacia arriba" to "ceil", "Al más cercano" to "nearest", "Hacia abajo" to "floor")
            val roundingModeSpinner = Spinner(this@MainActivity).apply {
                adapter = darkSpinnerAdapter(roundingModeOptions.map { it.first })
                background = roundedBackground(SURFACE2, 9, Color.parseColor("#35405A"), 1)
            }
            ratesCard.addView(lbl("TASA DE CONVERSIÓN · 1 USD A CUP", top=10)); ratesCard.addView(usdCupInput)
            ratesCard.addView(lbl("TASA DE CONVERSIÓN · 1 USD A SALDO MÓVIL", top=2)); ratesCard.addView(usdSaldoInput)
            ratesCard.addView(lbl("MARGEN DE BENEFICIO AUTOMÁTICO (%)", top=2)); ratesCard.addView(marginInput)
            ratesCard.addView(lbl("REDONDEO DEL PRECIO EN CUP", top=2)); ratesCard.addView(roundingInput)
            ratesCard.addView(lbl("REDONDEO DEL PRECIO EN SALDO MÓVIL", top=2)); ratesCard.addView(saldoRoundingInput)
            ratesCard.addView(lbl("MODO DE REDONDEO", top=3)); ratesCard.addView(roundingModeSpinner)
            fun loadTierInputs(tier: String) {
                usdCupInput.setText(prefs.getString("so_rate_usd_cup_$tier", if (tier == "normal") prefs.getInt(PREF_RATE_USD_CUP, 1050).toString() else "1050"))
                usdSaldoInput.setText(prefs.getString("so_rate_usd_saldo_$tier", if (tier == "normal") prefs.getInt(PREF_RATE_USD_SALDO, 380).toString() else "380"))
                marginInput.setText(prefs.getString("so_market_margin_$tier", if (tier == "normal") prefs.getString(PREF_MARKET_MARGIN, "0").orEmpty() else "0"))
                roundingInput.setText(prefs.getInt("so_market_rounding_cup_$tier", if (tier == "normal") prefs.getInt(PREF_MARKET_ROUNDING, 5) else 5).toString())
                saldoRoundingInput.setText(prefs.getInt("so_market_rounding_saldo_$tier", 1).toString())
                val mode = prefs.getString("so_market_rounding_mode_$tier", "ceil")
                roundingModeSpinner.setSelection(roundingModeOptions.indexOfFirst { it.second == mode }.coerceAtLeast(0))
            }
            tierSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
                override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) { loadTierInputs(tiers.getOrNull(position)?.second ?: "normal") }
            }
            ratesCard.addView(btn("GUARDAR TASAS Y RECALCULAR OFERTAS AUTOMÁTICAS").apply {
                textSize = 9f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 10, RED, 0)
                setOnClickListener {
                    val rateCup = usdCupInput.text.toString().toDoubleOrNull()
                    val rateSaldo = usdSaldoInput.text.toString().toDoubleOrNull()
                    val margin = marginInput.text.toString().toDoubleOrNull() ?: 0.0
                    val rounding = roundingInput.text.toString().toIntOrNull() ?: 5
                    val saldoRounding = saldoRoundingInput.text.toString().toIntOrNull() ?: 1
                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                    if (token.isBlank() || !isDeviceOnline()) { showSoToast("La administración de precios necesita una sesión de admin y conexión.", Toast.LENGTH_LONG); return@setOnClickListener }
                    if (rateCup == null || rateCup <= 0 || rateSaldo == null || rateSaldo <= 0 || margin < 0 || rounding <= 0 || saldoRounding <= 0 || rounding.toDouble() % 1.0 != 0.0 || saldoRounding.toDouble() % 1.0 != 0.0) {
                        showSoToast("Revisa las tasas, el margen y los redondeos.", Toast.LENGTH_LONG); return@setOnClickListener
                    }
                    val tier = tiers.getOrNull(tierSpinner.selectedItemPosition)?.second ?: "normal"
                    val mode = roundingModeOptions.getOrNull(roundingModeSpinner.selectedItemPosition)?.second ?: "ceil"
                    val payload = JSONObject().put("tier", tier).put("usd_to_cup", rateCup).put("usd_to_saldo", rateSaldo)
                        .put("profit_margin_pct", margin).put("cup_rounding_step", rounding).put("saldo_rounding_step", saldoRounding).put("rounding_mode", mode)
                    isEnabled = false
                    uiScope.launch {
                        var requestException: Exception? = null
                        val response = withContext(Dispatchers.IO) {
                            try { adminMarketRequest(token, "/pricing", "PUT", payload) }
                            catch (e: Exception) { requestException = e; null }
                        }
                        isEnabled = true
                        if (response != null && response.code in 200..299) {
                            val result = runCatching { JSONObject(response.body) }.getOrNull()
                            val pricing = result?.optJSONObject("pricing")
                            if (pricing != null) applyRemotePricingToPrefs(pricing, tier)
                            refreshRemoteGameCatalog { refreshRows(); onChanged() }
                            showSoToast("Reglas de precios guardadas. Las ofertas automáticas usarán estas tasas al consultarse.", Toast.LENGTH_LONG)
                        } else {
                            val body = response?.body.orEmpty()
                            val apiError = runCatching { JSONObject(body).optString("error") }.getOrNull().orEmpty()
                            val internalDetail = apiError.takeIf { it.isNotBlank() } ?: body.take(300)
                            android.util.Log.e(
                                "SO/GameMarket",
                                "Falló el guardado de reglas tier=$tier; code=${response?.code}; detail=${internalDetail.take(220)}; cause=${requestException?.javaClass?.simpleName}",
                                requestException
                            )
                            val detail = when {
                                response?.code == 401 || response?.code == 403 -> "Tu sesión no tiene permiso para cambiar estos precios."
                                response?.code == 400 -> "Revisa las tasas y reglas introducidas."
                                response != null -> "El servicio no pudo guardar los cambios (código ${response.code})."
                                else -> "No se pudo conectar. Comprueba Internet e inténtalo otra vez."
                            }
                            showSoToast("No se pudieron guardar las reglas de precios. $detail", Toast.LENGTH_LONG)
                        }
                    }
                }
            })
            content.addView(ratesCard)

            content.addView(btn("＋  AÑADIR JUEGO").apply {
                textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 11, RED, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { topMargin = dp(this@MainActivity, 12); bottomMargin = dp(this@MainActivity, 8) }
                setOnClickListener { showGameEditor(null) { refreshRows(); onChanged() } }
            })

            content.addView(txt("BUSCAR JUEGO O SERVICIO", 9f, PURPLE, bold=true, ls=.08f, top=12, bot=4))
            val adminSearch = inp("Nombre, ETECSA, categoría o paquete…", maxLen = 90).apply {
                setText(catalogFilterQuery)
                setSingleLine(true)
                imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
            }
            content.addView(adminSearch)
            val listCount = txt("", 9f, TEXT2, top=2, bot=3)
            content.addView(listCount)
            val gameRowsContainer = ll()
            content.addView(gameRowsContainer)

            fun renderAdminGameRows() {
                gameRowsContainer.removeAllViews()
                val query = normalizeMarketSearch(catalogFilterQuery.trim())
                val filtered = gameCatalog.filter { game ->
                    normalizeMarketSearch(buildString {
                        append(game.name).append(' ').append(game.subtitle).append(' ')
                        append(game.description).append(' ').append(game.badge).append(' ')
                        game.offers.forEach { offer -> append(offer.title).append(' ').append(offer.category).append(' ').append(offer.description).append(' ') }
                    }).contains(query)
                }
                listCount.text = "${filtered.size} elemento(s) del catálogo oficial"
                if (filtered.isEmpty()) {
                    gameRowsContainer.addView(txt(if (query.isBlank()) "No hay elementos en esta vista." else "No encontramos coincidencias. Prueba con otro nombre.", 11f, MUTED, top=12, bot=8))
                    return
                }
                filtered.forEach { game ->
                    val card = ll().apply {
                        setPadding(dp(this@MainActivity, 11), dp(this@MainActivity, 11), dp(this@MainActivity, 11), dp(this@MainActivity, 11))
                        background = roundedBackground(SURFACE, 13, Color.parseColor("#2A3043"), 1)
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 7) }
                    }
                    val titleRow = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                    titleRow.addView(txt(game.name, 12f, TEXT, bold=true).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
                    titleRow.addView(txt(if (game.isActive) "PUBLICADO" else "OCULTO", 8f, if (game.isActive) GREEN else MUTED, bold=true))
                    card.addView(titleRow)
                    card.addView(txt("${game.subtitle} · ${game.offers.size} ofertas", 9f, TEXT2, top=3, bot=8))
                    val actions = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
                    actions.addView(btn("EDITAR").apply {
                        textSize = 8.5f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, RED, 1)
                        setOnClickListener { showGameEditor(game) { refreshRows(); onChanged() } }
                    }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginEnd = dp(this@MainActivity, 4) })
                    actions.addView(btn("OFERTAS").apply {
                        textSize = 8.5f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, PURPLE, 1)
                        setOnClickListener { showGameOffersAdmin(game.id) { refreshRows(); onChanged() } }
                    }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginStart = dp(this@MainActivity, 4); marginEnd = dp(this@MainActivity, 4) })
                    actions.addView(btn(if (game.isActive) "OCULTAR" else "PUBLICAR").apply {
                        textSize = 8f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, BLUE, 1)
                        setOnClickListener {
                            val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                            uiScope.launch {
                                val response = withContext(Dispatchers.IO) {
                                    runCatching { adminMarketRequest(token, "/games/${game.id}", "PATCH", JSONObject().put("is_active", !game.isActive)) }.getOrNull()
                                }
                                if (response != null && response.code in 200..299) {
                                    refreshRemoteGameCatalog { refreshRows(); onChanged() }
                                } else {
                                    android.util.Log.w("SO/GameMarket", "No se pudo cambiar la visibilidad del elemento; code=${response?.code}")
                                    showSoToast("No se pudo cambiar la publicación. Inténtalo de nuevo.", Toast.LENGTH_LONG)
                                }
                            }
                        }
                    }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginStart = dp(this@MainActivity, 4) })
                    card.addView(actions)
                    card.addView(btn("ELIMINAR").apply {
                        textSize=8f; isAllCaps=false; setTextColor(TEXT); background=roundedBackground(SURFACE2, 8, ERR, 1)
                        setOnClickListener {
                            ThemedAlertDialogBuilder(this@MainActivity).setTitle("¿Eliminar ${game.name}?")
                                .setMessage("Se eliminarán del catálogo las ofertas asociadas a este elemento.")
                                .setNegativeButton("Cancelar", null).setPositiveButton("Eliminar") { _, _ ->
                                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                                    uiScope.launch {
                                        val response = withContext(Dispatchers.IO) { runCatching { adminMarketRequest(token, "/games/${game.id}", "DELETE") }.getOrNull() }
                                        if (response != null && response.code in 200..299) refreshRemoteGameCatalog { refreshRows(); onChanged() }
                                        else {
                                            android.util.Log.w("SO/GameMarket", "No se pudo eliminar elemento; code=${response?.code}")
                                            showSoToast("No se pudo eliminar el elemento. Inténtalo de nuevo.", Toast.LENGTH_LONG)
                                        }
                                    }
                                }.show()
                        }
                    })
                    gameRowsContainer.addView(card)
                }
            }
            var pendingAdminSearchRender: Runnable? = null
            adminSearch.addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    catalogFilterQuery = s?.toString().orEmpty()
                    pendingAdminSearchRender?.let { adminSearch.removeCallbacks(it) }
                    val task = Runnable { renderAdminGameRows() }
                    pendingAdminSearchRender = task
                    adminSearch.postDelayed(task, 140L)
                }
                override fun afterTextChanged(s: android.text.Editable?) = Unit
            })
            renderAdminGameRows()
        }
        refreshRows()
        dialog.show()
        styleSoDialog(dialog, expanded = true)
    }

    private fun showGameEditor(existing: GameCatalogItem?, onSaved: () -> Unit) {
        if (!isCatalogAdmin()) return
        if (!isDeviceOnline()) { showSoToast("Conéctate para editar el catálogo central.", Toast.LENGTH_LONG); return }
        pendingGameEditorImageUri = existing?.imageUri
        val content = ll().apply { setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 4)) }
        val scroll = ScrollView(this).apply { addView(content) }
        val nameInput = inp("Nombre del juego", maxLen=100).apply { setText(existing?.name.orEmpty()) }
        val descriptionInput = inp("Descripción del juego", multiline=true, maxLen=1000).apply { setText(existing?.description.orEmpty()) }
        val categoryInput = inp("Categoría (MOBA, RPG, Battle Royale…)", maxLen=80).apply { setText(existing?.subtitle.orEmpty()) }
        val badgeInput = inp("Etiqueta (POPULAR, MOBA…)", maxLen=30).apply { setText(existing?.badge ?: "NUEVO") }
        val preview = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 125)).apply { bottomMargin = dp(this@MainActivity, 8) }
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = roundedBackground(SURFACE2, 13, RED, 1)
            clipToOutline = true
            setImageResource(android.R.drawable.ic_menu_gallery)
            existing?.imageUri?.let { runCatching { setImageURI(android.net.Uri.parse(it)) } }
            if (existing?.imageUri.isNullOrBlank()) loadGameThumbnail(existing?.imageUrl, this, View(this@MainActivity))
        }
        pendingGameEditorPreview = preview
        content.addView(txt(if (existing == null) "NUEVO JUEGO" else "EDITAR JUEGO", 9f, RED, bold=true, bot=6))
        content.addView(preview)
        content.addView(btn("SELECCIONAR MINIATURA DESDE GALERÍA").apply {
            textSize=9f; isAllCaps=false; setTextColor(TEXT); background=roundedBackground(SURFACE2, 10, PURPLE, 1)
            setOnClickListener { openImagePicker(REQUEST_GAME_IMAGE) }
        })
        content.addView(lbl("NOMBRE", top=12)); content.addView(nameInput)
        content.addView(lbl("DESCRIPCIÓN", top=3)); content.addView(descriptionInput)
        content.addView(lbl("CATEGORÍA", top=3)); content.addView(categoryInput)
        content.addView(lbl("ETIQUETA", top=3)); content.addView(badgeInput)
        content.addView(txt("La imagen se optimiza antes de guardarse de forma segura. Los cambios se aplican al catálogo al confirmar.", 9f, MUTED, top=3))
        val dialog = ThemedAlertDialogBuilder(this).setTitle(if (existing == null) "Añadir juego" else "Editar juego")
            .setView(scroll).setNegativeButton("Cancelar", null).setPositiveButton("Guardar cambios", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = nameInput.text.toString().trim()
                if (name.isBlank()) { nameInput.error = "Escribe un nombre"; return@setOnClickListener }
                val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                if (token.isBlank() || !isDeviceOnline()) { showSoToast("Se requiere una sesión admin y conexión.", Toast.LENGTH_LONG); return@setOnClickListener }
                val saveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                saveButton.isEnabled = false; saveButton.text = "GUARDANDO…"
                uiScope.launch {
                    var thumbnailPath = existing?.thumbnailPath
                    var failedImageUpload = false
                    val selectedUri = pendingGameEditorImageUri
                    if (!selectedUri.isNullOrBlank() && selectedUri.startsWith("content://")) {
                        val imageResult = withContext(Dispatchers.IO) { runCatching { uploadMarketImage(token, selectedUri) }.getOrNull() }
                        if (imageResult == null || imageResult.optString("path").isBlank()) failedImageUpload = true
                        else thumbnailPath = imageResult.optString("path")
                    }
                    if (failedImageUpload) {
                        saveButton.isEnabled = true; saveButton.text = "Guardar cambios"
                        showSoToast("No se pudo subir la miniatura; el juego no se ha guardado.", Toast.LENGTH_LONG)
                        return@launch
                    }
                    val payload = JSONObject().apply {
                        put("name", name)
                        put("description", descriptionInput.text.toString().trim())
                        put("category", categoryInput.text.toString().trim().ifBlank { "Juegos" })
                        put("badge", badgeInput.text.toString().trim().uppercase(Locale.ROOT).ifBlank { "JUEGO" })
                        put("thumbnail_path", thumbnailPath ?: JSONObject.NULL)
                        put("is_active", existing?.isActive ?: true)
                    }
                    val response = withContext(Dispatchers.IO) {
                        runCatching {
                            if (existing == null) adminMarketRequest(token, "/games", "POST", payload)
                            else adminMarketRequest(token, "/games/${existing.id}", "PATCH", payload)
                        }.getOrNull()
                    }
                    if (response != null && response.code in 200..299) {
                        dialog.dismiss(); pendingGameEditorPreview = null; pendingGameEditorImageUri = null
                        refreshRemoteGameCatalog { onSaved() }
                    } else {
                        saveButton.isEnabled = true; saveButton.text = "Guardar cambios"
                        val error = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrNull().orEmpty()
                        showSoToast("No se pudo guardar el juego. Comprueba los campos e inténtalo de nuevo.", Toast.LENGTH_LONG)
                    }
                }
            }
        }
        dialog.setOnDismissListener { pendingGameEditorPreview = null; pendingGameEditorImageUri = null }
        dialog.show()
        styleSoDialog(dialog)
    }

    private fun showGameOffersAdmin(gameId: String, onChanged: () -> Unit) {
        if (!isCatalogAdmin()) return
        if (!isDeviceOnline()) { showSoToast("Conéctate para gestionar las ofertas.", Toast.LENGTH_LONG); return }
        val content = ll().apply { setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 6)) }
        val scroll = ScrollView(this).apply { addView(content) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Ofertas del juego").setView(scroll).setNegativeButton("Cerrar", null).create()
        fun redraw() {
            content.removeAllViews()
            val game = gameCatalog.firstOrNull { it.id == gameId } ?: return
            content.addView(txt(game.name, 17f, TEXT, bold=true, bot=3))
            content.addView(txt("Los clientes normales y los reseller pueden tener precios diferentes. El coste USD solo se muestra aquí, en administración.", 10f, TEXT2, bot=10))
            content.addView(btn("＋  AÑADIR OFERTA").apply {
                textSize=10f; isAllCaps=false; setTextColor(contrastingTextColor(RED)); background=roundedBackground(RED, 10, RED, 0)
                setOnClickListener { showGameOfferEditor(game.id, null) { redraw(); onChanged() } }
            })
            if (game.offers.isEmpty()) content.addView(txt("Todavía no hay ofertas.", 11f, MUTED, top=14))
            game.offers.forEach { offer ->
                val card = ll().apply { setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 9), dp(this@MainActivity, 10), dp(this@MainActivity, 9)); background=roundedBackground(SURFACE, 12, Color.parseColor("#2A3043"), 1); layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin=dp(this@MainActivity, 8) } }
                card.addView(txt(offer.title, 12f, TEXT, bold=true, bot=3))
                card.addView(txt("Normal: ${formatCatalogPrice(offer.priceCup)} CUP · ${formatCatalogPrice(offer.priceSaldo)} Saldo", 10f, GREEN, bold=true, bot=2))
                card.addView(txt("Reseller: ${offer.resellerPriceCup?.let { formatCatalogPrice(it) } ?: "igual al normal"} CUP · ${offer.resellerPriceSaldo?.let { formatCatalogPrice(it) } ?: "igual al normal"} Saldo", 9f, PURPLE, bold=true, bot=3))
                if (offer.baseUsd != null) card.addView(txt("Coste mayorista interno: ${"%.4f".format(Locale.US, offer.baseUsd)} USD", 9f, MUTED, bot=4))
                val row = LinearLayout(this@MainActivity).apply { orientation=LinearLayout.HORIZONTAL }
                val editOfferButton = btn("EDITAR").apply {
                    textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, RED, 1)
                    setOnClickListener { showGameOfferEditor(gameId, offer) { redraw(); onChanged() } }
                }
                row.addView(editOfferButton, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginEnd = dp(this@MainActivity, 5) })
                val toggleOfferButton = btn(if (offer.active) "OCULTAR" else "PUBLICAR").apply {
                    textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, PURPLE, 1)
                    setOnClickListener {
                        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                        uiScope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { adminMarketRequest(token, "/offers/${offer.id}", "PATCH", JSONObject().put("published", !offer.published)) }.getOrNull() }
                            if (result != null && result.code in 200..299) refreshRemoteGameCatalog { redraw(); onChanged() }
                            else showSoToast("No se pudo cambiar la publicación de la oferta.", Toast.LENGTH_LONG)
                        }
                    }
                }
                row.addView(toggleOfferButton, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginStart = dp(this@MainActivity, 5); marginEnd = dp(this@MainActivity, 5) })
                row.addView(btn("BORRAR").apply { textSize=9f; isAllCaps=false; setTextColor(TEXT); background=roundedBackground(SURFACE2, 8, ERR, 1); setOnClickListener {
                    ThemedAlertDialogBuilder(this@MainActivity).setTitle("Eliminar oferta")
                        .setMessage("La oferta se eliminará del catálogo central.")
                        .setNegativeButton("Cancelar", null).setPositiveButton("Eliminar") { _, _ ->
                            val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                            uiScope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { adminMarketRequest(token, "/offers/${offer.id}", "DELETE") }.getOrNull() }
                                if (result != null && result.code in 200..299) refreshRemoteGameCatalog { redraw(); onChanged() }
                                else showSoToast("No se pudo eliminar la oferta.", Toast.LENGTH_LONG)
                            }
                        }.show()
                } }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginStart=dp(this@MainActivity, 5) })
                card.addView(row); content.addView(card)
            }
        }
        redraw(); dialog.show()
        styleSoDialog(dialog, expanded = true)
    }

    private fun updateGameOffers(gameId: String, transform: (List<GameOfferItem>) -> List<GameOfferItem>) {
        gameCatalog = gameCatalog.map { game -> if (game.id == gameId) game.copy(offers = transform(game.offers)) else game }
        saveGameCatalog()
    }

    private fun calculateOfferPrices(offer: GameOfferItem, rateCup: Int, rateSaldo: Int, marginPct: Double, rounding: Int): GameOfferItem {
        val usd = offer.baseUsd ?: return offer
        val factor = 1.0 + (marginPct.coerceAtLeast(0.0) / 100.0)
        val cupRaw = usd * rateCup * factor
        val step = rounding.coerceAtLeast(1).toDouble()
        val cup = kotlin.math.ceil(cupRaw / step).toLong() * step.toLong()
        val saldo = kotlin.math.ceil(usd * rateSaldo * factor).toLong()
        return offer.copy(priceCup = cup, priceSaldo = saldo)
    }

    private fun showGameOfferEditor(gameId: String, existing: GameOfferItem?, onSaved: () -> Unit) {
        if (!isCatalogAdmin()) return
        if (!isDeviceOnline()) { showSoToast("Conéctate para gestionar ofertas.", Toast.LENGTH_LONG); return }
        val content = ll().apply { setPadding(dp(this@MainActivity, 4), dp(this@MainActivity, 4), dp(this@MainActivity, 4), dp(this@MainActivity, 4)) }
        val scroll = ScrollView(this).apply { addView(content) }
        val title = inp("Nombre del paquete", maxLen=120).apply { setText(existing?.title.orEmpty()) }
        val description = inp("Descripción, cantidad o región", multiline=true, maxLen=1000).apply { setText(existing?.description.orEmpty()) }
        val category = inp("Categoría (diamantes, pase semanal…)", maxLen=80).apply { setText(existing?.category ?: "Paquete") }
        val baseUsd = inp("Coste mayorista USD (solo interno)", maxLen=14).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(existing?.baseUsd?.toString().orEmpty())
        }
        val priceCup = inp("Precio cliente normal · CUP", maxLen=12, numeric=true).apply { setText(existing?.priceCup?.takeIf { it > 0 }?.toString().orEmpty()) }
        val priceSaldo = inp("Precio cliente normal · Saldo Móvil", maxLen=12, numeric=true).apply { setText(existing?.priceSaldo?.takeIf { it > 0 }?.toString().orEmpty()) }
        val resellerCup = inp("Precio SO Reseller · CUP (vacío = normal)", maxLen=12, numeric=true).apply { setText(existing?.resellerPriceCup?.toString().orEmpty()) }
        val resellerSaldo = inp("Precio SO Reseller · Saldo Móvil", maxLen=12, numeric=true).apply { setText(existing?.resellerPriceSaldo?.toString().orEmpty()) }
        val autoSwitch = Switch(this).apply { text = "Calcular ambos precios automáticamente desde USD"; setTextColor(TEXT); isChecked = existing?.autoPricing ?: false }
        val publishedSwitch = Switch(this).apply { text = "Oferta publicada"; setTextColor(TEXT); isChecked = existing?.published ?: true }
        val availableSwitch = Switch(this).apply { text = "Oferta disponible"; setTextColor(TEXT); isChecked = existing?.available ?: true }
        val packageData = inp("Datos específicos del paquete en JSON (opcional)", multiline=true, maxLen=1500).apply {
            setText(existing?.packageData?.toString() ?: "{}")
        }
        content.addView(txt("OFERTA DEL CATÁLOGO CENTRAL", 9f, RED, bold=true, bot=8))
        content.addView(lbl("NOMBRE DEL PAQUETE")); content.addView(title)
        content.addView(lbl("DESCRIPCIÓN", top=3)); content.addView(description)
        content.addView(lbl("CATEGORÍA", top=3)); content.addView(category)
        content.addView(lbl("DATOS DEL PAQUETE", top=3)); content.addView(packageData)
        content.addView(lbl("PRECIOS Y REGLAS", top=5)); content.addView(autoSwitch)
        content.addView(baseUsd); content.addView(priceCup); content.addView(priceSaldo); content.addView(resellerCup); content.addView(resellerSaldo)
        content.addView(publishedSwitch); content.addView(availableSwitch)
        content.addView(txt("Los precios automáticos utilizan las tasas de cada grupo. Si no introduces el coste USD, debes establecer ambos precios manualmente. El coste no se muestra a los compradores.", 9f, MUTED, top=5))
        val dialog = ThemedAlertDialogBuilder(this).setTitle(if (existing == null) "Nueva oferta" else "Editar oferta")
             .setView(scroll).setNegativeButton("Cancelar", null).setPositiveButton("Guardar oferta", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val offerTitle = title.text.toString().trim()
                if (offerTitle.isBlank()) { title.error = "Escribe el nombre del paquete"; return@setOnClickListener }
                val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                if (token.isBlank()) { showSoToast("Se requiere una sesión de administrador.", Toast.LENGTH_LONG); return@setOnClickListener }
                val usdText = baseUsd.text.toString().trim()
                val usd = usdText.toDoubleOrNull()
                if (usdText.isNotBlank() && (usd == null || usd < 0)) { baseUsd.error = "Coste USD inválido"; return@setOnClickListener }
                if (autoSwitch.isChecked && usd == null) { baseUsd.error = "Necesario para cálculo automático"; return@setOnClickListener }
                val packageObject = try { JSONObject(packageData.text.toString().ifBlank { "{}" }) } catch (_: Exception) { packageData.error = "JSON no válido"; return@setOnClickListener }
                val cup = priceCup.text.toString().toDoubleOrNull() ?: 0.0
                val saldo = priceSaldo.text.toString().toDoubleOrNull() ?: 0.0
                val resCup = resellerCup.text.toString().toDoubleOrNull()
                val resSaldo = resellerSaldo.text.toString().toDoubleOrNull()
                if (cup < 0 || saldo < 0 || (resCup != null && resCup < 0) || (resSaldo != null && resSaldo < 0)) {
                    showSoToast("Los precios no pueden ser negativos.", Toast.LENGTH_LONG); return@setOnClickListener
                }
                val payload = JSONObject().apply {
                    put("title", offerTitle); put("description", description.text.toString().trim())
                    put("category", category.text.toString().trim().ifBlank { "Paquete" }); put("package_data", packageObject)
                    put("base_cost_usd", usd ?: JSONObject.NULL); put("auto_pricing", autoSwitch.isChecked)
                    put("price_cup", cup); put("price_saldo", saldo)
                    put("price_reseller_cup", resCup ?: cup); put("price_reseller_saldo", resSaldo ?: saldo)
                    put("published", publishedSwitch.isChecked); put("available", availableSwitch.isChecked)
                }
                val button = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                button.isEnabled = false; button.text = "GUARDANDO…"
                uiScope.launch {
                    val route = if (existing == null) "/games/$gameId/offers" else "/offers/${existing.id}"
                    val method = if (existing == null) "POST" else "PATCH"
                    val response = withContext(Dispatchers.IO) { runCatching { adminMarketRequest(token, route, method, payload) }.getOrNull() }
                    if (response != null && response.code in 200..299) {
                        dialog.dismiss()
                        refreshRemoteGameCatalog { onSaved() }
                    } else {
                        button.isEnabled = true; button.text = "Guardar oferta"
                        val error = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrNull().orEmpty()
                        showSoToast("No se pudo guardar la oferta. Revisa los precios y vuelve a intentarlo.", Toast.LENGTH_LONG)
                    }
                }
            }
        }
        dialog.show()
        styleSoDialog(dialog, expanded = true)
    }

    private fun refreshDashboardOverview(force: Boolean = false) {
        if (dashboardOverviewInFlight) return
        if (dashboardOverview?.isAttachedToWindow != true || dashboardHealth?.isAttachedToWindow != true) return
        dashboardOverviewInFlight = true
        uiScope.launch {
            try {
                val snapshot = withContext(Dispatchers.IO) {
                    val now = System.currentTimeMillis()
                    val start = Calendar.getInstance().apply {
                        timeInMillis = now; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
                    }.timeInMillis
                    val db = AppDatabase.getInstance(this@MainActivity)
                    val dayItems = db.smsDao().getRange(start, now + 1L)
                    val parsed = dayItems.map { it to SmsParser.parse(it.body, it.receivedAt) }
                        .filter { it.second.amount != null && it.second.direction in setOf("RECIBIDO", "ENVIADO") }
                    val received = parsed.filter { it.second.direction == "RECIBIDO" }
                    val sent = parsed.filter { it.second.direction == "ENVIADO" }
                    val inTotal = received.sumOf { it.second.amount ?: 0.0 }
                    val outTotal = sent.sumOf { it.second.amount ?: 0.0 }
                    val queued = db.smsDao().getPending().size
                    val failed = db.smsDao().getFailed().size
                    val p = getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
                    val syncStatus = p.getString(SyncService.KEY_LAST_SYNC_STATUS, "NEVER").orEmpty()
                    val syncAt = p.getLong(SyncService.KEY_LAST_SYNC_AT, 0L)
                    val syncError = p.getString(SyncService.KEY_LAST_SYNC_ERROR, null)
                    val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                    val network = connectivity.activeNetwork
                    val caps = if (network != null) connectivity.getNetworkCapabilities(network) else null
                    val online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                    val smsPermission = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                    DashboardSnapshot(inTotal, outTotal, received.size, sent.size, queued, failed, syncStatus, syncAt, syncError, online, smsPermission)
                }
                val signature = listOf(snapshot.inTotal, snapshot.outTotal, snapshot.inCount, snapshot.outCount, snapshot.queued, snapshot.failed, snapshot.syncStatus, snapshot.syncAt / 60_000L, snapshot.online, snapshot.smsPermission).joinToString("|")
                if (force || signature != dashboardRenderSignature) {
                    dashboardRenderSignature = signature
                    renderDashboardOverview(snapshot)
                }
            } catch (error: Exception) {
                android.util.Log.e("SynthesisOne_UI", "No se pudo actualizar el monitor", error)
            } finally {
                dashboardOverviewInFlight = false
            }
        }
    }

    private data class DashboardSnapshot(
        val inTotal: Double, val outTotal: Double, val inCount: Int, val outCount: Int,
        val queued: Int, val failed: Int, val syncStatus: String, val syncAt: Long,
        val syncError: String?, val online: Boolean, val smsPermission: Boolean
    )

    private fun renderDashboardOverview(s: DashboardSnapshot) {
        val overview = dashboardOverview ?: return
        overview.removeAllViews()
        val today = SimpleDateFormat("EEE, dd MMM", Locale("es", "ES")).format(Date())
        val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val titleBlock = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        titleBlock.addView(txt("RESUMEN FINANCIERO", 9f, Color.parseColor("#C1B1F7"), bold=true, ls=.12f, bot=4))
        titleBlock.addView(txt("Hoy · $today", 10f, TEXT2, bold=true))
        heading.addView(titleBlock)
        heading.addView(txt("CUP", 9f, TEXT, bold=true).apply {
            setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 6), dp(this@MainActivity, 10), dp(this@MainActivity, 6))
            background = roundedBackground(Color.parseColor("#292044"), 18, Color.parseColor("#4B3879"), 1)
        })
        overview.addView(heading)

        val net = s.inTotal - s.outTotal
        overview.addView(txt("NETO REGISTRADO", 9f, TEXT2, bold=true, ls=.07f, top=17, bot=1))
        overview.addView(txt((if (net >= 0) "+" else "−") + " %.2f".format(Locale.getDefault(), kotlin.math.abs(net)), 28f, TEXT, bold=true, bot=1))
        overview.addView(txt("CUP · ${s.inCount + s.outCount} operaciones contabilizadas", 10f, TEXT2, bot=12))

        val total = s.inTotal + s.outTotal
        val inWeight = if (total > 0.0) (s.inTotal / total).toFloat().coerceIn(0.02f, 0.98f) else 0.5f
        val outWeight = if (total > 0.0) (s.outTotal / total).toFloat().coerceIn(0.02f, 0.98f) else 0.5f
        val flowTrack = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 6)).apply { bottomMargin = dp(this@MainActivity, 14) }
            background = roundedBackground(SURFACE2, 8, Color.TRANSPARENT, 0)
            clipToOutline = true
        }
        if (total > 0.0) {
            flowTrack.addView(View(this).apply {
                background = roundedBackground(GREEN, 8, Color.TRANSPARENT, 0)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, inWeight)
            })
            flowTrack.addView(View(this).apply {
                background = roundedBackground(RED, 8, Color.TRANSPARENT, 0)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, outWeight)
            })
        } else {
            flowTrack.setBackgroundColor(SURFACE2)
        }
        overview.addView(flowTrack)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(summaryAmountCell("↓  ENTRADAS", "+ %.2f CUP".format(Locale.getDefault(), s.inTotal), "${s.inCount} movimientos", GREEN),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(space(9, horiz=true))
        row.addView(summaryAmountCell("↑  SALIDAS", "− %.2f CUP".format(Locale.getDefault(), s.outTotal), "${s.outCount} movimientos", RED),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        overview.addView(row)
    }

    private fun refreshDashboardRecent() {
        if (dashboardRecentInFlight || dashboardRecent?.isAttachedToWindow != true) return
        dashboardRecentInFlight = true
        uiScope.launch {
            try {
                val items = withContext(Dispatchers.IO) {
                    AppDatabase.getInstance(this@MainActivity).smsDao().getRecent(4)
                }
                val signature = items.joinToString("|") { "${it.id}:${it.status}:${it.attempts}:${it.lastError.orEmpty()}" } + "|hidden=" + prefs.getBoolean(PREF_HIDE_SENSITIVE, false)
                if (signature != dashboardRecentSignature) {
                    dashboardRecentSignature = signature
                    val container = dashboardRecent ?: return@launch
                    container.removeAllViews()
                    if (items.isEmpty()) {
                        container.addView(txt("Todavía no hay movimientos registrados.", 11f, MUTED, top=4, bot=5))
                    } else {
                        val fmt = SimpleDateFormat("dd/MM · HH:mm", Locale.getDefault())
                        items.forEachIndexed { index, sms ->
                            val parsed = SmsParser.parse(sms.body, sms.receivedAt)
                            container.addView(txRowCompact(sms, parsed, fmt))
                            if (index < items.lastIndex) container.addView(space(6))
                        }
                    }
                }
            } catch (error: Exception) {
                android.util.Log.e("SynthesisOne_UI", "No se pudo refrescar actividad reciente", error)
            } finally {
                dashboardRecentInFlight = false
            }
        }
    }

    private fun summaryAmountCell(title: String, amount: String, subtitle: String, accent: Int): View {
        val cell = ll().apply { setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 9), dp(this@MainActivity, 10), dp(this@MainActivity, 9)); background = roundedBackground(Color.argb(30, Color.red(accent), Color.green(accent), Color.blue(accent)), 13, Color.argb(60, Color.red(accent), Color.green(accent), Color.blue(accent)), 1) }
        cell.addView(txt(title, 8f, TEXT2, bold=true, ls=.05f, bot=4))
        cell.addView(txt(amount, 14f, accent, bold=true, bot=3))
        cell.addView(txt(subtitle, 9f, MUTED))
        return cell
    }

    private fun relativeTime(at: Long): String {
        val seconds = ((System.currentTimeMillis() - at).coerceAtLeast(0L) / 1000L)
        return when {
            seconds < 10 -> "hace unos segundos"
            seconds < 60 -> "hace ${seconds}s"
            seconds < 3600 -> "hace ${seconds / 60} min"
            seconds < 86400 -> "hace ${seconds / 3600} h"
            else -> SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(at))
        }
    }

    private fun visibleIdentifier(value: String?): String {
        val raw = value?.takeIf { it.isNotBlank() } ?: "—"
        if (!prefs.getBoolean(PREF_HIDE_SENSITIVE, false)) return raw
        val digits = raw.filter { it.isDigit() }
        // Preserve labels such as PAGOMOVIL; only mask identifiers that look like numbers.
        if (digits.length < 5) return raw
        return "••••" + digits.takeLast(4)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CONFIGURACIÓN
    // ══════════════════════════════════════════════════════════════════════════
    private fun rewardsInstalledAtIso(): String {
        val firstInstall = prefs.getLong(PREF_REWARDS_FIRST_INSTALL_MS, System.currentTimeMillis())
        return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(firstInstall))
    }

    private fun parseRewardsDate(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        val formats = listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")
        for (format in formats) {
            val parsed = runCatching {
                SimpleDateFormat(format, Locale.US).apply { isLenient = false; timeZone = TimeZone.getTimeZone("UTC") }.parse(value)?.time
            }.getOrNull()
            if (parsed != null) return parsed
        }
        return null
    }

    private fun rewardsCache(): JSONObject? = runCatching {
        JSONObject(prefs.getString(PREF_REWARDS_DASHBOARD_CACHE, "").orEmpty())
    }.getOrNull()

    private fun bootstrapRewardsIfOnline() {
        if (!isDeviceOnline()) {
            updateWelcomeCountdownCard()
            return
        }
        uiScope.launch {
            val capabilities = withContext(Dispatchers.IO) {
                val rewardsEnabled = runCatching {
                    val response = backendRequest("/api/rewards/status", token = storeAccessToken())
                    response.code in 200..299 && JSONObject(response.body).optBoolean("enabled", false)
                }.getOrDefault(false)
                val cartEnabled = runCatching {
                    val response = backendRequest("/api/store/cart/status", token = storeAccessToken())
                    response.code in 200..299 && JSONObject(response.body).optBoolean("enabled", false)
                }.getOrDefault(false)
                rewardsEnabled to cartEnabled
            }
            val enabled = capabilities.first
            val cartEnabled = capabilities.second
            val wasEnabled = prefs.getBoolean(PREF_REWARDS_FEATURE_AVAILABLE, false)
            val wasCartEnabled = prefs.getBoolean(PREF_CART_FEATURE_AVAILABLE, false)
            if (wasEnabled != enabled || wasCartEnabled != cartEnabled) {
                prefs.edit().putBoolean(PREF_REWARDS_FEATURE_AVAILABLE, enabled).putBoolean(PREF_CART_FEATURE_AVAILABLE, cartEnabled).apply()
                // Server flags are opt-in. Rebuild once so unavailable features never appear as placeholders.
                if (::rootFrame.isInitialized) showDashboard()
                return@launch
            }
            if (!enabled) {
                updateWelcomeCountdownCard()
                return@launch
            }
            val token = storeAccessToken()
            if (token.isBlank()) {
                updateWelcomeCountdownCard()
                return@launch
            }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val bootstrap = backendRequest("/api/rewards/bootstrap", "POST", token,
                        JSONObject().put("installed_at", rewardsInstalledAtIso()))
                    if (bootstrap.code !in 200..299) return@runCatching null
                    val bootJson = JSONObject(bootstrap.body)
                    val started = bootJson.optString("welcome_started_at", "")
                    if (started.isNotBlank()) prefs.edit().putString(PREF_REWARDS_WELCOME_STARTED_AT, started).apply()
                    val dashboard = backendRequest("/api/rewards/dashboard", "GET", token)
                    if (dashboard.code !in 200..299) return@runCatching null
                    JSONObject(dashboard.body)
                }.getOrNull()
            }
            if (result != null) {
                prefs.edit().putString(PREF_REWARDS_DASHBOARD_CACHE, result.toString()).apply()
                result.optJSONObject("welcome")?.optString("started_at", "")?.takeIf { it.isNotBlank() }?.let {
                    prefs.edit().putString(PREF_REWARDS_WELCOME_STARTED_AT, it).apply()
                }
            }
            withContext(Dispatchers.Main) { updateWelcomeCountdownCard() }
        }
    }

    private fun buildWelcomeCountdownCard(): LinearLayout {
        val card = ll().apply {
            setPadding(dp(this@MainActivity, 15), dp(this@MainActivity, 14), dp(this@MainActivity, 15), dp(this@MainActivity, 13))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(blendSurfaceColor(SURFACE2, RED, 0.24f), SURFACE)).apply {
                cornerRadius = dp(this@MainActivity, 17).toFloat()
                setStroke(dp(this@MainActivity, 1), blendSurfaceColor(RED, PURPLE, 0.28f))
            }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(this@MainActivity, 3); bottomMargin = dp(this@MainActivity, 13)
            }
            setOnClickListener { showRewardsPanel() }
        }
        card.addView(txt("OFERTA DE BIENVENIDA", 10f, RED, bold = true, ls = .10f, bot = 5))
        card.addView(txt("Tu primera compra en CUP puede tener hasta un 10% de descuento.", 12f, TEXT, bold = true, bot = 6))
        val timer = txt("Calculando tiempo…", 19f, GREEN, bold = true, bot = 3)
        welcomePromoCountdownView = timer
        card.addView(timer)
        card.addView(txt("Disponible durante las primeras 24 horas desde la instalación. Consulta las condiciones en Recompensas.", 9f, TEXT2))
        welcomePromoCard = card
        updateWelcomeCountdownCard()
        return card
    }

    private fun updateWelcomeCountdownCard() {
        welcomeCountdownRunnable?.let { handler.removeCallbacks(it) }
        welcomeCountdownRunnable = null
        val card = welcomePromoCard ?: return
        if (!prefs.getBoolean(PREF_REWARDS_FEATURE_AVAILABLE, false)) {
            card.visibility = View.GONE
            return
        }
        val cache = rewardsCache()
        val welcome = cache?.optJSONObject("welcome")
        val serverSaysAvailable = welcome?.optBoolean("available", true) ?: true
        val serverStart = welcome?.optString("started_at", "")?.takeIf { it.isNotBlank() }
            ?: prefs.getString(PREF_REWARDS_WELCOME_STARTED_AT, "").orEmpty()
        val localInstall = prefs.getLong(PREF_REWARDS_FIRST_INSTALL_MS, System.currentTimeMillis())
        val started = parseRewardsDate(serverStart) ?: localInstall
        val end = parseRewardsDate(welcome?.optString("ends_at", "")) ?: (started + 24L * 60L * 60L * 1000L)
        val remaining = end - System.currentTimeMillis()
        if (!serverSaysAvailable || remaining <= 0L) {
            card.visibility = View.GONE
            return
        }
        card.visibility = View.VISIBLE
        val tick = object : Runnable {
            override fun run() {
                val ms = end - System.currentTimeMillis()
                if (!serverSaysAvailable || ms <= 0L) {
                    card.visibility = View.GONE
                    welcomeCountdownRunnable = null
                    return
                }
                val seconds = ms / 1000L
                val hours = seconds / 3600L
                val minutes = (seconds % 3600L) / 60L
                val rest = seconds % 60L
                welcomePromoCountdownView?.text = String.format(Locale.US, "%02d:%02d:%02d restantes", hours, minutes, rest)
                handler.postDelayed(this, 1000L)
            }
        }
        welcomeCountdownRunnable = tick
        tick.run()
    }

    private fun showRewardsPanel() {
        val cached = rewardsCache()
        if (!isDeviceOnline()) {
            if (cached != null) renderRewardsPanel(cached, true)
            else showSoToast("Conéctate a Internet para cargar las recompensas por primera vez.", Toast.LENGTH_LONG)
            return
        }
        val token = storeAccessToken()
        if (token.isBlank()) {
            if (cached != null) renderRewardsPanel(cached, true)
            else showSoToast("Activa una sesión para consultar tus recompensas.", Toast.LENGTH_LONG)
            return
        }
        uiScope.launch {
            val dashboard = withContext(Dispatchers.IO) {
                runCatching {
                    val bootstrap = backendRequest("/api/rewards/bootstrap", "POST", token,
                        JSONObject().put("installed_at", rewardsInstalledAtIso()))
                    if (bootstrap.code !in 200..299) throw IllegalStateException(JSONObject(bootstrap.body).optString("error", "No se pudo iniciar el programa de recompensas."))
                    val started = JSONObject(bootstrap.body).optString("welcome_started_at", "")
                    if (started.isNotBlank()) prefs.edit().putString(PREF_REWARDS_WELCOME_STARTED_AT, started).apply()
                    val response = backendRequest("/api/rewards/dashboard", "GET", token)
                    if (response.code !in 200..299) throw IllegalStateException(JSONObject(response.body).optString("error", "No se pudieron cargar las recompensas."))
                    JSONObject(response.body)
                }
            }
            withContext(Dispatchers.Main) {
                dashboard.onSuccess { data ->
                    prefs.edit().putString(PREF_REWARDS_DASHBOARD_CACHE, data.toString()).apply()
                    data.optJSONObject("welcome")?.optString("started_at", "")?.takeIf { it.isNotBlank() }?.let {
                        prefs.edit().putString(PREF_REWARDS_WELCOME_STARTED_AT, it).apply()
                    }
                    updateWelcomeCountdownCard()
                    renderRewardsPanel(data, false)
                }.onFailure { error ->
                    val message = error.message.orEmpty()
                    if (message.contains("programa de recompensas", ignoreCase = true) && message.contains("disponible", ignoreCase = true)) {
                        prefs.edit().putBoolean(PREF_REWARDS_FEATURE_AVAILABLE, false).apply()
                        showRewardsUnavailableNotice()
                    } else if (cached != null) renderRewardsPanel(cached, true)
                    else showSoToast(message.ifBlank { "No se pudieron cargar las recompensas." }, Toast.LENGTH_LONG)
                }
            }
        }
    }

    private fun renderRewardsPanel(data: JSONObject, offline: Boolean) {
        if (rewardsDialogShowing) return
        val scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false }
        val panel = ll().apply { setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 16)) }
        if (offline) panel.addView(txt("● DATOS GUARDADOS · se actualizarán al recuperar conexión", 9f, Color.parseColor("#FFC56E"), bold = true, bot = 10))
        panel.addView(txt("INVITA, COMPLETA MISIONES Y CONSIGUE DESCUENTOS", 10f, RED, bold = true, ls = .07f, bot = 6))
        buildRewardsAssistantAdvice(data)?.let { panel.addView(it) }
        val profile = data.optJSONObject("profile") ?: JSONObject()
        val referralCode = profile.optString("referral_code", "")
        val referralCard = ll().apply {
            setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 12), dp(this@MainActivity, 13), dp(this@MainActivity, 12))
            background = roundedBackground(SURFACE2, 13, blendSurfaceColor(RED, PURPLE, .25f), 1)
        }
        referralCard.addView(txt("TU CÓDIGO DE REFERIDO", 9f, TEXT2, bold = true, bot = 5))
        referralCard.addView(txt(referralCode.ifBlank { "Se creará al sincronizar" }, 21f, TEXT, bold = true, bot = 4))
        referralCard.addView(txt("Registrados con tu código: ${profile.optInt("referrals_registered_count", profile.optInt("referrals_count", 0))}", 10f, TEXT2, bot = 3))
        referralCard.addView(txt("Referidos válidos (primera compra pagada y verificada): ${profile.optInt("referrals_count", 0)}", 10f, TEXT2, bot = 9))
        val actionRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        actionRow.addView(btn("COPIAR").apply {
            isAllCaps = false; textSize = 9f; setTextColor(TEXT); background = roundedBackground(SURFACE, 9, RED, 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f).apply { marginEnd = dp(this@MainActivity, 7) }
            setOnClickListener {
                if (referralCode.isNotBlank()) {
                    (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Código de referido", referralCode))
                    showSoToast("Código copiado.")
                }
            }
        })
        actionRow.addView(btn("COMPARTIR APP").apply {
            isAllCaps = false; textSize = 9f; setTextColor(TEXT); background = roundedBackground(SURFACE, 9, PURPLE, 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f)
            setOnClickListener {
                val share = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, "SynthesisOne"); putExtra(Intent.EXTRA_TEXT, "Prueba SynthesisOne. Usa mi código de referido $referralCode al registrarte: https://play.google.com/store/apps/details?id=$packageName") }
                startActivity(Intent.createChooser(share, "Compartir SynthesisOne"))
            }
        })
        referralCard.addView(actionRow)
        val linked = profile.optJSONObject("referred_by")?.optBoolean("linked", false) ?: false
        if (!linked) {
            referralCard.addView(space(8))
            referralCard.addView(txt("¿Tienes un código de invitación? Puedes vincular uno solo y no cambiarlo después.", 9f, TEXT2, bot = 5))
            val codeInput = inp("Código de referido", maxLen = 32).apply { filters = arrayOf(InputFilter.LengthFilter(32), InputFilter.AllCaps()) }
            referralCard.addView(codeInput)
            referralCard.addView(btn("VINCULAR CÓDIGO").apply {
                isAllCaps = false; textSize = 9f; setTextColor(TEXT); background = roundedBackground(SURFACE, 9, RED, 1)
                setOnClickListener {
                    val code = codeInput.text.toString().trim().uppercase(Locale.ROOT)
                    if (code.isBlank()) { codeInput.error = "Introduce el código"; return@setOnClickListener }
                    if (!isDeviceOnline()) { showSoToast("Necesitas conexión para vincular el código."); return@setOnClickListener }
                    val token = storeAccessToken()
                    uiScope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/rewards/referral", "POST", token, JSONObject().put("code", code)) } }
                        withContext(Dispatchers.Main) {
                            result.onSuccess { response ->
                                val body = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
                                if (response.code in 200..299) { showSoToast("Código de referido vinculado."); rewardsDialog?.dismiss(); showRewardsPanel() }
                                else showSoToast(body.optString("error", "No se pudo vincular el código."), Toast.LENGTH_LONG)
                            }.onFailure { showSoToast("No se pudo contactar con el servicio de recompensas.", Toast.LENGTH_LONG) }
                        }
                    }
                }
            })
        } else {
            referralCard.addView(txt("Código vinculado: ${profile.optJSONObject("referred_by")?.optString("code", "")}", 10f, GREEN, top = 7))
        }
        panel.addView(referralCard)
        renderRewardsMissionsAndCoupons(panel, data, profile, referralCode, scroll)
        scroll.addView(panel)
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Recompensas y referidos").setView(scroll).setPositiveButton("Cerrar", null).create()
        rewardsDialog = dialog
        rewardsDialogShowing = true
        dialog.setOnDismissListener {
            rewardsDialogShowing = false
            if (rewardsDialog === dialog) rewardsDialog = null
        }
        dialog.setOnShowListener { styleSoDialog(dialog, expanded = true) }
        dialog.show()
    }

    private fun renderRewardsMissionsAndCoupons(
        panel: LinearLayout,
        data: JSONObject,
        profile: JSONObject,
        referralCode: String,
        parentScroll: ScrollView
    ) {
        panel.addView(txt("TUS MISIONES", 10f, RED, bold = true, ls = .10f, top = 16, bot = 8))
        val missions = data.optJSONArray("missions") ?: JSONArray()
        for (i in 0 until missions.length()) {
            val mission = missions.optJSONObject(i) ?: continue
            val id = mission.optString("id", "")
            val status = rewardMissionStatus(mission, data)
            val completedForDisplay = if (id == "welcome") {
                data.optJSONObject("welcome")?.optString("status", "") == "USED"
            } else mission.optBoolean("completed", false)
            val card = ll().apply {
                setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 12), dp(this@MainActivity, 13), dp(this@MainActivity, 12))
                background = roundedBackground(SURFACE, 13,
                    if (completedForDisplay) blendSurfaceColor(GREEN, SURFACE, .45f) else blendSurfaceColor(PURPLE, SURFACE, .22f), 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(this@MainActivity, 9)
                }
                isClickable = true
                isFocusable = true
            }
            card.addView(txt((if (completedForDisplay) "✓  " else "◈  ") + rewardsMissionTitle(mission), 13f,
                if (completedForDisplay) GREEN else TEXT, bold = true, bot = 5))
            card.addView(txt(rewardsMissionSummary(mission), 11f, TEXT2, bot = 7))
            val progressText = rewardsMissionProgressText(mission, profile, data)
            if (progressText.isNotBlank()) card.addView(txt(progressText, 10f, if (completedForDisplay) GREEN else TEXT2, bold = true, bot = 5))
            if (id == "weekly") card.addView(buildRewardsWeekCalendar(mission, data))
            card.addView(txt("Recompensa: ${mission.optString("reward", "Se mostrará cuando esté configurada")}", 10f, PURPLE, bold = true, top = 2, bot = 5))
            card.addView(txt("Estado: $status", 9f, rewardStatusColor(status), bot = 5))
            rewardsMissionDeadlineText(mission, data)?.let { card.addView(txt(it, 9f, TEXT2, bot = 7)) }
            card.addView(btn("Ver condiciones completas").apply {
                isAllCaps = false
                textSize = 10f
                setTextColor(TEXT)
                background = roundedBackground(SURFACE2, 9, PURPLE, 1)
                setOnClickListener {
                    showRewardsMissionDetails(mission, data, referralCode) {
                        parentScroll.post { parentScroll.smoothScrollTo(0, couponSectionY(panel)) }
                    }
                }
            })
            card.setOnClickListener {
                showRewardsMissionDetails(mission, data, referralCode) {
                    parentScroll.post { parentScroll.smoothScrollTo(0, couponSectionY(panel)) }
                }
            }
            panel.addView(card)
        }

        val couponsTitle = txt("TUS CUPONES", 10f, RED, bold = true, ls = .10f, top = 17, bot = 5)
        panel.addView(couponsTitle)
        panel.addView(txt("Consulta por separado los cupones disponibles, usados, vencidos, revocados y los reservados para una compra pendiente.", 10f, TEXT2, bot = 9))
        val coupons = data.optJSONArray("coupons") ?: JSONArray()
        val sections = listOf(
            "AVAILABLE" to "DISPONIBLES",
            "RESERVED" to "RESERVADOS · COMPRA PENDIENTE",
            "USED" to "UTILIZADOS",
            "EXPIRED" to "VENCIDOS",
            "REVOKED" to "REVOCADOS"
        )
        for ((stateKey, label) in sections) {
            panel.addView(txt(label, 9f, TEXT, bold = true, ls = .07f, top = 8, bot = 5))
            val group = (0 until coupons.length()).mapNotNull { coupons.optJSONObject(it) }
                .filter { rewardCouponDisplayState(it) == stateKey }
                .sortedByDescending { parseRewardsDate(it.optString("issued_at", "")) ?: 0L }
            if (group.isEmpty()) {
                panel.addView(txt(when (stateKey) {
                    "AVAILABLE" -> "No tienes cupones disponibles ahora mismo."
                    "RESERVED" -> "No tienes cupones reservados para un pedido."
                    "USED" -> "Todavía no hay cupones utilizados en tu historial."
                    "EXPIRED" -> "No hay cupones vencidos en tu historial."
                    else -> "No hay cupones revocados en tu historial."
                }, 10f, TEXT2, bot = 5))
                continue
            }
            for (coupon in group) {
                val state = rewardCouponDisplayState(coupon)
                val code = coupon.optString("coupon_code", "")
                val percent = coupon.optDouble("discount_percent", 0.0)
                val minimum = coupon.optDouble("minimum_subtotal_cup", 0.0).toLong()
                val exclusive = coupon.optBoolean("minimum_exclusive", false)
                val card = ll().apply {
                    setPadding(dp(this@MainActivity, 11), dp(this@MainActivity, 10), dp(this@MainActivity, 11), dp(this@MainActivity, 10))
                    background = roundedBackground(SURFACE2, 11, blendSurfaceColor(PURPLE, SURFACE, .26f), 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(this@MainActivity, 7)
                    }
                }
                card.addView(txt("${formatRewardPercent(percent)} DE DESCUENTO", 12f, TEXT, bold = true, bot = 2))
                card.addView(txt(code, 11f, PURPLE, bold = true, bot = 3))
                val minimumText = if (minimum > 0) {
                    "${if (exclusive) "Subtotal superior a" else "Subtotal desde"} ${formatCatalogPrice(minimum)} CUP"
                } else "Sin importe mínimo configurado"
                card.addView(txt(minimumText, 9f, TEXT2, bot = 3))
                card.addView(txt("Origen: ${couponOriginLabel(coupon)}", 9f, TEXT2, bot = 3))
                card.addView(txt("Estado: ${rewardCouponStateLabel(coupon)}", 9f, rewardStatusColor(rewardCouponStateLabel(coupon)), bot = 7))
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                row.addView(btn("Ver detalles").apply {
                    isAllCaps = false; textSize = 9f; setTextColor(TEXT)
                    background = roundedBackground(SURFACE, 8, PURPLE, 1)
                    layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 39), 1f).apply { marginEnd = dp(this@MainActivity, 6) }
                    setOnClickListener { showRewardCouponDetails(coupon) }
                })
                row.addView(btn("Copiar código").apply {
                    isAllCaps = false; textSize = 9f; setTextColor(TEXT)
                    isEnabled = state == "AVAILABLE" && code.isNotBlank()
                    alpha = if (isEnabled) 1f else .5f
                    background = roundedBackground(SURFACE, 8, RED, 1)
                    layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 39), 1f)
                    setOnClickListener {
                        if (state == "AVAILABLE" && code.isNotBlank()) {
                            (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                                .setPrimaryClip(android.content.ClipData.newPlainText("Cupón SynthesisOne", code))
                            showSoToast("Código copiado.")
                        }
                    }
                })
                card.addView(row)
                panel.addView(card)
            }
        }
    }

    private fun couponSectionY(panel: LinearLayout): Int {
        for (i in 0 until panel.childCount) {
            val child = panel.getChildAt(i)
            if (child is TextView && child.text.toString() == "TUS CUPONES") return child.top
        }
        return panel.height
    }

    private fun rewardsMissionTitle(mission: JSONObject): String = when (mission.optString("id", "")) {
        "welcome" -> "¡Tu primera compra tiene descuento!"
        "recruit" -> "¡Invita a tus primeros clientes!"
        "referrals_10", "referrals_20", "referrals_30" -> "¡Invita, crece y consigue descuentos! · ${mission.optInt("target", 0)} referidos"
        "monthly" -> "¡Conviértete en un cliente frecuente!"
        "weekly" -> "¡Mantén tu racha de compras!"
        "explorer" -> "¡Descubre todo lo que puedes hacer!"
        "collector" -> "¡Llena tu carrito y consigue una recompensa!"
        "return" -> "¡Te echábamos de menos!"
        "streak" -> "¡Demuestra tu constancia!"
        else -> mission.optString("title", "Misión especial por tiempo limitado")
    }

    private fun rewardsMissionSummary(mission: JSONObject): String = when (mission.optString("id", "")) {
        "welcome" -> "Realiza tu primera compra elegible en CUP durante las primeras 24 horas y recibe un descuento del 3 %, 7 % o 10 % según el subtotal."
        "recruit" -> "Consigue 3 referidos válidos: cada persona debe registrarse con tu código y completar su primera compra pagada y verificada desde otro dispositivo."
        "referrals_10" -> "Desbloquea el cupón del 5 % al alcanzar 10 referidos válidos."
        "referrals_20" -> "Desbloquea el cupón del 10 % al alcanzar 20 referidos válidos; exige superar 8 000 CUP en el carrito."
        "referrals_30" -> "Desbloquea el cupón del 15 % al alcanzar 30 referidos válidos; exige superar 25 000 CUP en el carrito."
        "monthly" -> "Completa 3 compras distintas superiores a 15 000 CUP cada una dentro del mes calendario."
        "weekly" -> "Completa compras superiores a 1 000 CUP en 5 días distintos de la semana."
        "explorer" -> "Completa una compra pagada y verificada en Game Market y otra en ETECSA dentro de la ventana de 30 días."
        "collector" -> "Paga un pedido que reúna al menos 3 ofertas diferentes en el mismo carrito."
        "return" -> "Después de 30 días sin compras pagadas, vuelve con una compra superior a 3 000 CUP."
        "streak" -> "Completa la racha semanal durante dos semanas calendario consecutivas para obtener la recompensa adicional."
        else -> mission.optString("description", "Consulta las condiciones de esta misión.")
    }

    private fun rewardsMissionProgressText(mission: JSONObject, profile: JSONObject, data: JSONObject): String {
        val id = mission.optString("id", "")
        val progress = mission.optInt("progress", 0).coerceAtLeast(0)
        val target = mission.optInt("target", 1).coerceAtLeast(1)
        return when (id) {
            "welcome" -> when (welcomeRewardStatus(data)) {
                "USED" -> "Promoción de bienvenida utilizada"
                "PENDING_CONFIRMATION" -> "Compra pendiente de confirmación"
                "EXPIRED" -> "Promoción de bienvenida vencida o ya no elegible"
                else -> "Primera compra elegible: pendiente"
            }
            "recruit", "referrals_10", "referrals_20", "referrals_30" -> "Referidos válidos: ${profile.optInt("referrals_count", 0)}/$target"
            "monthly" -> "Compras completadas: $progress/$target"
            "weekly" -> "Días completados: $progress/$target"
            "explorer" -> "Game Market: ${if (mission.optBoolean("game_market_completed")) "completado" else "pendiente"} · ETECSA: ${if (mission.optBoolean("etecsa_completed")) "completado" else "pendiente"}"
            "collector" -> "Pedidos elegibles: $progress/$target"
            "return" -> if (mission.optBoolean("completed")) "Recompensa conseguida: 1/1" else "Compra de regreso elegible: pendiente"
            "streak" -> "Semanas consecutivas completadas: $progress/$target"
            else -> if (mission.has("progress") && mission.has("target")) "Progreso: $progress/$target" else ""
        }
    }

    private fun rewardMissionStatus(mission: JSONObject, data: JSONObject): String {
        val id = mission.optString("id", "")
        if (id == "welcome") return when (welcomeRewardStatus(data)) {
            "USED" -> "Utilizada"
            "PENDING_CONFIRMATION" -> "Compra pendiente de confirmación"
            "EXPIRED" -> "Vencida o ya no elegible"
            else -> "Disponible"
        }
        val related = relatedCouponsForMission(mission, data)
        if (related.isNotEmpty()) {
            val best = related.firstOrNull { rewardCouponDisplayState(it) == "AVAILABLE" }
                ?: related.firstOrNull { rewardCouponDisplayState(it) == "RESERVED" }
                ?: related.first()
            return when (rewardCouponDisplayState(best)) {
                "AVAILABLE" -> "Recompensa obtenida · cupón disponible"
                "RESERVED" -> "Compra pendiente de confirmación"
                "USED" -> "Recompensa obtenida · cupón utilizado"
                "EXPIRED" -> "Recompensa vencida"
                "REVOKED" -> "Recompensa revocada"
                else -> "Recompensa registrada"
            }
        }
        if (mission.optBoolean("completed", false)) return "Completada · recompensa pendiente de confirmación"
        if (id == "return") {
            val returnInfo = data.optJSONObject("return_mission") ?: JSONObject()
            val eligibleAt = parseRewardsDate(returnInfo.optString("eligible_at", ""))
            return when {
                eligibleAt == null -> "Aún no disponible · necesita una compra previa y 30 días sin compras"
                eligibleAt > System.currentTimeMillis() -> "Aún no disponible · faltan 30 días sin compras"
                else -> "Disponible"
            }
        }
        return if (mission.optInt("progress", 0) > 0) "En progreso" else "Disponible"
    }

    private fun rewardStatusColor(status: String): Int = when {
        status.contains("obtenida", true) || status.contains("utilizad", true) || status == "Completada" -> GREEN
        status.contains("pendiente", true) || status.contains("progreso", true) -> PURPLE
        status.contains("vencid", true) || status.contains("revocad", true) || status.contains("no disponible", true) -> RED
        else -> TEXT2
    }

    private fun rewardsMissionDeadlineText(mission: JSONObject, data: JSONObject): String? {
        val id = mission.optString("id", "")
        val end = when (id) {
            "welcome" -> data.optJSONObject("welcome")?.optString("ends_at", "")
            "monthly", "weekly", "streak" -> mission.optString("period_end", "")
            "explorer" -> mission.optString("expires_at", "")
            "return" -> data.optJSONObject("return_mission")?.optString("eligible_at", "")
            else -> mission.optString("ends_at", "")
        }.orEmpty()
        if (end.isBlank() || end.equals("null", true)) {
            if (id == "return" && !mission.optBoolean("completed")) return "Plazo: empieza después de una compra pagada y verificada."
            if (id == "explorer" && !mission.optBoolean("completed")) return "Ventana: 30 días desde una compra verificada en uno de los servicios."
            return null
        }
        val at = parseRewardsDate(end) ?: return null
        val remaining = at - System.currentTimeMillis()
        return when {
            id == "return" && remaining <= 0L -> "Ya transcurrieron los 30 días de inactividad requeridos."
            id == "return" -> "Podrás volver a participar desde ${formatRewardsDate(end)}."
            remaining <= 0L -> "El plazo de este período terminó."
            else -> "Tiempo restante: ${formatRewardsDuration(remaining)}"
        }
    }

    private fun buildRewardsWeekCalendar(mission: JSONObject, data: JSONObject): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(this@MainActivity, 2), 0, dp(this@MainActivity, 7))
        }
        val currentDays = mutableSetOf<String>()
        val keys = data.optJSONObject("progress")?.optJSONArray("weekly_day_keys") ?: JSONArray()
        for (i in 0 until keys.length()) currentDays.add(keys.optString(i))
        val startMs = parseRewardsDate(mission.optString("period_start", ""))
        val cuba = TimeZone.getTimeZone("America/Havana")
        val dayLabels = listOf("L", "M", "X", "J", "V", "S", "D")
        for (i in 0..6) {
            val date = startMs?.let { start -> Calendar.getInstance(cuba, Locale.ROOT).apply { timeInMillis = start; add(Calendar.DAY_OF_YEAR, i) } }
            val key = date?.let { SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = cuba }.format(Date(it.timeInMillis)) }.orEmpty()
            val number = date?.get(Calendar.DAY_OF_MONTH)?.toString() ?: "·"
            val done = key.isNotBlank() && currentDays.contains(key)
            val chip = ll().apply {
                gravity = Gravity.CENTER
                setPadding(dp(this@MainActivity, 3), dp(this@MainActivity, 5), dp(this@MainActivity, 3), dp(this@MainActivity, 5))
                background = roundedBackground(if (done) blendSurfaceColor(GREEN, SURFACE, .18f) else SURFACE2, 8,
                    if (done) GREEN else Color.parseColor("#3A4257"), 1)
                layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 48), 1f).apply {
                    marginEnd = if (i == 6) 0 else dp(this@MainActivity, 4)
                }
            }
            chip.addView(txt(dayLabels[i], 8f, if (done) GREEN else TEXT2, bold = true, bot = 2))
            chip.addView(txt(number, 11f, if (done) GREEN else TEXT, bold = true))
            row.addView(chip)
        }
        return row
    }

    private fun showRewardsMissionDetails(mission: JSONObject, data: JSONObject, referralCode: String, onViewCoupons: () -> Unit) {
        val id = mission.optString("id", "")
        val content = ll().apply { setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 18)) }
        val scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false; addView(content) }
        val status = rewardMissionStatus(mission, data)
        content.addView(txt("ESTADO · $status", 10f, rewardStatusColor(status), bold = true, bot = 8))
        val deadlineIso = when (id) {
            "welcome" -> data.optJSONObject("welcome")?.optString("ends_at", "")
            "monthly", "weekly", "streak" -> mission.optString("period_end", "")
            "explorer" -> mission.optString("expires_at", "")
            "return" -> data.optJSONObject("return_mission")?.optString("eligible_at", "")
            else -> mission.optString("ends_at", "")
        }.orEmpty()
        var countdownRunnable: Runnable? = null
        var detailDialog: AlertDialog? = null
        if (deadlineIso.isNotBlank() && parseRewardsDate(deadlineIso) != null && (id == "welcome" || id == "monthly" || id == "weekly" || mission.optString("type") == "flash" || id == "explorer")) {
            val timerLabel = txt("Calculando tiempo restante…", 15f, GREEN, bold = true, bot = 8)
            content.addView(timerLabel)
            val deadlineMs = parseRewardsDate(deadlineIso)
            if (deadlineMs != null) {
                val tick = object : Runnable {
                    override fun run() {
                        val remaining = deadlineMs - System.currentTimeMillis()
                        timerLabel.text = if (remaining <= 0L) "El plazo ha terminado" else "Tiempo restante: ${formatRewardsDuration(remaining)}"
                        if (remaining > 0L) handler.postDelayed(this, 1000L)
                    }
                }
                countdownRunnable = tick
                tick.run()
            }
        }
        content.addView(txt("QUÉ DEBES HACER", 9f, RED, bold = true, ls = .08f, top = 3, bot = 4))
        content.addView(txt(rewardsMissionFullDescription(mission, data), 12f, TEXT2, bot = 10))
        val progressText = rewardsMissionProgressText(mission, data.optJSONObject("profile") ?: JSONObject(), data)
        if (progressText.isNotBlank()) {
            content.addView(txt("TU PROGRESO", 9f, RED, bold = true, ls = .08f, top = 4, bot = 4))
            content.addView(txt(progressText, 12f, TEXT, bold = true, bot = 8))
        }
        if (id == "weekly" || id == "streak") {
            content.addView(txt("CALENDARIO SEMANAL", 9f, RED, bold = true, ls = .08f, top = 4, bot = 4))
            content.addView(buildRewardsWeekCalendar(mission, data))
            content.addView(txt("Solo cuenta un día cuando el subtotal de una compra pagada supera los 1 000 CUP. Varias compras el mismo día siguen contando como un solo día.", 10f, TEXT2, bot = 8))
        }
        content.addView(txt("RECOMPENSA", 9f, RED, bold = true, ls = .08f, top = 4, bot = 4))
        content.addView(txt(mission.optString("reward", "Esta campaña todavía no tiene una recompensa publicada."), 12f, PURPLE, bold = true, bot = 8))
        content.addView(txt("La recompensa solo se considera obtenida cuando aparece confirmada en tu cuenta. El servidor verifica el pago y evita emitir el mismo cupón dos veces para un mismo hito.", 10f, TEXT2, bot = 8))
        if (id == "recruit" || id.startsWith("referrals_")) {
            content.addView(txt("TU CÓDIGO DE INVITACIÓN", 9f, RED, bold = true, ls = .08f, top = 5, bot = 4))
            content.addView(txt(referralCode.ifBlank { "El código se mostrará al sincronizar tu cuenta." }, 15f, TEXT, bold = true, bot = 7))
            val shareRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            shareRow.addView(btn("Copiar código").apply {
                isAllCaps = false; textSize = 9f
                layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 42), 1f).apply { marginEnd = dp(this@MainActivity, 6) }
                isEnabled = referralCode.isNotBlank()
                setOnClickListener {
                    if (referralCode.isNotBlank()) {
                        (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                            .setPrimaryClip(android.content.ClipData.newPlainText("Código de referido", referralCode))
                        showSoToast("Código copiado.")
                    }
                }
            })
            shareRow.addView(btn("Compartir").apply {
                isAllCaps = false; textSize = 9f
                layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 42), 1f)
                isEnabled = referralCode.isNotBlank()
                setOnClickListener {
                    if (referralCode.isNotBlank()) {
                        val share = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, "SynthesisOne")
                            putExtra(Intent.EXTRA_TEXT, "Prueba SynthesisOne. Usa mi código de referido $referralCode al registrarte: https://play.google.com/store/apps/details?id=$packageName")
                        }
                        startActivity(Intent.createChooser(share, "Compartir SynthesisOne"))
                    }
                }
            })
            content.addView(shareRow)
        }
        if (id == "welcome") {
            content.addView(btn("Ver carrito").apply {
                isAllCaps = false; textSize = 10f; setTextColor(TEXT)
                background = roundedBackground(SURFACE2, 9, RED, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(this@MainActivity, 7)
                }
                setOnClickListener {
                    detailDialog?.dismiss()
                    rewardsDialog?.dismiss()
                    showStoreCartPanel()
                }
            })
        }
        content.addView(btn("Ver mis cupones").apply {
            isAllCaps = false; textSize = 10f; setTextColor(TEXT)
            background = roundedBackground(SURFACE2, 9, PURPLE, 1)
            setOnClickListener {
                detailDialog?.dismiss()
                onViewCoupons()
            }
        })
        val dialog = ThemedAlertDialogBuilder(this).setTitle(rewardsMissionTitle(mission)).setView(scroll)
            .setNegativeButton("Cerrar", null).create()
        detailDialog = dialog
        dialog.setOnDismissListener { countdownRunnable?.let { handler.removeCallbacks(it) } }
        dialog.setOnShowListener { styleSoDialog(dialog, expanded = true) }
        dialog.show()
    }

    private fun rewardsMissionFullDescription(mission: JSONObject, data: JSONObject): String {
        val id = mission.optString("id", "")
        val referrals = data.optJSONObject("profile")?.optInt("referrals_count", 0) ?: 0
        val status = welcomeRewardStatus(data)
        return when (id) {
            "welcome" -> {
                val tiers = data.optJSONObject("welcome")?.optJSONArray("discount_tiers") ?: JSONArray()
                val tierLines = if (tiers.length() >= 3) {
                    val first = tiers.optJSONObject(0) ?: JSONObject()
                    val second = tiers.optJSONObject(1) ?: JSONObject()
                    val third = tiers.optJSONObject(2) ?: JSONObject()
                    "• Menos de ${formatCatalogPrice(first.optLong("max", 3000))} CUP: ${formatRewardPercent(first.optDouble("percent", 3.0))} de descuento.\n" +
                    "• Desde ${formatCatalogPrice(second.optLong("min", 3000))} hasta ${formatCatalogPrice(second.optLong("max", 7000))} CUP, ambos incluidos: ${formatRewardPercent(second.optDouble("percent", 7.0))} de descuento.\n" +
                    "• Más de ${formatCatalogPrice(third.optLong("min", 7000))} CUP: ${formatRewardPercent(third.optDouble("percent", 10.0))} de descuento."
                } else {
                    "• Compras inferiores a 3 000 CUP: 3 % de descuento.\n• Compras desde 3 000 hasta 7 000 CUP, ambos incluidos: 7 % de descuento.\n• Compras superiores a 7 000 CUP: 10 % de descuento."
                }
                val cart = welcomeCartEstimateText(status, data.optJSONObject("welcome") ?: JSONObject())
                "¡Aprovecha tu descuento de bienvenida antes de que termine el tiempo! Dispones de 24 horas desde la instalación de la aplicación para realizar tu primera compra elegible en CUP. El porcentaje se calcula sobre el subtotal conjunto del carrito, antes de aplicar el descuento.\n\nNIVELES DE DESCUENTO\n$tierLines\n\nCONDICIONES\n• Solo se aplica a tu primera compra elegible en CUP.\n• Puedes reunir varias ofertas en el mismo carrito; el descuento se calcula sobre el subtotal conjunto.\n• Puedes pagar mediante transferencia o Wallet en CUP cuando el método esté disponible para los productos seleccionados.\n• No se aplica a compras con Saldo Móvil.\n• La cuenta regresiva continúa aunque cierres la aplicación o estés sin conexión.\n• Si el plazo termina antes de completar una compra elegible, la promoción vence.\n• El descuento se confirma al validar la compra en el servidor.\n\nSUBTOTAL Y DESCUENTO ESTIMADO\n$cart\n\nESTADO ACTUAL\n${when (status) { "USED" -> "La promoción ya se utilizó."; "PENDING_CONFIRMATION" -> "Hay una compra con la promoción pendiente de confirmación; no se debe aplicar una segunda vez."; "EXPIRED" -> "La promoción está vencida o la cuenta ya no cumple las condiciones para utilizarla."; else -> "La promoción está disponible mientras el contador permanezca activo." }}"
            }
            "recruit" -> "Comparte tu código de referido con amigos y conocidos. Cuando tres personas nuevas se registren utilizando tu código, desde dispositivos distintos del tuyo, y completen su primera compra pagada y verificada, completarás esta misión.\n\nCONDICIONES\n• Se necesitan 3 referidos válidos.\n• Cada persona debe estar vinculada a tu código.\n• El referido solo cuenta después de su primera compra pagada y verificada.\n• Las autorreferencias y las cuentas vinculadas al mismo dispositivo no cuentan.\n• Una misma persona solo puede atribuirse a un código.\n• La recompensa se concede una sola vez.\n\nPROGRESO\nReferidos válidos: $referrals/3."
            "referrals_10", "referrals_20", "referrals_30" -> {
                val target = mission.optInt("target", 10)
                val rewardText = when (target) {
                    10 -> "Al alcanzar 10 referidos válidos recibes un cupón del 5 %, utilizable en ofertas elegibles en CUP sin importe mínimo."
                    20 -> "Al alcanzar 20 referidos válidos recibes un cupón del 10 %. El subtotal conjunto del carrito debe ser superior a 8 000 CUP."
                    else -> "Al alcanzar 30 referidos válidos recibes un cupón del 15 %. El subtotal conjunto del carrito debe ser superior a 25 000 CUP."
                }
                "Comparte tu código de invitación para conseguir nuevos clientes. Un referido válido es una persona nueva vinculada a tu código que completa su primera compra pagada y verificada desde un dispositivo distinto al tuyo.\n\nRECOMPENSA DE ESTE HITO\n$rewardText\n\nTODOS LOS HITOS\n• 10 referidos: cupón del 5 %, sin importe mínimo.\n• 20 referidos: cupón del 10 %, con subtotal superior a 8 000 CUP.\n• 30 referidos: cupón del 15 %, con subtotal superior a 25 000 CUP.\n• Los mínimos se calculan sobre el subtotal conjunto, no sobre cada oferta individual. Por ejemplo, diez ofertas de 1 000 CUP suman 10 000 CUP y cumplen el mínimo del cupón del 10 %.\n• Cada hito concede su propio cupón una sola vez; al llegar a 30 no desaparecen los anteriores.\n• No cuentan las autorreferencias ni las cuentas del mismo dispositivo, y cada persona solo puede vincularse a un código.\n\nPROGRESO\nReferidos válidos: $referrals/$target. Faltan ${(target - referrals).coerceAtLeast(0)} para este hito."
            }
            "monthly" -> "Realiza tres compras diferentes durante el mes calendario. Cada compra debe tener un subtotal elegible superior a 15 000 CUP y su pago debe quedar confirmado.\n\nCONDICIONES\n• Cada compra debe superar individualmente los 15 000 CUP; exactamente 15 000 CUP no es suficiente.\n• Tres ofertas dentro de un mismo pedido cuentan como una sola compra.\n• Los pagos pendientes no cuentan.\n• Las compras canceladas, fallidas o reembolsadas no cuentan.\n• El servidor evalúa el progreso por mes calendario, según el período mostrado en la tarjeta.\n• Si no completas las tres compras antes del cambio de mes, el contador comienza de nuevo.\n• Al completar la misión se emite un cupón del 7 %; el siguiente período mensual puede volver a habilitar la misión.\n\nPROGRESO\nCompras completadas: ${mission.optInt("progress", 0).coerceAtLeast(0)}/3."
            "weekly" -> "Realiza compras pagadas en cinco días distintos de la misma semana. Cada día válido debe incluir al menos una compra con subtotal superior a 1 000 CUP.\n\nCONDICIONES\n• Se necesitan cinco días diferentes dentro de la semana que aparece en el calendario.\n• Una compra diaria es suficiente; varias compras el mismo día solo suman un día.\n• Solo cuentan pagos confirmados. Las compras canceladas, fallidas o reembolsadas no cuentan.\n• Al completar los cinco días, se concede un cupón del 3 %.\n• El progreso semanal se reinicia al comenzar la siguiente semana; después de completar la misión, podrás participar en la siguiente semana elegible.\n\nPROGRESO\nDías completados: ${mission.optInt("progress", 0).coerceAtLeast(0)}/5."
            "explorer" -> "Explora los servicios de SynthesisOne y realiza al menos una compra pagada y confirmada en Game Market y otra en ETECSA dentro de una ventana de 30 días. Una compra elegible en cada servicio es suficiente.\n\nESTADO POR SERVICIO\n• Game Market: ${if (mission.optBoolean("game_market_completed")) "compra verificada" else "pendiente"}.\n• ETECSA: ${if (mission.optBoolean("etecsa_completed")) "compra verificada" else "pendiente"}.\n\nCONDICIONES\n• Los pedidos pendientes, fallidos o cancelados no cuentan.\n• Ambas compras deben permanecer dentro de la ventana móvil de 30 días que valida el servidor.\n• Al completar ambos servicios, la recompensa configurada es un cupón del 3 % para una compra posterior elegible en CUP."
            "collector" -> "Añade al menos tres ofertas diferentes al mismo carrito y completa el pago para desbloquear esta misión. Tres unidades de una misma oferta no equivalen a tres ofertas distintas.\n\nCONDICIONES\n• Las ofertas deben ser diferentes y estar en un mismo pedido.\n• El pedido debe quedar pagado y verificado; añadir productos al carrito no basta.\n• Si la compra se cancela o se devuelve completamente, no se considera completada.\n• El registro de compra que valida la misión cuenta las líneas de oferta/precio distintas del pedido.\n\nRECOMPENSA\nEl sistema actual configura un cupón del 3 % para una compra posterior elegible en CUP."
            "return" -> {
                val returnInfo = data.optJSONObject("return_mission") ?: JSONObject()
                val eligibleAt = parseRewardsDate(returnInfo.optString("eligible_at", ""))
                val availability = when {
                    mission.optBoolean("completed") -> "La misión ya generó una recompensa en tu historial."
                    eligibleAt == null -> "Aún no está disponible: primero debes completar una compra pagada y verificada. Después deberán transcurrir al menos 30 días sin compras pagadas."
                    eligibleAt > System.currentTimeMillis() -> "Aún no está disponible. Si no haces nuevas compras, podrás cumplir los 30 días de inactividad desde ${formatRewardsDate(returnInfo.optString("eligible_at", ""))}."
                    else -> "Ya se cumplen los 30 días de inactividad; la recompensa solo se concede tras completar la nueva compra elegible."
                }
                "¿Hace tiempo que no compras en SynthesisOne? Vuelve con una compra pagada y verificada cuyo subtotal en CUP sea superior a 3 000 CUP, después de al menos 30 días sin compras pagadas registradas.\n\nCONDICIONES\n• Deben transcurrir al menos 30 días desde la última compra pagada registrada.\n• La nueva compra debe superar los 3 000 CUP; exactamente 3 000 CUP no basta.\n• El pago de regreso debe quedar confirmado.\n• Los pedidos pendientes, fallidos o cancelados no cuentan.\n• La recompensa solo se concede cuando el servidor confirma todas las condiciones.\n\nDISPONIBILIDAD\n$availability\n\nRECOMPENSA\nCupón del 3 % para una compra posterior elegible en CUP."
            }
            "streak" -> "Esta es una misión adicional a la racha semanal principal. Para obtener su cupón debes completar la misión semanal en dos semanas calendario consecutivas: en cada semana, realiza compras pagadas con subtotal superior a 1 000 CUP en cinco días distintos.\n\nCONDICIONES\n• Cada semana necesita cinco días válidos diferentes.\n• Varias compras en un mismo día no suman días adicionales.\n• Solo cuentan pagos confirmados; no cuentan compras canceladas, fallidas o reembolsadas.\n• Esta misión mantiene un progreso separado de la misión semanal y su recompensa se identifica como un hito distinto.\n• La lógica del servidor evita duplicar la emisión correspondiente al mismo hito semanal.\n\nPROGRESO\nSemanas objetivo completadas: ${mission.optInt("progress", 0).coerceAtLeast(0)}/2.\n\nRECOMPENSA\nCupón del 3 % para una compra posterior elegible en CUP."
            else -> {
                val start = formatRewardsDate(mission.optString("starts_at", ""))
                val end = formatRewardsDate(mission.optString("ends_at", ""))
                val minimumPurchase = mission.optDouble("minimum_purchase_cup", 0.0).toLong()
                val target = mission.optInt("required_purchases", mission.optInt("target", 1)).coerceAtLeast(1)
                val rewardMinimum = mission.optDouble("reward_minimum_subtotal_cup", 0.0).toLong()
                val desc = mission.optString("description", "La administración no ha publicado una descripción adicional para esta campaña.").ifBlank {
                    "La administración no ha publicado una descripción adicional para esta campaña."
                }
                "MISIÓN PROMOCIONAL CONFIGURADA\n$desc\n\nQUÉ DEBES HACER\n• Completar $target compra(s) pagada(s) y verificada(s) durante la campaña.\n• Cada compra que cuente debe estar en CUP y ${if (minimumPurchase > 0) "superar ${formatCatalogPrice(minimumPurchase)} CUP" else "tener un subtotal superior a cero CUP"}.\n• El avance actual es ${mission.optInt("progress", 0).coerceAtLeast(0)}/$target compras.\n• La recompensa se concede como máximo una vez para esta campaña.\n\nPLAZO\n• Inicio: ${start.ifBlank { "no indicado por la campaña" }} (hora de Cuba).\n• Fin: ${end.ifBlank { "no indicado por la campaña" }} (hora de Cuba).\n\nRECOMPENSA Y RESTRICCIONES\n• Cupón del ${formatRewardPercent(mission.optDouble("reward_percent", 0.0))} para una compra posterior elegible en CUP.\n• ${if (rewardMinimum > 0) "Para usar el cupón, el subtotal debe alcanzar al menos ${formatCatalogPrice(rewardMinimum)} CUP." else "La campaña no configura un mínimo adicional para usar el cupón."}\n• Solo cuentan compras que cumplen los criterios de la campaña; el servidor confirma el pago y la recompensa."
            }
        }
    }

    private fun welcomeCartEstimateText(welcomeStatus: String, welcome: JSONObject): String {
        val items = loadLocalCartItems()
        if (items.length() == 0) return "Subtotal actual del carrito: 0 CUP (no hay ofertas añadidas).\nAñade ofertas con precio CUP para calcular el descuento estimado."
        var subtotal = 0L
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i) ?: return "No se puede estimar de forma fiable: hay una línea del carrito que necesita actualizarse. El servidor validará el subtotal final."
            val price = row.optLong("price_cup", 0L)
            if (price <= 0L) return "No se puede estimar de forma fiable porque al menos una oferta no tiene un precio CUP guardado. Actualiza el carrito para ver el subtotal."
            subtotal += price
        }
        if (welcomeStatus != "AVAILABLE") {
            return "Subtotal actual del carrito: ${formatCatalogPrice(subtotal)} CUP.\nNo se calcula un descuento de bienvenida porque el estado actual es ${when (welcomeStatus) { "USED" -> "utilizado"; "PENDING_CONFIRMATION" -> "pendiente de confirmación"; else -> "vencido o no elegible" }}."
        }
        val tiers = welcome.optJSONArray("discount_tiers") ?: JSONArray()
        val percent = (0 until tiers.length()).mapNotNull { tiers.optJSONObject(it) }.firstOrNull { tier ->
            val minimum = tier.optDouble("min", 0.0)
            val maximumIsOpen = tier.isNull("max")
            val maximum = tier.optDouble("max", Double.POSITIVE_INFINITY)
            val aboveMinimum = if (tier.optBoolean("min_inclusive", true)) subtotal >= minimum else subtotal > minimum
            val belowMaximum = maximumIsOpen || if (tier.optBoolean("max_inclusive", false)) subtotal <= maximum else subtotal < maximum
            aboveMinimum && belowMaximum
        }?.optDouble("percent") ?: when {
            subtotal < 3000L -> 3.0
            subtotal <= 7000L -> 7.0
            else -> 10.0
        }
        // JavaScript Math.round on the backend rounds positive half values upward; mirror it for the estimate.
        val discount = kotlin.math.floor(subtotal * percent / 100.0 + 0.5).toLong().coerceIn(0L, subtotal)
        val total = (subtotal - discount).coerceAtLeast(0L)
        return "Subtotal actual del carrito: ${formatCatalogPrice(subtotal)} CUP (estimado).\nDescuento que correspondería al pagar en CUP: ${formatRewardPercent(percent)} · ${formatCatalogPrice(discount)} CUP.\nTotal estimado después del descuento: ${formatCatalogPrice(total)} CUP, antes de cualquier otro cargo aplicable.\nEsta estimación no se aplica a pagos con Saldo Móvil. El servidor confirmará el importe definitivo al validar la compra."
    }

    private fun formatRewardPercent(value: Double): String {
        val rounded = kotlin.math.round(value * 100.0) / 100.0
        return if (rounded == rounded.toLong().toDouble()) "${rounded.toLong()}%" else "${String.format(Locale.US, "%.2f", rounded).trimEnd('0').trimEnd('.')}%"
    }

    private fun formatRewardsDuration(milliseconds: Long): String {
        val seconds = (milliseconds / 1000L).coerceAtLeast(0L)
        val hours = seconds / 3600L
        val minutes = (seconds % 3600L) / 60L
        val rest = seconds % 60L
        return String.format(Locale.US, "%02d h %02d min %02d s", hours, minutes, rest)
    }

    private fun formatRewardsDate(value: String?): String {
        val timestamp = parseRewardsDate(value) ?: return ""
        return SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).apply {
            timeZone = TimeZone.getTimeZone("America/Havana")
        }.format(Date(timestamp))
    }

    private fun relatedCouponsForMission(mission: JSONObject, data: JSONObject): List<JSONObject> {
        val id = mission.optString("id", "")
        val coupons = data.optJSONArray("coupons") ?: JSONArray()
        val wanted = when (id) {
            "recruit" -> "MISSION_RECRUIT" to "mission:recruit:once"
            "referrals_10" -> "REFERRALS" to "referrals:10"
            "referrals_20" -> "REFERRALS" to "referrals:20"
            "referrals_30" -> "REFERRALS" to "referrals:30"
            "monthly" -> "MISSION_MONTHLY" to "mission:monthly:${mission.optString("period_key", "")}"
            "weekly" -> "MISSION_WEEKLY" to "mission:weekly:${mission.optString("period_key", "")}"
            "streak" -> "MISSION_STREAK" to "mission:streak:${mission.optString("period_key", "")}"
            "explorer" -> "MISSION_EXPLORER" to "mission:explorer:once"
            "collector" -> "MISSION_COLLECTOR" to "mission:collector:once"
            "return" -> "MISSION_RETURN" to "mission:return:"
            else -> if (mission.optString("type") == "flash") "MISSION_FLASH" to "campaign:${mission.optString("campaign_id", "")}" else "" to ""
        }
        if (wanted.first.isBlank()) return emptyList()
        return (0 until coupons.length()).mapNotNull { coupons.optJSONObject(it) }
            .filter { it.optString("source") == wanted.first && if (wanted.second.endsWith(":")) it.optString("source_key").startsWith(wanted.second) else it.optString("source_key") == wanted.second }
    }

    private fun welcomeRewardStatus(data: JSONObject): String {
        val welcome = data.optJSONObject("welcome") ?: JSONObject()
        val explicit = welcome.optString("status", "").uppercase(Locale.ROOT)
        if (explicit in setOf("AVAILABLE", "PENDING_CONFIRMATION", "USED", "EXPIRED")) return explicit
        // Backward-compatible reading for a cached dashboard created by an older server.
        return if (welcome.optBoolean("available", false) && (welcome.optLong("remaining_ms", 0L) > 0L)) "AVAILABLE" else "EXPIRED"
    }

    private fun rewardCouponDisplayState(coupon: JSONObject): String {
        val raw = coupon.optString("status", "AVAILABLE").uppercase(Locale.ROOT)
        if (raw == "REVOKED") return "REVOKED"
        if (raw == "USED") return "USED"
        val expiry = parseRewardsDate(coupon.optString("expires_at", ""))
        if (raw == "EXPIRED" || (expiry != null && expiry <= System.currentTimeMillis())) return "EXPIRED"
        return if (raw == "RESERVED") "RESERVED" else "AVAILABLE"
    }

    private fun rewardCouponStateLabel(coupon: JSONObject): String = when (rewardCouponDisplayState(coupon)) {
        "AVAILABLE" -> "Disponible"
        "RESERVED" -> "Compra pendiente de confirmación"
        "USED" -> "Utilizado"
        "EXPIRED" -> "Vencido"
        else -> "Revocado"
    }

    private fun couponOriginLabel(coupon: JSONObject): String = when (coupon.optString("source", "")) {
        "MISSION_RECRUIT" -> "Recluta novato"
        "REFERRALS" -> when (coupon.optString("source_key", "")) {
            "referrals:10" -> "Embajador de SynthesisOne · hito de 10 referidos"
            "referrals:20" -> "Embajador de SynthesisOne · hito de 20 referidos"
            "referrals:30" -> "Embajador de SynthesisOne · hito de 30 referidos"
            else -> "Embajador de SynthesisOne"
        }
        "MISSION_MONTHLY" -> "Cliente frecuente"
        "MISSION_WEEKLY" -> "Racha de compras"
        "MISSION_STREAK" -> "Racha imparable"
        "MISSION_EXPLORER" -> "Explorador de SynthesisOne"
        "MISSION_COLLECTOR" -> "Coleccionista de ofertas"
        "MISSION_RETURN" -> "El regreso del héroe"
        "MISSION_FLASH" -> "Misión relámpago"
        else -> "Recompensa de SynthesisOne"
    }

    private fun showRewardCouponDetails(coupon: JSONObject) {
        val state = rewardCouponDisplayState(coupon)
        val code = coupon.optString("coupon_code", "")
        val percent = coupon.optDouble("discount_percent", 0.0)
        val minimum = coupon.optDouble("minimum_subtotal_cup", 0.0).toLong()
        val exclusive = coupon.optBoolean("minimum_exclusive", false)
        val items = loadLocalCartItems()
        var cartSubtotal = 0L
        var cartValid = items.length() > 0
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i)
            val price = row?.optLong("price_cup", 0L) ?: 0L
            if (price <= 0L) cartValid = false else cartSubtotal += price
        }
        val cartReason = when {
            state == "USED" -> "Este cupón ya se utilizó y no puede volver a aplicarse."
            state == "EXPIRED" -> "Este cupón ha vencido y el servidor no lo aceptará en una nueva compra."
            state == "REVOKED" -> "Este cupón fue revocado y ya no se puede utilizar."
            state == "RESERVED" -> "Este cupón está reservado para una compra pendiente de confirmación."
            items.length() == 0 -> "Añade ofertas al carrito para comprobar el importe mínimo. La validación final se hará al confirmar el pedido."
            !cartValid -> "No es posible comprobar el mínimo con precisión porque hay ofertas sin precio CUP guardado. Actualiza el carrito."
            minimum > 0 && (if (exclusive) cartSubtotal <= minimum else cartSubtotal < minimum) -> "Tu carrito suma ${formatCatalogPrice(cartSubtotal)} CUP. ${if (exclusive) "Necesitas superar" else "Necesitas alcanzar"} ${formatCatalogPrice(minimum)} CUP para utilizar este cupón."
            else -> "El subtotal estimado de tu carrito es ${formatCatalogPrice(cartSubtotal)} CUP${if (minimum > 0) "; cumple el mínimo configurado" else "; no hay importe mínimo configurado"}. El servidor debe confirmar que las ofertas elegidas admiten este descuento."
        }
        val expiry = coupon.optString("expires_at", "")
        val issued = coupon.optString("issued_at", "")
        val body = "DESCUENTO\n${formatRewardPercent(percent)} para una compra posterior elegible.\n\nCÓDIGO\n$code\n\nESTADO\n${rewardCouponStateLabel(coupon)}\n\nORIGEN\n${couponOriginLabel(coupon)}\n\nMONEDA Y MÍNIMO\nSolo se aplica a compras elegibles en CUP. ${if (minimum > 0) "El subtotal debe ${if (exclusive) "superar" else "alcanzar"} ${formatCatalogPrice(minimum)} CUP." else "No hay importe mínimo adicional configurado."}\n\nCADUCIDAD\n${if (expiry.isBlank()) "El sistema no ha configurado una fecha de caducidad." else formatRewardsDate(expiry) + " (hora de Cuba)"}\n\nOBTENIDO\n${if (issued.isBlank()) "Fecha no disponible" else formatRewardsDate(issued) + " (hora de Cuba)"}\n\n¿POR QUÉ PODRÍA NO APLICARSE?\n$cartReason\n\nRESTRICCIONES\n• El cupón es de uso único y no se acumula con otro cupón en el mismo pedido.\n• Si todavía eres elegible para la promoción de bienvenida, el servidor puede aplicar esa promoción en lugar del cupón.\n• El estado final y la elegibilidad de los productos se validan en el servidor al confirmar el pedido."
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(ll().apply {
            setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 15))
            addView(txt(body, 12f, TEXT2))
        }) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Detalles del cupón")
            .setView(scroll).setNegativeButton("Cerrar", null)
            .setPositiveButton("Copiar código", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog, expanded = true)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = state == "AVAILABLE" && code.isNotBlank()
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (state == "AVAILABLE" && code.isNotBlank()) {
                    (getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager)
                        .setPrimaryClip(android.content.ClipData.newPlainText("Cupón SynthesisOne", code))
                    showSoToast("Código copiado.")
                    dialog.dismiss()
                }
            }
        }
        dialog.show()
    }

    private fun showConfig(guideToReseller: Boolean = false) {
        clearAssistantFloatingUi()
        rootFrame.setBackgroundColor(BG)
        window.setBackgroundDrawable(ColorDrawable(BG))
        updateSystemBars()
        rootFrame.removeAllViews()
        val scroll = ScrollView(this).apply {
            setBackgroundColor(BG)
            isFillViewport = true
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        }
        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,60),
                dp(this@MainActivity,28), dp(this@MainActivity,48))
        }

        layout.addView(futuristicBackButton("←  VOLVER") { showDashboard() })

        layout.addView(txt("CONFIGURACIÓN", 11f, RED, bold=true, ls=0.15f, bot=8))
        layout.addView(txt("Perfil, apariencia y preferencias", 16f, TEXT, bold=true, bot=22))
        layout.addView(gradientDivider())
        layout.addView(btn("🎯  RECOMPENSAS, CUPONES Y CÓDIGO DE REFERIDO").apply {
            textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, PURPLE, 1)
            visibility = View.VISIBLE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 46)).apply { topMargin = dp(this@MainActivity, 12) }
            setOnClickListener { openRewardsEntry() }
        })
        layout.addView(btn("↻  BUSCAR ACTUALIZACIONES").apply {
            textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, BLUE, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { topMargin = dp(this@MainActivity, 8) }
            setOnClickListener { checkForAppUpdate(showIfCurrent = true) }
        })

        // Perfil sincronizado con la cuenta autenticada y conservado localmente para consulta.
        layout.addView(txt("PERFIL Y PREFERENCIAS", 10f, RED, bold=true, ls=0.10f, top=18, bot=5))
        layout.addView(txt("Tu perfil se asocia a tu cuenta. La edad y la ubicación permanecen privadas hasta que decidas compartirlas.", 10f, TEXT2, bot=10))
        val profileCard = ll().apply {
            setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 13), dp(this@MainActivity, 14), dp(this@MainActivity, 13))
            background = roundedBackground(SURFACE, 16, Color.parseColor("#2A3043"), 1)
        }
        val profileTop = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val avatar = createProfileAvatar(76)
        avatar.layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 76), dp(this@MainActivity, 76)).apply { marginEnd = dp(this@MainActivity, 12) }
        profilePhotoPreview = avatar
        val photoActions = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        photoActions.addView(txt("Tu foto de perfil", 13f, TEXT, bold=true, bot=3))
        photoActions.addView(txt("Se verá junto a tu usuario", 10f, TEXT2, bot=8))
        photoActions.addView(btn("ELEGIR FOTO").apply {
            textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, RED, 1)
            setOnClickListener { openImagePicker(REQUEST_PROFILE_PHOTO) }
        })
        profileTop.addView(avatar); profileTop.addView(photoActions); profileCard.addView(profileTop)
        profileCard.addView(lbl("NOMBRE VISIBLE", top=16))
        val displayNameInput = inp("Ej.: Laydel", maxLen=32).apply { setText(prefs.getString(PREF_PROFILE_NAME, "").orEmpty()) }
        profileCard.addView(displayNameInput)
        profileCard.addView(lbl("USERNAME", top=4))
        val usernameRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        usernameRow.addView(txt("@", 17f, RED, bold=true).apply { setPadding(0, 0, dp(this@MainActivity, 8), 0) })
        val usernameInput = inp("usuario_123", maxLen=20).apply {
            setText(prefs.getString(PREF_PROFILE_USERNAME, "").orEmpty().removePrefix("@"))
            filters = arrayOf(InputFilter.LengthFilter(20), InputFilter { source, start, end, _, _, _ ->
                val candidate = source.subSequence(start, end).toString()
                if (candidate.matches(Regex("[A-Za-z0-9_]*"))) null else ""
            })
        }
        usernameRow.addView(usernameInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        profileCard.addView(usernameRow)
        profileCard.addView(lbl("EDAD (OPCIONAL)", top=4))
        val ageInput = inp("Edad en años", maxLen=3, numeric=true).apply { setText(prefs.getString(PREF_PROFILE_AGE, "").orEmpty()) }
        profileCard.addView(ageInput)

        val locationTitle = txt("UBICACIÓN EN CUBA (OPCIONAL)", 10f, TEXT2, bold=true, ls=.07f, top=6, bot=8)
        profileCard.addView(locationTitle)
        val locations = cubaMunicipalities()
        val provinceOptions = listOf("Selecciona provincia") + locations.keys.toList()
        val provinceAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, provinceOptions).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        val provinceSpinner = Spinner(this).apply { adapter = provinceAdapter }
        val municipalityOptions = mutableListOf("Selecciona municipio")
        val municipalityAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, municipalityOptions).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        val municipalitySpinner = Spinner(this).apply { adapter = municipalityAdapter }
        val savedProvince = prefs.getString(PREF_PROFILE_PROVINCE, "").orEmpty()
        val savedMunicipality = prefs.getString(PREF_PROFILE_MUNICIPALITY, "").orEmpty()
        provinceSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                val province = provinceOptions.getOrNull(position).orEmpty()
                val municipios = locations[province].orEmpty()
                municipalityAdapter.clear()
                municipalityAdapter.add("Selecciona municipio")
                municipalityAdapter.addAll(municipios)
                municipalityAdapter.notifyDataSetChanged()
                if (province == savedProvince && savedMunicipality in municipios) {
                    municipalitySpinner.setSelection(municipios.indexOf(savedMunicipality) + 1)
                } else {
                    municipalitySpinner.setSelection(0)
                }
            }
        }
        profileCard.addView(provinceSpinner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 48)))
        profileCard.addView(municipalitySpinner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 48)))
        if (savedProvince in locations.keys) provinceSpinner.setSelection(provinceOptions.indexOf(savedProvince))
        profileCard.addView(txt("PRIVACIDAD DEL PERFIL", 9f, PURPLE, bold=true, ls=.08f, top=12, bot=4))
        val displayNamePublicSwitch = Switch(this).apply { text = "Mostrar nombre visible"; setTextColor(TEXT); isChecked = prefs.getBoolean(PREF_PROFILE_DISPLAY_NAME_PUBLIC, false) }
        val avatarPublicSwitch = Switch(this).apply { text = "Mostrar foto de perfil"; setTextColor(TEXT); isChecked = prefs.getBoolean(PREF_PROFILE_AVATAR_PUBLIC, false) }
        val agePublicSwitch = Switch(this).apply { text = "Mostrar edad"; setTextColor(TEXT); isChecked = prefs.getBoolean(PREF_PROFILE_AGE_PUBLIC, false) }
        val locationPublicSwitch = Switch(this).apply { text = "Mostrar provincia y municipio"; setTextColor(TEXT); isChecked = prefs.getBoolean(PREF_PROFILE_LOCATION_PUBLIC, false) }
        profileCard.addView(displayNamePublicSwitch); profileCard.addView(avatarPublicSwitch); profileCard.addView(agePublicSwitch); profileCard.addView(locationPublicSwitch)

        val profileStatus = txt("", 10f, TEXT2, top=6, bot=5)
        profileCard.addView(profileStatus)
        val saveProfile = btn("GUARDAR PERFIL").apply {
            textSize = 10f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 11, RED, 0)
        }
        profileCard.addView(saveProfile)
        saveProfile.setOnClickListener {
            val username = usernameInput.text.toString().trim().removePrefix("@").lowercase(Locale.ROOT)
            val ageText = ageInput.text.toString().trim()
            val age = ageText.toIntOrNull()
            if (username.isNotBlank() && !username.matches(Regex("[a-z0-9_]{3,20}"))) {
                profileStatus.setTextColor(ERR); profileStatus.text = "El username debe tener 3–20 caracteres: letras, números o guion bajo."; return@setOnClickListener
            }
            if (ageText.isNotBlank() && (age == null || age !in 1..120)) {
                profileStatus.setTextColor(ERR); profileStatus.text = "Introduce una edad válida entre 1 y 120, o deja el campo vacío."; return@setOnClickListener
            }
            val province = provinceSpinner.selectedItem?.toString().orEmpty().takeUnless { it == "Selecciona provincia" }.orEmpty()
            val municipality = municipalitySpinner.selectedItem?.toString().orEmpty().takeUnless { it == "Selecciona municipio" }.orEmpty()
            if (municipality.isNotBlank() && province.isBlank()) {
                profileStatus.setTextColor(ERR); profileStatus.text = "Selecciona primero una provincia."; return@setOnClickListener
            }
            val displayName = displayNameInput.text.toString().trim()
            prefs.edit().apply {
                putString(PREF_PROFILE_NAME, displayName)
                putString(PREF_PROFILE_USERNAME, username)
                putString(PREF_PROFILE_AGE, ageText)
                putString(PREF_PROFILE_PROVINCE, province)
                putString(PREF_PROFILE_MUNICIPALITY, municipality)
                putBoolean(PREF_PROFILE_DISPLAY_NAME_PUBLIC, displayNamePublicSwitch.isChecked)
                putBoolean(PREF_PROFILE_AVATAR_PUBLIC, avatarPublicSwitch.isChecked)
                putBoolean(PREF_PROFILE_AGE_PUBLIC, agePublicSwitch.isChecked)
                putBoolean(PREF_PROFILE_LOCATION_PUBLIC, locationPublicSwitch.isChecked)
                putBoolean(PREF_PROFILE_SYNC_PENDING, true)
            }.apply()
            val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
            if (token.isBlank() || !isDeviceOnline()) {
                profileStatus.setTextColor(GREEN)
                profileStatus.text = "Perfil guardado localmente. Se sincronizará cuando haya conexión y una sesión válida."
            } else {
                saveProfile.isEnabled = false
                profileStatus.setTextColor(MUTED); profileStatus.text = "Guardado localmente; sincronizando con tu cuenta…"
                val payload = JSONObject().apply {
                    put("display_name", displayName); put("username", username)
                    put("age", if (ageText.isBlank()) JSONObject.NULL else age)
                    put("province", province); put("municipality", municipality)
                    put("theme", prefs.getString(PREF_THEME, "violet").orEmpty())
                    put("layout_style", selectedLayoutStyle())
                    put("display_name_public", displayNamePublicSwitch.isChecked)
                    put("avatar_public", avatarPublicSwitch.isChecked)
                    put("age_public", agePublicSwitch.isChecked)
                    put("location_public", locationPublicSwitch.isChecked)
                }
                uiScope.launch {
                    val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile", "PUT", token, payload) }.getOrNull() }
                    saveProfile.isEnabled = true
                    if (response != null && response.code in 200..299) {
                        prefs.edit().putBoolean(PREF_PROFILE_SYNC_PENDING, false).apply()
                        profileStatus.setTextColor(GREEN); profileStatus.text = "Perfil guardado en el dispositivo y sincronizado con tu cuenta."
                    } else {
                        profileStatus.setTextColor(Color.parseColor("#FFC56E")); profileStatus.text = "Perfil guardado localmente; la nube no confirmó el cambio. Se reintentará al recuperar conexión."
                    }
                }
            }
        }
        layout.addView(profileCard)

        // THEME SELECTOR — stable contrast regardless of the currently selected palette.
        layout.addView(txt("APARIENCIA", 10f, RED, bold=true, ls=0.10f, top=22, bot=5))
        layout.addView(txt("Elige el color principal de SynthesisOne.", 10f, TEXT2, bot=10))
        val selectedTheme = prefs.getString(PREF_THEME, "violet").orEmpty()
        val themeOptions = listOf(
            Triple("violet", "VIOLETA", Color.parseColor("#8357FF")),
            Triple("light", "CLARO", Color.parseColor("#DDE5F2")),
            Triple("red", "ROJO", Color.parseColor("#FF426D")),
            Triple("green", "VERDE", Color.parseColor("#25B981")),
            Triple("cyan", "CIAN", Color.parseColor("#19BFD1")),
            Triple("gold", "ÁMBAR", Color.parseColor("#E8AC3B")),
            Triple("ocean", "OCÉANO", Color.parseColor("#2587E8"))
        )
        themeOptions.chunked(2).forEach { optionRow ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            optionRow.forEach { (id, label, swatchColor) ->
                val selected = selectedTheme == id
                val option = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 11), dp(this@MainActivity, 10), dp(this@MainActivity, 11))
                    background = roundedBackground(if (selected) SURFACE else SURFACE2, 14,
                        if (selected) RED else blendSurfaceColor(MUTED, SURFACE2, 0.25f), if (selected) 2 else 1)
                    isClickable = true
                    isFocusable = true
                    contentDescription = "Tema $label${if (selected) ", seleccionado" else ""}"
                    layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 62), 1f).apply {
                        marginEnd = dp(this@MainActivity, 7)
                        bottomMargin = dp(this@MainActivity, 7)
                    }
                }
                val swatch = View(this).apply {
                    background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                        if (id == "light") intArrayOf(Color.parseColor("#FFFFFF"), swatchColor) else intArrayOf(swatchColor, blendSurfaceColor(swatchColor, Color.BLACK, 0.18f))).apply {
                        shape = GradientDrawable.OVAL
                        setStroke(dp(this@MainActivity, 1), blendSurfaceColor(swatchColor, Color.WHITE, 0.30f))
                    }
                    layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 30), dp(this@MainActivity, 30)).apply {
                        marginEnd = dp(this@MainActivity, 10)
                    }
                }
                option.addView(swatch)
                val optionText = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
                optionText.addView(txt(label, 10f, TEXT, bold=true))
                optionText.addView(txt(if (selected) "ACTIVO" else "", 8f, if (selected) RED else TEXT2, bold=true, top=3))
                option.addView(optionText)
                if (selected) option.addView(txt("✓", 15f, RED, bold=true).apply { setPadding(dp(this@MainActivity, 3), 0, 0, 0) })
                option.setOnClickListener {
                    prefs.edit().putString(PREF_THEME, id).apply()
                    applyNativeTheme(id)
                    applyThemePalette()
                    updateSystemBars()
                    rootFrame.setBackgroundColor(BG)
                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                    if (token.isNotBlank() && isDeviceOnline()) {
                        uiScope.launch {
                            withContext(Dispatchers.IO) {
                                runCatching { backendRequest("/api/game-market/profile", "PUT", token, JSONObject().put("theme", id)) }
                            }
                        }
                    }
                    showConfig()
                }
                row.addView(option)
            }
            if (optionRow.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, dp(this@MainActivity, 62), 1f))
            layout.addView(row)
        }

        // Layout style and color palette are separate preferences: clients may mix any design
        // with any accent theme, and the choice is stored per installed client.
        layout.addView(txt("DISEÑO DE LA INTERFAZ", 10f, RED, bold=true, ls=0.10f, top=18, bot=5))
        layout.addView(txt("Cambia las tarjetas, barras, campos y ventanas emergentes. Se aplica por separado del tema de color.", 10f, TEXT2, bot=9))
        val selectedLayout = selectedLayoutStyle()
        val layoutChoices = listOf(
            Triple("hybrid", "HÍBRIDO SIGNATURE", "Gradientes elegantes, profundidad y un acabado equilibrado."),
            Triple("professional", "PROFESIONAL", "Superficies sobrias, jerarquía clara y contornos discretos."),
            Triple("glass", "GLASSMORPHISM", "Capas translúcidas, bordes luminosos y esquinas amplias."),
            Triple("minimal", "MINIMALISTA", "Interfaz limpia, superficies planas y menos decoración."),
            Triple("aurora", "AURORA", "Gradientes vivos, iluminación violeta y energía futurista."),
            Triple("arena", "ARENA TÁCTICO", "Contornos firmes, tarjetas compactas y carácter gaming."),
            Triple("soft", "SOFT", "Formas suaves, tonos mezclados y una apariencia relajada.")
        )
        layoutChoices.forEach { (id, title, subtitle) ->
            val isSelected = selectedLayout == id
            val choice = ll().apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 11), dp(this@MainActivity, 13), dp(this@MainActivity, 11))
                background = roundedBackground(if (isSelected) SURFACE2 else SURFACE, 14, if (isSelected) RED else MUTED, if (isSelected) 2 else 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 7) }
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    prefs.edit().putString(PREF_LAYOUT_STYLE, id).putBoolean(PREF_LAYOUT_SYNC_PENDING, true).apply()
                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                    if (token.isNotBlank() && isDeviceOnline()) {
                        uiScope.launch {
                            val response = withContext(Dispatchers.IO) {
                                runCatching { backendRequest("/api/game-market/profile", "PUT", token, JSONObject().put("layout_style", id)) }.getOrNull()
                            }
                            if (response != null && response.code in 200..299) prefs.edit().putBoolean(PREF_LAYOUT_SYNC_PENDING, false).apply()
                        }
                    }
                    applyNativeTheme(prefs.getString(PREF_THEME, "violet").orEmpty())
                    applyThemePalette()
                    updateSystemBars()
                    showConfig()
                    showSoToast(if (token.isBlank() || !isDeviceOnline()) "Diseño aplicado y guardado; se sincronizará al conectar tu cuenta" else "Diseño aplicado a tarjetas, navegación y ventanas", Toast.LENGTH_SHORT)
                }
            }
            val preview = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7), dp(this@MainActivity, 7))
                val previewRadius = when (id) {
                    "glass", "soft", "aurora" -> 17
                    "minimal", "arena" -> 6
                    "professional" -> 9
                    else -> 11
                }
                background = roundedBackground(if (isLightPalette()) SURFACE2 else BG, previewRadius,
                    if (isSelected) RED else MUTED, if (isSelected) 2 else 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 43)).apply {
                    bottomMargin = dp(this@MainActivity, 9)
                }
            }
            val miniBrand = View(this).apply {
                background = roundedBackground(RED, when (id) { "glass", "soft", "aurora" -> 9; "minimal", "arena" -> 3; else -> 5 }, RED, 0)
                layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 21), dp(this@MainActivity, 21)).apply { marginEnd = dp(this@MainActivity, 7) }
            }
            preview.addView(miniBrand)
            repeat(3) { index ->
                val tileFill = when (id) {
                    "glass" -> blendSurfaceColor(SURFACE2, PURPLE, 0.23f)
                    "minimal", "professional" -> SURFACE2
                    "aurora" -> blendSurfaceColor(blendSurfaceColor(SURFACE2, PURPLE, 0.25f), RED, 0.12f)
                    "arena" -> blendSurfaceColor(SURFACE2, RED, 0.18f)
                    "soft" -> blendSurfaceColor(blendSurfaceColor(SURFACE2, PURPLE, 0.11f), BLUE, 0.05f)
                    else -> blendSurfaceColor(SURFACE2, RED, 0.12f)
                }
                val bar = View(this).apply {
                    val barRadius = when (id) {
                        "glass", "soft", "aurora" -> 10
                        "minimal", "arena" -> 3
                        "professional" -> 5
                        else -> 7
                    }
                    background = roundedBackground(if (index == 0) tileFill else blendSurfaceColor(tileFill, PURPLE, index * 0.04f),
                        barRadius, blendSurfaceColor(RED, MUTED, 0.25f), if (id == "aurora" || id == "arena") 2 else 1)
                    layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, if (index == 0) 25 else 20), 1f).apply {
                        marginEnd = if (index < 2) dp(this@MainActivity, 5) else 0
                    }
                }
                preview.addView(bar)
            }
            choice.addView(preview)
            choice.addView(txt((if (isSelected) "✓  " else "") + title, 10f, if (isSelected) RED else TEXT, bold=true, bot=4))
            choice.addView(txt(subtitle, 9f, TEXT2))
            layout.addView(choice)
        }

        layout.addView(txt("SO RESELLER", 10f, RED, bold=true, ls=0.12f, top=24, bot=5))
        val resellerCard = ll().apply {
            setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 13), dp(this@MainActivity, 14), dp(this@MainActivity, 13))
            background = roundedBackground(SURFACE, 16, Color.parseColor("#433365"), 1)
        }
        resellerCard.addView(txt("Precios especiales para Game Market", 14f, TEXT, bold=true, bot=4))
        val resellerState = prefs.getString(PREF_RESELLER_STATUS_LAST_SEEN, "not_reseller").orEmpty()
        resellerCard.addView(txt(resellerStatusLabel(resellerState), 10f, if (resellerState == "active") GREEN else TEXT2, bot=9))
        resellerCard.addView(txt("Solicitud con KYC y revisión manual. Plazo de respuesta orientativo: 24–48 horas. Depósito de trabajo de 50.000 CUP solo después de aprobar el KYC; no es una comisión. Los retiros todavía no están disponibles.", 10f, TEXT2, bot=9))
        resellerCard.addView(btn(if (resellerState in setOf("pending_review", "changes_requested", "approved_awaiting_deposit", "active", "suspended")) "CONSULTAR ESTADO" else "CONOCER REQUISITOS Y SOLICITAR").apply {
            textSize = 9f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 10, RED, 0)
            setOnClickListener { if (resellerState in setOf("pending_review", "changes_requested", "approved_awaiting_deposit", "active", "suspended")) showResellerStatus() else showResellerIntro() }
        })
        if (prefs.getString("client_role", "client").equals("admin", true)) {
            resellerCard.addView(btn("REVISAR SOLICITUDES Y FOTOS KYC").apply {
                textSize = 9f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, PURPLE, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { topMargin = dp(this@MainActivity, 7) }
                setOnClickListener { showAdminResellerApplications() }
            })
        }
        layout.addView(resellerCard)

        layout.addView(txt("FUNCIONAMIENTO EN SEGUNDO PLANO", 10f, RED, bold=true, ls=0.10f, top=16, bot=4))
        layout.addView(txt("Para que los SMS se guarden con la pantalla apagada, abre los ajustes de SynthesisOne y elige Batería → Sin restricciones. En Xiaomi/Redmi, habilita también Inicio automático.", 11f, TEXT2, bot=8))
        val backgroundSettingsBtn = btn("AJUSTES DE BATERÍA").apply {
            textSize = 10f
            setTextColor(TEXT); background = roundedBackground(SURFACE2, 10, RED, 1)
            setOnClickListener {
                val settingsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = android.net.Uri.parse("package:$packageName")
                }
                runCatching { startActivity(settingsIntent) }.onFailure {
                    showSoToast("Abre Ajustes → Aplicaciones → SynthesisOne → Batería", Toast.LENGTH_LONG)
                }
            }
        }
        layout.addView(backgroundSettingsBtn)

        layout.addView(txt("PRIVACIDAD Y SEGURIDAD", 10f, RED, bold=true, ls=0.10f, top=22, bot=5))
        val privacyRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10)); background = roundedBackground(SURFACE2, 14, SURFACE2, 1) }
        val privacyInfo = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        privacyInfo.addView(txt("Ocultar números sensibles", 12f, TEXT, bold=true, bot=3))
        privacyInfo.addView(txt("Enmascara teléfonos en listas e historial", 10f, TEXT2))
        val privacySwitch = Switch(this).apply { isChecked = prefs.getBoolean(PREF_HIDE_SENSITIVE, false); setOnCheckedChangeListener { _, checked -> prefs.edit().putBoolean(PREF_HIDE_SENSITIVE, checked).apply() } }
        privacyRow.addView(privacyInfo); privacyRow.addView(privacySwitch); layout.addView(privacyRow)

        val assistantRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10))
            background = roundedBackground(SURFACE2, 14, SURFACE2, 1)
        }
        val assistantInfo = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        assistantInfo.addView(txt("SO Assistant flotante", 12f, TEXT, bold=true, bot=3))
        assistantInfo.addView(txt("Muestra u oculta el acceso rápido. Las advertencias de seguridad de pagos seguirán apareciendo cuando sean necesarias.", 10f, TEXT2))
        val assistantSwitch = Switch(this).apply {
            isChecked = prefs.getBoolean(PREF_SO_ASSISTANT_FLOATING, true)
            setOnCheckedChangeListener { _, enabled ->
                prefs.edit().putBoolean(PREF_SO_ASSISTANT_FLOATING, enabled).apply()
                if (enabled) installAssistantFloatingLauncher() else {
                    (assistantLauncherView?.parent as? ViewGroup)?.removeView(assistantLauncherView)
                    assistantLauncherView = null
                }
            }
        }
        assistantRow.addView(assistantInfo)
        assistantRow.addView(assistantSwitch)
        val assistantRowParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 8) }
        layout.addView(assistantRow, assistantRowParams)

        val spontaneousRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10))
            background = roundedBackground(SURFACE2, 14, SURFACE2, 1)
        }
        val spontaneousInfo = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        spontaneousInfo.addView(txt("Personalidad espontánea", 12f, TEXT, bold = true, bot = 3))
        spontaneousInfo.addView(txt("Puede generar un saludo u ocurrencia breve como máximo una vez al día. Usa una consulta si hay cuota; si no, muestra una frase local. Puedes desactivarlo.", 10f, TEXT2))
        val spontaneousSwitch = Switch(this).apply {
            isChecked = prefs.getBoolean(PREF_SO_ASSISTANT_SPONTANEOUS, true)
            setOnCheckedChangeListener { _, enabled ->
                prefs.edit().putBoolean(PREF_SO_ASSISTANT_SPONTANEOUS, enabled).apply()
                if (enabled && assistantDashboardSection == "home") scheduleAssistantSpontaneousPresence()
                else {
                    assistantSpontaneousRunnable?.let { handler.removeCallbacks(it) }
                    assistantSpontaneousRunnable = null
                }
            }
        }
        spontaneousRow.addView(spontaneousInfo)
        spontaneousRow.addView(spontaneousSwitch)
        layout.addView(spontaneousRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 8) })

        val lockRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10)); background = roundedBackground(SURFACE2, 14, SURFACE2, 1) }
        val lockInfo = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        lockInfo.addView(txt("Bloqueo local de la app", 12f, TEXT, bold=true, bot=3))
        lockInfo.addView(txt("Solicita el bloqueo del teléfono al volver a SynthesisOne", 10f, TEXT2))
        val lockSwitch = Switch(this).apply { isChecked = prefs.getBoolean(PREF_APP_LOCK, false) }
        installAppLockListener(lockSwitch)
        lockRow.addView(lockInfo); lockRow.addView(lockSwitch); layout.addView(space(7)); layout.addView(lockRow)

        val card1 = prefs.getString("card1","")?.split("-") ?: listOf("","")
        val card2 = prefs.getString("card2","")?.split("-") ?: listOf("","")
        val card3 = prefs.getString("card3","")?.split("-") ?: listOf("","")

        layout.addView(lbl("TARJETA 1"))
        val c1a = inp("Primeros 4", maxLen=4, numeric=true).apply { setText(card1.getOrNull(0)?:"") }
        val c1b = inp("Últimos 4", maxLen=4, numeric=true).apply { setText(card1.getOrNull(1)?:"") }
        layout.addView(row2(c1a, c1b))

        layout.addView(lbl("TARJETA 2 (opcional)", top=16))
        val c2a = inp("Primeros 4", maxLen=4, numeric=true).apply { setText(card2.getOrNull(0)?:"") }
        val c2b = inp("Últimos 4", maxLen=4, numeric=true).apply { setText(card2.getOrNull(1)?:"") }
        layout.addView(row2(c2a, c2b))

        layout.addView(lbl("TARJETA 3 (opcional)", top=16))
        val c3a = inp("Primeros 4", maxLen=4, numeric=true).apply { setText(card3.getOrNull(0)?:"") }
        val c3b = inp("Últimos 4", maxLen=4, numeric=true).apply { setText(card3.getOrNull(1)?:"") }
        layout.addView(row2(c3a, c3b))

        layout.addView(lbl("NÚMERO DE MONEDERO", top=24))
        val walletIn = inp("Ej: 5359190241", maxLen=10, numeric=true).apply { setText(prefs.getString("wallet","")) }
        layout.addView(walletIn)

        layout.addView(lbl("TELÉFONO DEL TITULAR", top=24))
        val phoneIn = inp("Ej: 5XXXXXXXX", maxLen=11, numeric=true).apply { setText(prefs.getString("phone_number","")) }
        layout.addView(phoneIn)

        val statusMsg = txt("", 13f, GREEN)
        layout.addView(statusMsg)
        val saveBtn = btn("GUARDAR CAMBIOS")
        layout.addView(space(16)); layout.addView(saveBtn)

        saveBtn.setOnClickListener {
            if (c1a.text.length!=4 || c1b.text.length!=4) { statusMsg.setTextColor(ERR); statusMsg.text="⚠️ Tarjeta 1 obligatoria (4+4 dígitos)"; return@setOnClickListener }
            val phone = normalizeClientPhone(phoneIn.text.toString().trim())
            if (!isValidPhone(phone)) { statusMsg.setTextColor(ERR); statusMsg.text="⚠️ Introduce un número móvil válido"; return@setOnClickListener }

            val card1 = "${c1a.text}-${c1b.text}"
            val card2 = if (c2a.text.length==4 && c2b.text.length==4) "${c2a.text}-${c2b.text}" else ""
            val card3 = if (c3a.text.length==4 && c3b.text.length==4) "${c3a.text}-${c3b.text}" else ""
            val wallet = walletIn.text.toString().trim()
            val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()

            saveBtn.isEnabled = false
            saveBtn.text = if (token.isBlank()) "GUARDANDO..." else "SINCRONIZANDO..."
            statusMsg.setTextColor(MUTED)
            statusMsg.text = if (token.isBlank()) "Guardando configuración local..." else "Actualizando tus datos en el servidor..."

            uiScope.launch {
                val remoteResult = if (token.isBlank()) {
                    ProfileSaveResult(true)
                } else {
                    withContext(Dispatchers.IO) {
                        saveClientProfile(token, phone, card1, card2, card3, wallet)
                    }
                }

                if (remoteResult.ok) {
                    prefs.edit().apply {
                        putString("card1", card1)
                        if (card2.isNotBlank()) putString("card2", card2) else remove("card2")
                        if (card3.isNotBlank()) putString("card3", card3) else remove("card3")
                        putString("wallet", wallet)
                        putString("phone_number", phone)
                    }.apply()
                    saveBtn.isEnabled = true
                    saveBtn.text = "GUARDAR CAMBIOS"
                    statusMsg.setTextColor(GREEN)
                    statusMsg.text = if (token.isBlank())
                        "✅ Guardado correctamente"
                    else
                        "✅ Guardado y actualizado en el servidor"
                } else {
                    saveBtn.isEnabled = true
                    saveBtn.text = "GUARDAR CAMBIOS"
                    statusMsg.setTextColor(ERR)
                    statusMsg.text = remoteResult.error ?: "❌ No se pudo actualizar el servidor"
                }
            }
        }

        scroll.addView(layout); rootFrame.addView(scroll)
        if (guideToReseller) {
            scroll.post {
                if (!isFinishing && !isDestroyed && resellerCard.isAttachedToWindow) {
                    scroll.smoothScrollTo(0, (resellerCard.top - dp(this@MainActivity, 82)).coerceAtLeast(0))
                    pulseAssistantGuideTarget(resellerCard)
                    showAssistantProactiveAlert(
                        "SO Assistant · Paso 2 de 2",
                        "Aquí está SO Reseller. Revisa los requisitos y pulsa «Conocer requisitos y solicitar» para comenzar.",
                        showWhatsApp = false
                    )
                }
            }
        }
        refreshRemoteProfileCache()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SMS TAB
    // ══════════════════════════════════════════════════════════════════════════
    private fun buildSmsSection(container: LinearLayout) {
        val titleRow = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL }
        val title = txt("Registro de actividad", 18f, TEXT, bold=true)
        title.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        titleRow.addView(title)
        val live = txt("● EN VIVO", 9f, GREEN, bold=true, ls=0.08f).apply {
            setPadding(dp(this@MainActivity,7), dp(this@MainActivity,4), dp(this@MainActivity,7), dp(this@MainActivity,4))
            background = pillBackground(GREEN, 22)
        }
        titleRow.addView(live)
        container.addView(titleRow)
        container.addView(txt("Toca un movimiento para abrir todos sus detalles.", 11f, MUTED, top=4, bot=12))

        val scroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            clipToPadding = false
        }
        val filterRow = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        val filters = listOf(
            "ALL" to "TODOS", "RECEIVED" to "ENTRANTES", "SENT" to "SALIENTES", "QUEUED" to "PENDIENTES", "ERROR" to "ERRORES"
        )
        val views = mutableMapOf<String, TextView>()
        filters.forEachIndexed { index, pair ->
            val v = chip(pair.second, pair.first == currentFilter).apply {
                setOnClickListener {
                    currentFilter = pair.first
                    views.forEach { (_, t) -> styleChip(t, t === this) }
                    refreshSms()
                }
            }
            views[pair.first] = v
            filterRow.addView(v)
            if (index < filters.lastIndex) filterRow.addView(space(8, horiz=true))
        }
        scroll.addView(filterRow)
        container.addView(scroll)
        smsCountLabel = txt("", 11f, TEXT2, top=12, bot=10)
        smsList = ll()
        container.addView(smsCountLabel)
        container.addView(smsList)
    }

    private fun styleChip(view: TextView, active: Boolean) {
        view.background = if (active) roundedBackground(RED, 20, RED, 0) else roundedBackground(Color.TRANSPARENT, 20, MUTED, 1)
        view.setTextColor(if (active) Color.WHITE else TEXT2)
    }

    private fun setFilter(f: String, active: TextView, vararg inactive: TextView) {
        currentFilter = f
        styleChip(active, true)
        inactive.forEach { styleChip(it, false) }
        refreshSms()
    }

    private fun refreshSms() {
        if (smsRefreshInFlight) {
            smsRefreshQueued = true
            return
        }
        smsRefreshInFlight = true
        uiScope.launch {
            try {
                val items = withContext(Dispatchers.IO) {
                    val end = System.currentTimeMillis()
                    val start = end - 30L * 24 * 60 * 60 * 1000
                    AppDatabase.getInstance(this@MainActivity).smsDao().getRange(start, end)
                }
                if (!::smsList.isInitialized || !smsList.isAttachedToWindow || !::smsCountLabel.isInitialized || !smsCountLabel.isAttachedToWindow) return@launch
                val filtered = when (currentFilter) {
                    "RECEIVED" -> items.filter { mergedSmsParse(it).direction == "RECIBIDO" }
                    "SENT"     -> items.filter { mergedSmsParse(it).direction == "ENVIADO" }
                    "QUEUED"   -> items.filter { it.status.equals("QUEUED", true) }
                    "ERROR"    -> items.filter { it.status.equals("ERROR", true) }
                    else       -> items
                }
                // Do not silently omit the transaction the user is trying to find after item 80.
                // The DAO already scopes this view to the latest 30 days and orders newest first.
                val visibleItems = filtered
                smsCountLabel.text = "${filtered.size} eventos · últimos 30 días"
                // No destruir/recrear todas las tarjetas cada 3 segundos: esto causaba
                // parpadeos y parecía que la pantalla se quedaba en blanco.
                val signature = visibleItems.joinToString("|") {
                    val parsed = mergedSmsParse(it)
                    "${it.id}:${it.status}:${it.attempts}:${it.lastError.orEmpty()}:${parsed.direction}:${parsed.category}:${parsed.amount}:${parsed.network}:${parsed.transactionId}:${it.receivedAt}"
                }
                if (signature != lastRenderedSmsSignature) {
                    lastRenderedSmsSignature = signature
                    renderSmsList(visibleItems)
                }
            } catch (e: Exception) {
                android.util.Log.e("SynthesisOne_UI", "No se pudo actualizar el historial de SMS", e)
                if (::smsCountLabel.isInitialized && smsCountLabel.isAttachedToWindow) {
                    smsCountLabel.text = "Historial temporalmente no disponible · reintentando"
                }
            } finally {
                smsRefreshInFlight = false
                if (smsRefreshQueued) {
                    smsRefreshQueued = false
                    handler.post { refreshSms() }
                }
            }
        }
    }

    private fun renderSmsList(items: List<SmsEntity>) {
        smsList.removeAllViews()
        if (items.isEmpty()) {
            val empty = ll().apply { setPadding(0,dp(this@MainActivity,28),0,dp(this@MainActivity,28)); gravity=Gravity.CENTER }
            empty.addView(txt("◌", 28f, MUTED).apply { gravity=Gravity.CENTER })
            empty.addView(txt("Nada por aquí todavía", 14f, TEXT, bold=true, top=6).apply { gravity=Gravity.CENTER })
            empty.addView(txt("Cuando llegue un SMS compatible aparecerá aquí.", 11f, MUTED, top=3).apply { gravity=Gravity.CENTER })
            smsList.addView(empty)
            return
        }
        val fmt = SimpleDateFormat("dd/MM · HH:mm", Locale.getDefault())
        items.forEachIndexed { index, sms ->
            val v = smsCard(sms, fmt)
            smsList.addView(v)
            animateIn(v, index * 18L)
            if (index < items.lastIndex) smsList.addView(space(8))
        }
    }

    private fun smsCard(sms: SmsEntity, fmt: SimpleDateFormat): View {
        val parsed = mergedSmsParse(sms)
        val incoming = parsed.direction == "RECIBIDO"
        val accentColor = when {
            sms.status.equals("ERROR", true) -> ERR
            incoming -> GREEN
            else -> PURPLE
        }
        val card = ll().apply {
            setPadding(dp(this@MainActivity,15),dp(this@MainActivity,13),dp(this@MainActivity,15),dp(this@MainActivity,13))
            background = roundedBackground(SURFACE2, 14, Color.TRANSPARENT, 0)
            elevation = dp(this@MainActivity,2).toFloat()
            setOnClickListener { showSmsDetails(sms, parsed) }
        }
        val head = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL }
        val bubble = TextView(this).apply {
            text = if (incoming) "↓" else if (parsed.direction == "ENVIADO") "↑" else "•"
            textSize=16f; setTextColor(accentColor); gravity=Gravity.CENTER
            background = roundedBackground(Color.argb(34, Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor)), 12, Color.TRANSPARENT, 0)
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity,38), dp(this@MainActivity,38)).apply { marginEnd=dp(this@MainActivity,11) }
        }
        val info = ll().apply { layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f) }
        info.addView(txt(parsed.type.replace("_"," · ").ifBlank { sms.sender }, 12f, TEXT, bold=true, bot=2))
        val counterparty = parsed.senderPhone?.takeIf { it.isNotBlank() } ?: sms.sender
        info.addView(txt(visibleIdentifier(counterparty), 10f, TEXT2, bot=2))
        info.addView(txt(fmt.format(Date(sms.receivedAt)), 9f, MUTED))
        head.addView(bubble); head.addView(info)
        if (parsed.amount != null) {
            head.addView(txt((if(incoming) "+ " else "− ") + "%.2f ${parsed.currency ?: "CUP"}".format(parsed.amount), 13f, accentColor, bold=true))
        }
        card.addView(head)
        val meta = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL; setPadding(dp(this@MainActivity,49), dp(this@MainActivity,6), 0, 0) }
        meta.addView(txt(parsed.network.orEmpty(), 9f, BLUE, bold=true))
        meta.addView(space(7, horiz=true))
        meta.addView(txt(sms.status.uppercase(Locale.getDefault()), 9f, accentColor, bold=true))
        meta.addView(space(7, horiz=true))
        meta.addView(txt("DETALLE ›", 9f, MUTED, bold=true))
        card.addView(meta)
        return card
    }

    private fun showSmsDetails(sms: SmsEntity, p: SmsParser.ParsedSms) {
        val incoming = p.direction == "RECIBIDO"
        val amount = p.amount?.let { "${if (incoming) "+" else "−"} %.2f ${p.currency ?: "CUP"}".format(it) } ?: "—"
        val detail = buildString {
            append("Importe: $amount\n")
            append("Dirección: ${p.direction ?: "—"}\n")
            append("Red: ${p.network ?: "—"}\n")
            append("Tipo: ${p.type ?: "—"}\n")
            append("Remitente: ${p.senderPhone ?: sms.sender}\n")
            append("Destinatario: ${p.receiverPhone ?: "—"}\n")
            append("Cuenta: ${p.receiverAccount ?: "—"}\n")
            append("Operación: ${p.transactionId ?: "—"}\n")
            append("Fecha SMS: ${formatDateTime(sms.receivedAt)}\n")
            append("Estado de sincronización: ${sms.status}\n")
            append("Intentos de envío: ${sms.attempts}\n")
            append("Último envío: ${sms.sentAt?.let { formatDateTime(it) } ?: "—"}\n")
            sms.lastError?.let { append("Último error: $it\n") }
            p.transactionAt?.let { append("Fecha operación: ${formatDateTime(it)}\n") }
            p.note?.let { append("Nota: $it\n") }
            append("\nMensaje original:\n${sms.body}")
        }
        ThemedAlertDialogBuilder(this)
            .setTitle("Detalle del movimiento")
            .setMessage(detail)
            .setPositiveButton("Cerrar", null)
            .show()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GESTIÓN ECONÓMICA
    // ══════════════════════════════════════════════════════════════════════════
    private fun refreshEcon() {
        uiScope.launch {
            val stats = withContext(Dispatchers.IO) { loadManagementStats() }
            renderEcon(stats)
        }
    }

    private fun periodRange(period: String): Pair<Long, Long> {
        val now = System.currentTimeMillis()
        val end = now + 1L
        val cal = Calendar.getInstance()
        cal.timeInMillis = now
        when (period) {
            "TODAY" -> {
                cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            }
            "WEEK" -> {
                cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0); cal.add(Calendar.DAY_OF_YEAR, -6)
            }
            else -> {
                cal.set(Calendar.DAY_OF_MONTH, 1); cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
            }
        }
        return cal.timeInMillis to end
    }

    private fun loadManagementStats(): ManagementStats {
        val (from, to) = periodRange(managementPeriod)
        val items = AppDatabase.getInstance(this@MainActivity).smsDao().getRange(from, to)
        val counterparties = linkedMapOf<String, CounterpartyStat>()
        var totalIn=0.0; var totalOut=0.0; var countIn=0; var countOut=0
        var transfersIn=0.0; var transfersOut=0.0; var transferCountIn=0; var transferCountOut=0
        val history = mutableListOf<Pair<SmsEntity, SmsParser.ParsedSms>>()

        items.sortedByDescending { it.receivedAt }.forEach { sms ->
            val p = mergedSmsParse(sms, sms.receivedAt)
            val amount = p.amount ?: return@forEach
            if (!amount.isFinite() || amount <= 0.0) return@forEach
            val isTransfer = p.category == "TRANSFERENCIA"
            val isMobile = p.category == "SALDO_MOVIL" || p.network == "CUBACEL"
            if (managementType == "TRANSFER" && !isTransfer) return@forEach
            if (managementType == "MOBILE" && !isMobile) return@forEach
            if (managementDirection == "IN" && p.direction != "RECIBIDO") return@forEach
            if (managementDirection == "OUT" && p.direction != "ENVIADO") return@forEach

            history.add(sms to p)
            when (p.direction) {
                "RECIBIDO" -> {
                    totalIn += amount; countIn++
                    if (isTransfer) { transfersIn += amount; transferCountIn++ }
                }
                "ENVIADO" -> {
                    totalOut += amount; countOut++
                    if (isTransfer) { transfersOut += amount; transferCountOut++ }
                }
            }

            if (isTransfer) {
                val shouldTrackPerson = if (managementDirection == "OUT") p.direction == "ENVIADO" else p.direction == "RECIBIDO"
                if (shouldTrackPerson) {
                    val person = if (p.direction == "RECIBIDO") p.senderPhone else p.receiverPhone
                    val key = person?.takeIf { it.isNotBlank() } ?: "DESCONOCIDO"
                    val current = counterparties[key]
                    counterparties[key] = CounterpartyStat(key, (current?.amount ?: 0.0) + amount, (current?.count ?: 0) + 1)
                }
            }
        }
        val list = counterparties.values.sortedWith(compareByDescending<CounterpartyStat> { it.amount }.thenByDescending { it.count }).take(12)
        return ManagementStats(from,to,totalIn,totalOut,countIn,countOut,transfersIn,transfersOut,transferCountIn,transferCountOut,list.size,list,history)
    }

    private fun renderEcon(stats: ManagementStats) {
        econContainer.removeAllViews()
        val periodTitle = when(managementPeriod) { "TODAY" -> "HOY"; "WEEK" -> "ÚLTIMOS 7 DÍAS"; else -> "ESTE MES" }

        val hero = ll().apply {
            setPadding(dp(this@MainActivity,18),dp(this@MainActivity,18),dp(this@MainActivity,18),dp(this@MainActivity,18))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                if (isLightPalette()) intArrayOf(SURFACE, SURFACE2) else intArrayOf(SURFACE2, BG)).apply {
                cornerRadius = dp(this@MainActivity, if (selectedLayoutStyle() == "minimal") 14 else 18).toFloat()
                setStroke(dp(this@MainActivity, 1), blendSurfaceColor(RED, MUTED, 0.32f))
            }
            elevation = dp(this@MainActivity,3).toFloat()
        }
        val heroTop = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL }
        val titleBlock = ll().apply { layoutParams = LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f) }
        titleBlock.addView(txt("GESTIÓN", 10f, RED, bold=true, ls=0.14f))
        titleBlock.addView(txt(periodTitle, 21f, TEXT, bold=true, top=4, bot=2))
        titleBlock.addView(txt("Control visual del flujo de dinero", 10f, MUTED))
        heroTop.addView(titleBlock)
        val netColor = if (stats.net >= 0) GREEN else ERR
        val netChip = txt((if(stats.net >= 0) "+" else "−") + " %.2f".format(Math.abs(stats.net)), 11f, netColor, bold=true).apply {
            setPadding(dp(this@MainActivity,9),dp(this@MainActivity,6),dp(this@MainActivity,9),dp(this@MainActivity,6))
            background = pillBackground(netColor, 26)
        }
        heroTop.addView(netChip)
        hero.addView(heroTop)

        val periodScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled=false; setPadding(0,dp(this@MainActivity,14),0,0) }
        val periodRow = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        listOf("TODAY" to "HOY", "WEEK" to "7 DÍAS", "MONTH" to "MES").forEachIndexed { i, pair ->
            val chip = chip(pair.second, pair.first == managementPeriod).apply {
                setOnClickListener { managementPeriod = pair.first; refreshEcon() }
            }
            periodRow.addView(chip); if(i<2) periodRow.addView(space(8,horiz=true))
        }
        periodScroll.addView(periodRow); hero.addView(periodScroll)
        econContainer.addView(hero)
        animateIn(hero, 0)
        val exportBtn = btn("↓  EXPORTAR MOVIMIENTOS · CSV").apply {
            textSize = 10f; setPadding(dp(this@MainActivity,10), dp(this@MainActivity,7), dp(this@MainActivity,10), dp(this@MainActivity,7))
            setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, RED, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity,42)).apply { topMargin = dp(this@MainActivity,9) }
            setOnClickListener { exportManagementCsv() }
        }
        econContainer.addView(exportBtn)

        val directionScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled=false; setPadding(0,dp(this@MainActivity,14),0,dp(this@MainActivity,4)) }
        val directionRow = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        listOf("ALL" to "Todo", "IN" to "Entrante", "OUT" to "Saliente").forEachIndexed { i, pair ->
            val c = chip(pair.second, pair.first == managementDirection).apply { setOnClickListener { managementDirection=pair.first; refreshEcon() } }
            directionRow.addView(c); if(i<2) directionRow.addView(space(8,horiz=true))
        }
        directionScroll.addView(directionRow); econContainer.addView(directionScroll)

        val typeScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled=false; setPadding(0,dp(this@MainActivity,2),0,dp(this@MainActivity,10)) }
        val typeRow = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL }
        listOf("ALL" to "Todo", "TRANSFER" to "Transferencias", "MOBILE" to "Saldo móvil").forEachIndexed { i, pair ->
            val c = chip(pair.second, pair.first == managementType).apply { setOnClickListener { managementType=pair.first; refreshEcon() } }
            typeRow.addView(c); if(i<2) typeRow.addView(space(8,horiz=true))
        }
        typeScroll.addView(typeRow); econContainer.addView(typeScroll)

        val chartCard = ll().apply {
            setPadding(dp(this@MainActivity,16),dp(this@MainActivity,16),dp(this@MainActivity,16),dp(this@MainActivity,14))
            background = roundedBackground(SURFACE, 18, Color.TRANSPARENT, 0)
            elevation = dp(this@MainActivity,2).toFloat()
        }
        chartCard.addView(txt("FLUJO", 9f, MUTED, bold=true, ls=0.12f, bot=4))
        val donut = PaymentDonutView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity,210))
            setStats(stats.totalIn, stats.totalOut, stats.net)
        }
        chartCard.addView(donut)
        val legend = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER }
        legend.addView(legendItem("ENTRANTE", GREEN, "%.2f CUP".format(stats.totalIn)))
        legend.addView(space(16,horiz=true))
        legend.addView(legendItem("SALIENTE", PURPLE, "%.2f CUP".format(stats.totalOut)))
        chartCard.addView(legend)
        econContainer.addView(chartCard)
        animateIn(chartCard, 80)

        val metrics = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; setPadding(0,dp(this@MainActivity,12),0,dp(this@MainActivity,4)) }
        val m1=managementMetric("OPERACIONES","${stats.operationCount}", BLUE); val m2=managementMetric("ENTRADAS","+ %.2f".format(stats.totalIn), GREEN)
        val m3=managementMetric("SALIDAS","− %.2f".format(stats.totalOut), PURPLE); val m4=managementMetric("PERSONAS","${stats.uniqueCounterparties}", RED)
        listOf(m1,m2,m3,m4).forEachIndexed { i,v -> v.layoutParams=LinearLayout.LayoutParams(0,dp(this@MainActivity,82),1f).apply { marginEnd=if(i%2==0) dp(this@MainActivity,7) else 0; topMargin=if(i>=2) dp(this@MainActivity,7) else 0 }; if(i==2) { /* next row */ } }
        // Render as two rows to keep this compact.
        val row1=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL}; val row2=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL}
        row1.addView(m1); row1.addView(m2); row2.addView(m3); row2.addView(m4)
        metrics.addView(LinearLayout(this).apply{orientation=LinearLayout.VERTICAL; addView(row1); addView(row2)})
        econContainer.addView(metrics)

        val peopleHeader = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL; setPadding(0,dp(this@MainActivity,10),0,dp(this@MainActivity,8)) }
        val peopleTitle=txt(if(managementDirection=="OUT") "DESTINATARIOS" else "QUIÉNES TE TRANSFIEREN", 10f, TEXT2, bold=true, ls=0.08f)
        peopleTitle.layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f)
        peopleHeader.addView(peopleTitle); peopleHeader.addView(txt("${stats.uniqueCounterparties} detectados",9f,MUTED))
        econContainer.addView(peopleHeader)
        if(stats.counterparties.isEmpty()) econContainer.addView(txt("No hay transferencias identificables en este periodo.",12f,MUTED,bot=12))
        else stats.counterparties.forEachIndexed { idx, c ->
            val row=counterpartyRow(idx+1,c,managementDirection=="OUT")
            econContainer.addView(row); econContainer.addView(space(7))
            animateIn(row, 130L + idx*20L)
        }

        val historyHeader = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL; setPadding(0,dp(this@MainActivity,14),0,dp(this@MainActivity,7)) }
        val histTitle=txt("HISTORIAL", 10f, TEXT2, bold=true, ls=0.08f)
        histTitle.layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f)
        historyHeader.addView(histTitle)
        val toggle=txt(if(managementHistoryExpanded) "OCULTAR ↑" else "VER TODO ↓", 9f, RED, bold=true).apply { setOnClickListener { managementHistoryExpanded=!managementHistoryExpanded; refreshEcon() } }
        historyHeader.addView(toggle); econContainer.addView(historyHeader)

        if(stats.history.isEmpty()) {
            econContainer.addView(txt("Sin operaciones en el periodo elegido.",12f,MUTED,bot=12))
        } else {
            val shown=if(managementHistoryExpanded) stats.history else stats.history.take(6)
            val fmt=SimpleDateFormat("dd/MM · HH:mm", Locale.getDefault())
            shown.forEachIndexed { idx, pair ->
                val row=txRowCompact(pair.first,pair.second,fmt)
                econContainer.addView(row)
                if(idx<shown.lastIndex) econContainer.addView(space(7))
            }
            if(!managementHistoryExpanded && stats.history.size>shown.size) {
                val more=txt("+ ${stats.history.size-shown.size} movimientos · toca VER TODO",11f,RED,bold=true,top=9,bot=8).apply { gravity=Gravity.CENTER; setOnClickListener { managementHistoryExpanded=true; refreshEcon() } }
                econContainer.addView(more)
            }
        }
    }

    private fun exportManagementCsv() {
        uiScope.launch {
            try {
                val (from, to) = periodRange(managementPeriod)
                val items = withContext(Dispatchers.IO) { AppDatabase.getInstance(this@MainActivity).smsDao().getRange(from, to).sortedByDescending { it.receivedAt } }
                val lines = ArrayList<String>(items.size + 1)
                lines.add(listOf("fecha", "remitente", "direccion", "tipo", "red", "importe", "moneda", "telefono_origen", "telefono_destino", "cuenta_destino", "id_operacion", "estado_sync", "intentos", "ultimo_envio", "ultimo_error", "sms_original").joinToString(";") { csvCell(it) })
                items.forEach { item ->
                    val p = SmsParser.parse(item.body, item.receivedAt)
                    val values = listOf(
                        formatDateTime(item.receivedAt), item.sender, p.direction.orEmpty(), p.type, p.network.orEmpty(),
                        p.amount?.let { String.format(Locale.US, "%.2f", it) }.orEmpty(), p.currency.orEmpty(), p.senderPhone.orEmpty(),
                        p.receiverPhone.orEmpty(), p.receiverAccount.orEmpty(), p.transactionId.orEmpty(), item.status,
                        item.attempts.toString(), item.sentAt?.let { formatDateTime(it) }.orEmpty(), item.lastError.orEmpty(), item.body
                    )
                    lines.add(values.joinToString(";") { csvCell(it) })
                }
                pendingCsvContent = "\uFEFF" + lines.joinToString("\r\n")
                val stamp = SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(Date())
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "text/csv"
                    putExtra(Intent.EXTRA_TITLE, "SynthesisOne_movimientos_${managementPeriod.lowercase(Locale.ROOT)}_$stamp.csv")
                }
                startActivityForResult(intent, REQUEST_EXPORT_CSV)
            } catch (error: Exception) {
                showSoToast("No se pudo preparar la exportación: ${error.message}", Toast.LENGTH_LONG)
            }
        }
    }

    private fun csvCell(value: String): String = "\"" + value.replace("\"", "\"\"").replace("\r", " ").replace("\n", " ") + "\""

    private fun legendItem(label:String, color:Int, value:String):View {
        val box=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER_HORIZONTAL}
        val l=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER}
        l.addView(View(this).apply{layoutParams=LinearLayout.LayoutParams(dp(this@MainActivity,7),dp(this@MainActivity,7)).apply{marginEnd=dp(this@MainActivity,5)};background=GradientDrawable().apply{shape=GradientDrawable.OVAL;setColor(color)}})
        l.addView(txt(label,9f,MUTED,bold=true,ls=0.07f))
        box.addView(l); box.addView(txt(value,11f,TEXT,bold=true,top=3))
        return box
    }

    private fun managementMetric(label:String,value:String,color:Int):View{
        val v=ll().apply{setPadding(dp(this@MainActivity,12),dp(this@MainActivity,11),dp(this@MainActivity,12),dp(this@MainActivity,11));background=roundedBackground(Color.argb(24,Color.red(color),Color.green(color),Color.blue(color)),14,color,1);elevation=dp(this@MainActivity,1).toFloat()}
        v.addView(txt(label,8.5f,MUTED,bold=true,ls=0.06f,bot=5));v.addView(txt(value,13f,color,bold=true));return v
    }

    private fun counterpartyRow(rank:Int, c:CounterpartyStat,outgoing:Boolean):View{
        val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(this@MainActivity,12),dp(this@MainActivity,11),dp(this@MainActivity,12),dp(this@MainActivity,11));background=roundedBackground(SURFACE2,14,Color.TRANSPARENT,0);elevation=dp(this@MainActivity,1).toFloat()}
        row.addView(txt(String.format(Locale.getDefault(),"%02d",rank),10f,RED,bold=true,bot=0))
        val info=ll().apply{layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f);setPadding(dp(this@MainActivity,11),0,0,0)}
        info.addView(txt(visibleIdentifier(c.phone),12f,TEXT,bold=true,bot=3))
        info.addView(txt("${c.count} transferencia(s) · %.2f CUP".format(c.amount),10f,TEXT2))
        row.addView(info)
        row.addView(txt(if(outgoing) "↑" else "↓",16f,if(outgoing) PURPLE else GREEN,bold=true))
        row.setOnClickListener{ showCounterpartyDetails(c,outgoing) }
        return row
    }

    private fun showCounterpartyDetails(c:CounterpartyStat,outgoing:Boolean){
        ThemedAlertDialogBuilder(this).setTitle(c.phone).setMessage(
            (if(outgoing) "Destinatario" else "Remitente") + "\n\n" +
            "Operaciones: ${c.count}\n" +
            "Volumen del periodo: %.2f CUP\n\n".format(c.amount) +
            "El total respeta los filtros de periodo, dirección y tipo seleccionados."
        ).setPositiveButton("Cerrar",null).show()
    }

    private fun txRowCompact(sms:SmsEntity,p:SmsParser.ParsedSms,fmt:SimpleDateFormat):View{
        val incoming=p.direction=="RECIBIDO"
        val color=if(incoming) GREEN else PURPLE
        val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(this@MainActivity,12),dp(this@MainActivity,11),dp(this@MainActivity,12),dp(this@MainActivity,11));background=roundedBackground(SURFACE,14,Color.TRANSPARENT,0);setOnClickListener{showSmsDetails(sms,p)}}
        val dot=TextView(this).apply{text=if(incoming) "↓" else "↑";textSize=15f;setTextColor(color);gravity=Gravity.CENTER;background=roundedBackground(Color.argb(28,Color.red(color),Color.green(color),Color.blue(color)),11,Color.TRANSPARENT,0);layoutParams=LinearLayout.LayoutParams(dp(this@MainActivity,34),dp(this@MainActivity,34)).apply{marginEnd=dp(this@MainActivity,10)}}
        val info=ll().apply{layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f)}
        info.addView(txt(p.type.replace("_"," · ").ifBlank{"Movimiento"},11f,TEXT,bold=true,bot=2))
        val who=p.senderPhone?.takeIf{it.isNotBlank()}?:p.receiverPhone?:sms.sender
        info.addView(txt("${visibleIdentifier(who)} · ${fmt.format(Date(sms.receivedAt))}",9.5f,TEXT2))
        row.addView(dot);row.addView(info);row.addView(txt((if(incoming) "+" else "−")+" %.2f".format(p.amount ?: 0.0),12f,color,bold=true));return row
    }

    private fun netStatsCard(inAmt: Double, outAmt: Double, cIn: Int, cOut: Int, color: Int): View { return managementMetric("BALANCE", "%.2f".format(inAmt-outAmt), color) }

    private fun miniStatCard(label: String, value: String, color: Int, count: Int): View = managementMetric(label, "$value · $count", color)

    private fun txRow(sms: SmsEntity, p: SmsParser.ParsedSms, fmt: SimpleDateFormat): View = txRowCompact(sms,p,fmt)

    private fun lockedFeatureCard(): View {
        val card=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(this@MainActivity,15),dp(this@MainActivity,14),dp(this@MainActivity,15),dp(this@MainActivity,14));background=roundedBackground(SURFACE2,16,MUTED,1);elevation=dp(this@MainActivity,2).toFloat();setOnClickListener{
            ThemedAlertDialogBuilder(this@MainActivity).setTitle("Gestión avanzada 🔒").setMessage("Esta sección se desbloquea con una licencia activa.\n\nIncluye estadísticas por día, semana y mes, filtros de entradas y salidas, análisis por número de remitente/destinatario y un historial detallado.").setPositiveButton("Entendido",null).show()
        }}
        val lock=txt("🔒",22f,RED);lock.setPadding(0,0,dp(this@MainActivity,12),0);card.addView(lock)
        val info=ll().apply{layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f)}
        info.addView(txt("GESTIÓN AVANZADA",10f,TEXT,bold=true,ls=0.08f,bot=4))
        info.addView(txt("Estadísticas, filtros e historial inteligente",11f,TEXT2))
        card.addView(info)
        card.addView(txt("DESBLOQUEAR ›",9f,RED,bold=true))
        return card
    }

    private fun pillBackground(color:Int,height:Int):Drawable {
        return GradientDrawable().apply{
            setColor(Color.argb(26,Color.red(color),Color.green(color),Color.blue(color)))
            setStroke(dp(this@MainActivity,1),Color.argb(80,Color.red(color),Color.green(color),Color.blue(color)))
            cornerRadius=dp(this@MainActivity,height/2).toFloat()
        }
    }

    /** The customer's layout preference is intentionally independent from the accent palette. */
    private fun selectedLayoutStyle(): String = prefs.getString(PREF_LAYOUT_STYLE, "hybrid").orEmpty()
        .takeIf { it in setOf("hybrid", "professional", "glass", "minimal", "aurora", "arena", "soft") } ?: "hybrid"

    private fun blendSurfaceColor(from: Int, to: Int, amount: Float, alphaOverride: Int? = null): Int {
        val t = amount.coerceIn(0f, 1f)
        val alpha = (alphaOverride ?: Color.alpha(from)).coerceIn(0, 255)
        return Color.argb(
            alpha,
            (Color.red(from) * (1f - t) + Color.red(to) * t).toInt().coerceIn(0, 255),
            (Color.green(from) * (1f - t) + Color.green(to) * t).toInt().coerceIn(0, 255),
            (Color.blue(from) * (1f - t) + Color.blue(to) * t).toInt().coerceIn(0, 255)
        )
    }

    /** All custom cards, chips and modal surfaces pass through this factory, so the selected
     * layout changes the actual visual system rather than just a small radius difference. */
    private fun roundedBackground(fill:Int, radiusDp:Int, strokeColor:Int, strokeWidth:Int):Drawable {
        val layoutStyle = selectedLayoutStyle()
        val usableFill = if (fill == Color.TRANSPARENT) fill else fill
        val accent = RED
        val resolvedRadius = when (layoutStyle) {
            "glass" -> maxOf(radiusDp + 7, 22)
            "minimal" -> (radiusDp - 4).coerceAtLeast(5).coerceAtMost(12)
            "professional" -> radiusDp.coerceIn(12, 18)
            "aurora" -> maxOf(radiusDp + 8, 24)
            "arena" -> (radiusDp - 6).coerceAtLeast(5).coerceAtMost(14)
            "soft" -> maxOf(radiusDp + 5, 22)
            else -> maxOf(radiusDp + 2, 13)
        }
        val safeStroke = when {
            strokeWidth <= 0 -> 0
            layoutStyle == "glass" || layoutStyle == "aurora" || layoutStyle == "arena" -> maxOf(strokeWidth, 2)
            layoutStyle == "minimal" || layoutStyle == "professional" || layoutStyle == "soft" -> 1
            else -> maxOf(strokeWidth, 1)
        }
        val edge = when (layoutStyle) {
            "glass" -> blendSurfaceColor(strokeColor, accent, 0.55f, 190)
            "minimal" -> blendSurfaceColor(strokeColor, MUTED, 0.42f, 112)
            "professional" -> blendSurfaceColor(strokeColor, MUTED, 0.50f, 105)
            "aurora" -> blendSurfaceColor(strokeColor, PURPLE, 0.66f, 215)
            "arena" -> blendSurfaceColor(strokeColor, accent, 0.62f, 220)
            "soft" -> blendSurfaceColor(strokeColor, PURPLE, 0.22f, 118)
            else -> blendSurfaceColor(strokeColor, accent, 0.24f, 150)
        }
        val first = when (layoutStyle) {
            "glass" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, PURPLE, 0.18f, if (Color.alpha(usableFill) == 255) 224 else Color.alpha(usableFill)) else usableFill
            "hybrid" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, accent, 0.07f, if (Color.alpha(usableFill) == 255) 246 else Color.alpha(usableFill)) else usableFill
            "aurora" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, PURPLE, if (isLightPalette()) 0.08f else 0.24f, if (Color.alpha(usableFill) == 255) 245 else Color.alpha(usableFill)) else usableFill
            "arena" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, accent, 0.10f, if (Color.alpha(usableFill) == 255) 248 else Color.alpha(usableFill)) else usableFill
            "soft" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, PURPLE, 0.075f, if (Color.alpha(usableFill) == 255) 250 else Color.alpha(usableFill)) else usableFill
            else -> usableFill
        }
        val second = when (layoutStyle) {
            "glass" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, accent, 0.10f, if (Color.alpha(usableFill) == 255) 214 else Color.alpha(usableFill)) else usableFill
            "hybrid" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, PURPLE, 0.035f, if (Color.alpha(usableFill) == 255) 244 else Color.alpha(usableFill)) else usableFill
            "aurora" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, accent, 0.11f, if (Color.alpha(usableFill) == 255) 235 else Color.alpha(usableFill)) else usableFill
            "soft" -> if (usableFill != Color.TRANSPARENT) blendSurfaceColor(usableFill, BLUE, 0.035f, if (Color.alpha(usableFill) == 255) 250 else Color.alpha(usableFill)) else usableFill
            else -> usableFill
        }
        return when (layoutStyle) {
            "glass" -> GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(first, second)).apply {
                cornerRadius = dp(this@MainActivity, resolvedRadius).toFloat()
                if (safeStroke > 0) setStroke(dp(this@MainActivity, safeStroke), edge)
            }
            "hybrid", "aurora" -> GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(first, second)).apply {
                cornerRadius = dp(this@MainActivity, resolvedRadius).toFloat()
                if (safeStroke > 0) setStroke(dp(this@MainActivity, safeStroke), edge)
            }
            "soft" -> GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(first, second)).apply {
                cornerRadius = dp(this@MainActivity, resolvedRadius).toFloat()
                if (safeStroke > 0) setStroke(dp(this@MainActivity, safeStroke), edge)
            }
            else -> GradientDrawable().apply {
                setColor(if (layoutStyle == "arena") blendSurfaceColor(usableFill, BG, if (isLightPalette()) 0.02f else 0.08f) else usableFill)
                cornerRadius = dp(this@MainActivity, resolvedRadius).toFloat()
                if (safeStroke > 0) setStroke(dp(this@MainActivity, safeStroke), edge)
            }
        }
    }

    private fun animateIn(view:View, delay:Long=0L) {
        view.alpha=0f; view.translationY=dp(this@MainActivity,8).toFloat()
        view.animate().alpha(1f).translationY(0f).setStartDelay(delay).setDuration(260).setInterpolator(DecelerateInterpolator()).start()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════════════════
    private fun ll() = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }

    private fun txt(text: String, size: Float, color: Int, bold: Boolean=false,
                    ls: Float=0f, bot: Int=0, top: Int=0) = TextView(this).apply {
        this.text=text; textSize=size; setTextColor(color)
        if(bold) setTypeface(typeface, Typeface.BOLD)
        if(ls!=0f) letterSpacing=ls
        setPadding(0,dp(this@MainActivity,top),0,dp(this@MainActivity,bot))
    }

    private fun lbl(text: String, top: Int=0) = txt(text, 10f, TEXT2, bold=true, ls=0.10f, top=top, bot=8)

    private fun darkSpinnerAdapter(values: List<String>): ArrayAdapter<String> = object : ArrayAdapter<String>(
        this, android.R.layout.simple_spinner_item, values
    ) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getView(position, convertView, parent) as TextView
            view.setTextColor(TEXT)
            view.textSize = 12f
            view.setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 11), dp(this@MainActivity, 12), dp(this@MainActivity, 11))
            view.background = roundedBackground(SURFACE2, 9, Color.parseColor("#35405A"), 1)
            return view
        }
        override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getDropDownView(position, convertView, parent) as TextView
            view.setTextColor(TEXT)
            view.textSize = 12f
            view.setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 12), dp(this@MainActivity, 14), dp(this@MainActivity, 12))
            view.setBackgroundColor(SURFACE)
            return view
        }
    }.apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }

    /** Builder wrapper: even simple one-line confirmation dialogs receive the selected design. */
    private inner class ThemedAlertDialogBuilder(context: Context) : AlertDialog.Builder(context) {
        override fun create(): AlertDialog {
            val dialog = super.create()
            dialog.setOnShowListener { styleSoDialog(dialog) }
            return dialog
        }
        override fun show(): AlertDialog {
            val dialog = super.show()
            styleSoDialog(dialog)
            return dialog
        }
    }

    /** AppCompat is used for the onboarding/license dialog; keep it visually consistent too. */
    private inner class ThemedAppCompatAlertDialogBuilder(context: Context) : androidx.appcompat.app.AlertDialog.Builder(context) {
        override fun create(): androidx.appcompat.app.AlertDialog {
            val dialog = super.create()
            dialog.setOnShowListener { styleSoDialog(dialog) }
            return dialog
        }
        override fun show(): androidx.appcompat.app.AlertDialog {
            val dialog = super.show()
            styleSoDialog(dialog)
            return dialog
        }
    }

    private var activeSoToast: View? = null
    private var activeSoToastDismiss: Runnable? = null
    private var activeStyledDialog: android.app.Dialog? = null

    /** Theme-aware transient in-app message. OS notification cards remain OS-rendered. */
    private fun showSoToast(message: CharSequence, duration: Int = Toast.LENGTH_SHORT) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnUiThread { showSoToast(message, duration) }
            return
        }
        if (!::rootFrame.isInitialized) {
            Toast.makeText(this, message, duration).show()
            return
        }
        val visibleDialog = activeStyledDialog?.takeIf { it.isShowing }
        val host = (visibleDialog?.window?.decorView as? ViewGroup) ?: rootFrame
        activeSoToastDismiss?.let { handler.removeCallbacks(it) }
        activeSoToast?.let { previous -> (previous.parent as? ViewGroup)?.removeView(previous) }
        val toastView = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 12), dp(this@MainActivity, 16), dp(this@MainActivity, 12))
            background = roundedBackground(SURFACE2, 18, RED, if (selectedLayoutStyle() == "glass") 2 else 1)
            elevation = dp(this@MainActivity, 12).toFloat()
            alpha = 0f
            translationY = dp(this@MainActivity, 12).toFloat()
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            contentDescription = message.toString()
        }
        val marker = View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(RED) }
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 7), dp(this@MainActivity, 7)).apply { marginEnd = dp(this@MainActivity, 10) }
        }
        toastView.addView(marker)
        toastView.addView(txt(message.toString(), 11f, TEXT, bold = true).apply {
            maxLines = 4
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val params = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            leftMargin = dp(this@MainActivity, 16)
            rightMargin = dp(this@MainActivity, 16)
            bottomMargin = dp(this@MainActivity, 104)
        }
        host.addView(toastView, params)
        activeSoToast = toastView
        toastView.animate().alpha(1f).translationY(0f).setDuration(180).start()
        val dismiss = Runnable {
            if (activeSoToast === toastView) {
                toastView.animate().alpha(0f).translationY(dp(this@MainActivity, 8).toFloat()).setDuration(180).withEndAction {
                    (toastView.parent as? ViewGroup)?.removeView(toastView)
                    if (activeSoToast === toastView) activeSoToast = null
                }.start()
            } else {
                (toastView.parent as? ViewGroup)?.removeView(toastView)
            }
        }
        activeSoToastDismiss = dismiss
        handler.postDelayed(dismiss, if (duration == Toast.LENGTH_LONG) 3500L else 2200L)
    }

    private fun styleSoDialog(dialog: android.app.Dialog, expanded: Boolean = false) {
        val window = dialog.window ?: return
        activeStyledDialog = dialog
        window.setBackgroundDrawable(roundedBackground(SURFACE, 20, RED, if (selectedLayoutStyle() == "glass") 2 else 1))
        window.setDimAmount(if (selectedLayoutStyle() == "minimal") 0.62f else 0.76f)
        val dialogWidth = (resources.displayMetrics.widthPixels * 0.92f).toInt()
        val dialogHeight = if (expanded) (resources.displayMetrics.heightPixels * 0.82f).toInt() else ViewGroup.LayoutParams.WRAP_CONTENT
        window.setLayout(dialogWidth, dialogHeight)
        // Resolve alertTitle by resource name: some Android SDK stubs used by CI
        // do not expose android.R.id.alertTitle as a compile-time symbol.
        val alertTitleId = resources.getIdentifier("alertTitle", "id", "android")
        if (alertTitleId != 0) {
            dialog.findViewById<TextView>(alertTitleId)?.apply {
                setTextColor(TEXT)
                textSize = 19f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 5), dp(this@MainActivity, 8))
            }
        }
        dialog.findViewById<TextView>(android.R.id.message)?.setTextColor(TEXT2)
        listOf(android.R.id.button1, android.R.id.button2, android.R.id.button3).forEach { id ->
            dialog.findViewById<Button>(id)?.apply {
                setTextColor(RED)
                textSize = 11f
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            }
        }
        // AppCompat.Light has white custom-dialog panels by default. Repaint framework or
        // appcompat panel views based on their resolved resource names (no internal ID dependency).
        val panelNames = setOf("parentPanel", "topPanel", "contentPanel", "customPanel", "buttonPanel", "titleDividerNoCustom", "custom")
        fun repaintPanels(view: View) {
            val entry = if (view.id != View.NO_ID) runCatching { resources.getResourceEntryName(view.id) }.getOrNull() else null
            if (entry in panelNames) view.setBackgroundColor(Color.TRANSPARENT)
            if (view is ViewGroup) for (i in 0 until view.childCount) repaintPanels(view.getChildAt(i))
        }
        repaintPanels(window.decorView)
    }

    private fun inp(hint: String, multiline: Boolean=false, maxLen: Int=0, numeric: Boolean=false) =
        EditText(this).apply {
            this.hint=hint; setHintTextColor(MUTED); setTextColor(TEXT); textSize=14f
            if(numeric) inputType=InputType.TYPE_CLASS_NUMBER
            if(maxLen>0) filters=arrayOf(InputFilter.LengthFilter(maxLen))
            if(!multiline) maxLines=1
            setPadding(dp(this@MainActivity,14),dp(this@MainActivity,14),dp(this@MainActivity,14),dp(this@MainActivity,14))
            background=GradientDrawable().apply {
                setColor(SURFACE2); setStroke(dp(this@MainActivity,1),SURFACE2)
                cornerRadius=dp(this@MainActivity,6).toFloat()
            }
            layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin=dp(this@MainActivity,10)
            }
        }

    private fun futuristicBackButton(label: String, onClick: () -> Unit): TextView = TextView(this).apply {
        text = label
        textSize = 14f
        setTextColor(TEXT)
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        gravity = Gravity.CENTER
        letterSpacing = 0.08f
        minHeight = dp(this@MainActivity, 52)
        setPadding(dp(this@MainActivity, 24), 0, dp(this@MainActivity, 24), 0)
        elevation = dp(this@MainActivity, 8).toFloat()
        contentDescription = "Volver"
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(SURFACE2)
            setStroke(dp(this@MainActivity, 1), BLUE)
            cornerRadius = dp(this@MainActivity, 30).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(this@MainActivity, 52)
        ).apply {
            bottomMargin = dp(this@MainActivity, 24)
            gravity = Gravity.START
        }
        setOnClickListener { onClick() }
    }

    private fun btn(text: String) = Button(this).apply {
        this.text=text; setTextColor(Color.WHITE); textSize=13f
        setTypeface(typeface, Typeface.BOLD); letterSpacing=0.08f; isAllCaps=true
        // Darken bright theme accents just enough to keep white button labels readable in every palette.
        val (startDarken, endDarken) = when (prefs.getString(PREF_THEME, "violet").orEmpty()) {
            "red" -> 0.30f to 0.30f
            "green" -> 0.40f to 0.45f
            "cyan" -> 0.40f to 0.48f
            "light" -> 0.08f to 0.12f
            else -> 0.22f to 0.38f
        }
        background=GradientDrawable().apply {
            colors=intArrayOf(blendSurfaceColor(RED, Color.BLACK, startDarken), blendSurfaceColor(PURPLE, Color.BLACK, endDarken))
            gradientType=GradientDrawable.LINEAR_GRADIENT
            orientation=GradientDrawable.Orientation.LEFT_RIGHT
            cornerRadius=dp(this@MainActivity, if (selectedLayoutStyle() == "minimal") 5 else if (selectedLayoutStyle() == "glass") 14 else 9).toFloat()
        }
        setPadding(0,dp(this@MainActivity,16),0,dp(this@MainActivity,16))
        layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun tabBtn(text: String, active: Boolean) = TextView(this).apply {
        this.text=text; textSize=11f; setTextColor(if(active) RED else MUTED)
        setTypeface(typeface, Typeface.BOLD); letterSpacing=0.10f; gravity=Gravity.CENTER
        setPadding(dp(this@MainActivity,12),dp(this@MainActivity,8),dp(this@MainActivity,12),dp(this@MainActivity,8))
        layoutParams=LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    }

    private fun chip(text: String, active: Boolean) = TextView(this).apply {
        this.text=text; textSize=10f; setTextColor(if(active) Color.WHITE else TEXT2)
        setTypeface(typeface, Typeface.BOLD); letterSpacing=0.08f; gravity=Gravity.CENTER
        setPadding(dp(this@MainActivity,12),dp(this@MainActivity,6),dp(this@MainActivity,12),dp(this@MainActivity,6))
        background=if(active) GradientDrawable().apply { setColor(RED); cornerRadius=dp(this@MainActivity,20).toFloat() }
        else GradientDrawable().apply { setColor(Color.TRANSPARENT); setStroke(dp(this@MainActivity,1),MUTED); cornerRadius=dp(this@MainActivity,20).toFloat() }
    }

    private fun row2(v1: View, v2: View) = LinearLayout(this).apply {
        orientation=LinearLayout.HORIZONTAL
        addView(v1.apply { layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f).apply { marginEnd=dp(this@MainActivity,8) } })
        addView(v2.apply { layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f) })
    }

    private fun gradientDivider() = View(this).apply {
        layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity,1)).apply {
            topMargin=dp(this@MainActivity,8); bottomMargin=dp(this@MainActivity,32)
        }
        background=GradientDrawable().apply {
            colors=intArrayOf(Color.TRANSPARENT,RED,Color.TRANSPARENT)
            gradientType=GradientDrawable.LINEAR_GRADIENT
            orientation=GradientDrawable.Orientation.LEFT_RIGHT
        }
    }

    private fun space(dpVal: Int, horiz: Boolean=false) = View(this).apply {
        layoutParams=if(horiz) LinearLayout.LayoutParams(dp(this@MainActivity,dpVal), ViewGroup.LayoutParams.MATCH_PARENT)
        else LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity,dpVal))
    }

    private fun parseIsoDate(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd'T'HH:mm:ss"
        )
        for (fmt in formats) {
            runCatching {
                SimpleDateFormat(fmt, Locale.getDefault()).parse(iso)?.time
            }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun backendRequest(path: String, method: String = "GET", token: String = "", payload: JSONObject? = null): BackendResponse {
        val isResellerUpload = path.contains("/reseller/applications") && method.equals("POST", true)
        val isAssistantRequest = path.startsWith("/api/assistant/")
        val connection = (URL("$BACKEND_BASE_URL$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = if (isResellerUpload) 20000 else if (isAssistantRequest) 15000 else 12000
            readTimeout = if (isResellerUpload) 75000 else if (isAssistantRequest) 55000 else 18000
            setRequestProperty("Accept", "application/json")
            if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (path.startsWith("/api/game-market/") || path.startsWith("/api/store/") ||
                path.startsWith("/api/etecsa/") || path.startsWith("/api/game-recharges/") || path.startsWith("/api/rewards/") ||
                path.startsWith("/api/assistant/")) {
                setRequestProperty("X-Device-ID", prefs.getString(SyncService.KEY_DEVICE_ID, "").orEmpty().ifBlank { ensureDeviceId() })
            }
            if (payload != null) {
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                doOutput = true
            }
        }
        try {
            if (payload != null) connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val body = runCatching {
                (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            }.getOrDefault("")
            return BackendResponse(code, body)
        } finally {
            connection.disconnect()
        }
    }

    private fun isDeviceOnline(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } catch (_: Exception) { false }
    }

    private fun buildOfflineFeatureCard(title: String, details: String): LinearLayout {
        val card = ll().apply {
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 18), dp(this@MainActivity, 16), dp(this@MainActivity, 18))
            background = roundedBackground(SURFACE, 18, Color.parseColor("#5A3D91"), 1)
        }
        val badge = txt("●  MODO OFFLINE", 9f, Color.parseColor("#FFC56E"), bold=true, ls=.10f, bot=9)
        badge.background = pillBackground(Color.parseColor("#6C4B21"), 22)
        badge.setPadding(dp(this@MainActivity, 9), dp(this@MainActivity, 6), dp(this@MainActivity, 9), dp(this@MainActivity, 6))
        card.addView(badge)
        card.addView(txt(title, 18f, TEXT, bold=true, bot=5))
        card.addView(txt(details, 11f, TEXT2, bot=10))
        card.addView(txt("Disponible sin conexión", 10f, GREEN, bold=true))
        card.addView(txt("El historial y los SMS guardados en este dispositivo siguen disponibles. Wallet, ofertas y precios remotos permanecen ocultos hasta recuperar Internet.", 9f, MUTED, top=4))
        return card
    }

    private fun providerAdminFailureMessage(response: BackendResponse?, json: JSONObject, fallback: String): String {
        if (response == null) {
            return "No se recibió respuesta del backend. Comprueba si el servicio está en línea y revisa los logs de despliegue; este resultado no confirma por sí solo que la clave sea incorrecta."
        }
        val serverError = json.optString("error", "").trim().takeIf { it.isNotBlank() }
        val code = json.optString("code", "").trim()
        val providerStatus = json.optInt("provider_status", 0)
        val apiKeyConfigured = if (json.has("api_key_configured")) json.optBoolean("api_key_configured") else null
        return buildString {
            append(serverError ?: fallback)
            append(" · HTTP ").append(response.code)
            if (code.isNotBlank()) append(" · Código: ").append(code.take(80))
            if (providerStatus > 0) append(" · Respuesta de RechargeGames: HTTP ").append(providerStatus)
            if (apiKeyConfigured == false) append(" · La clave API no está configurada en el servicio.")
        }
    }

    private fun showRewardsUnavailableNotice(explainSetup: Boolean = false) {
        val message = if (explainSetup && prefs.getString("client_role", "client").equals("admin", true)) {
            "El programa no está activado. Antes de habilitarlo, confirma que las migraciones 026–028 están aplicadas y que SYNTHESIS_REWARDS_ENABLED=true está configurado en Render. Las compras actuales no se ven afectadas."
        } else {
            "Las misiones y los cupones todavía no están disponibles. Puedes seguir utilizando la tienda y sus métodos de pago habituales."
        }
        ThemedAlertDialogBuilder(this).setTitle("Misiones y cupones").setMessage(message).setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
    }

    private fun openRewardsEntry() {
        if (!isDeviceOnline()) {
            val cached = rewardsCache()
            if (cached != null) renderRewardsPanel(cached, true)
            else showSoToast("Conéctate a Internet para comprobar la disponibilidad de las misiones.", Toast.LENGTH_LONG)
            return
        }
        val token = storeAccessToken()
        if (token.isBlank()) {
            showSoToast("Activa una sesión para consultar tus misiones y cupones.", Toast.LENGTH_LONG)
            return
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/rewards/status", token = token) }.getOrNull()
            }
            val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
            if (response == null) {
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Misiones y cupones")
                    .setMessage("No se pudo comprobar la disponibilidad de las recompensas. Inténtalo de nuevo cuando el servicio responda; tus compras actuales no se ven afectadas.")
                    .setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
                return@launch
            }
            if (response.code !in 200..299) {
                val serverMessage = json.optString("error", "No se pudo comprobar el programa de recompensas.")
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Misiones y cupones")
                    .setMessage("$serverMessage (HTTP ${response.code}). Tus compras actuales no se ven afectadas.")
                    .setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
                return@launch
            }
            val enabled = json.optBoolean("enabled", false)
            prefs.edit().putBoolean(PREF_REWARDS_FEATURE_AVAILABLE, enabled).apply()
            if (enabled) showRewardsPanel() else showRewardsUnavailableNotice(explainSetup = true)
        }
    }

    private fun openStoreCartEntry() {
        if (!isDeviceOnline()) {
            showSoToast("El carrito requiere conexión para consultar precios y validar el pago.", Toast.LENGTH_LONG)
            return
        }
        val token = storeAccessToken()
        if (token.isBlank()) {
            showSoToast("Activa una sesión para consultar el carrito.", Toast.LENGTH_LONG)
            return
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/store/cart/status", token = token) }.getOrNull()
            }
            val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
            if (response == null || response.code !in 200..299) {
                val detail = if (response == null) "No se pudo conectar con el servicio." else "${json.optString("error", "No se pudo consultar el carrito.")} (HTTP ${response.code})."
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Mi carrito")
                    .setMessage("$detail Los pagos individuales actuales no se ven afectados.")
                    .setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
                return@launch
            }
            val enabled = json.optBoolean("enabled", false)
            prefs.edit().putBoolean(PREF_CART_FEATURE_AVAILABLE, enabled).apply()
            if (enabled) showStoreCartPanel() else {
                val message = if (prefs.getString("client_role", "client").equals("admin", true)) {
                    "El carrito no está activado. Confirma que la migración 027 está aplicada y que SYNTHESIS_CART_ENABLED=true está configurado en Render. Los pagos individuales actuales no se ven afectados."
                } else {
                    "El carrito todavía no está disponible. Puedes seguir comprando mediante los métodos habituales."
                }
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Mi carrito").setMessage(message).setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
            }
        }
    }

    private fun buildRechargeGamesAdminTools(): LinearLayout {
        val card = ll().apply {
            setPadding(dp(this@MainActivity, 13), dp(this@MainActivity, 12), dp(this@MainActivity, 13), dp(this@MainActivity, 12))
            background = roundedBackground(SURFACE, 14, Color.parseColor("#30384E"), 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity, 10)
            }
        }
        card.addView(txt("ESTADO DEL PROVEEDOR · RECHARGEGAMES", 9f, PURPLE, bold = true, ls = .08f, bot = 5))
        val status = txt("Comprueba conexión, saldo prepago y sincronización del catálogo real.", 10f, TEXT2, bot = 8)
        card.addView(status)
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        fun actionButton(label: String, endMargin: Int, onClick: () -> Unit): Button = btn(label).apply {
            textSize = 8f
            isAllCaps = false
            minHeight = dp(this@MainActivity, 44)
            setPadding(dp(this@MainActivity, 4), dp(this@MainActivity, 7), dp(this@MainActivity, 4), dp(this@MainActivity, 7))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(this@MainActivity, endMargin)
            }
            setOnClickListener { onClick() }
        }
        actions.addView(actionButton("VERIFICAR", 5) {
            status.setTextColor(TEXT2); status.text = "Validando clave y cuenta de revendedor…"
            uiScope.launch {
                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-recharges/admin/check-connection", "POST", storeAccessToken(), JSONObject()) }.getOrNull() }
                val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                if (response != null && response.code in 200..299 && json.optBoolean("connected", false)) {
                    status.setTextColor(GREEN)
                    val buyer = json.optString("buyer", "").takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
                    status.text = "Conectado a RechargeGames$buyer."
                } else {
                    status.setTextColor(ERR)
                    status.text = providerAdminFailureMessage(response, json, "No se pudo validar la API o la cuenta no tiene permisos de revendedor.")
                }
            }
        })
        actions.addView(actionButton("SALDO USDT", 5) {
            status.setTextColor(TEXT2); status.text = "Consultando saldo prepago del proveedor…"
            uiScope.launch {
                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-recharges/admin/provider-balance", token = storeAccessToken()) }.getOrNull() }
                val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                if (response != null && response.code in 200..299 && json.has("balance_usdt")) {
                    status.setTextColor(GREEN)
                    status.text = "Saldo prepago RechargeGames: ${json.optString("balance_usdt")} USDT."
                } else {
                    status.setTextColor(ERR)
                    status.text = providerAdminFailureMessage(response, json, "No se pudo consultar el saldo del proveedor.")
                }
            }
        })
        actions.addView(actionButton("ACTUALIZAR", 0) {
            status.setTextColor(TEXT2); status.text = "Descargando catálogo completo de juegos, regiones y paquetes…"
            uiScope.launch {
                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-recharges/admin/refresh", "POST", storeAccessToken(), JSONObject()) }.getOrNull() }
                val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                if (response != null && response.code in 200..299 && json.optBoolean("ok", false)) {
                    val result = json.optJSONObject("result") ?: JSONObject()
                    status.setTextColor(GREEN)
                    status.text = "Catálogo sincronizado: ${result.optInt("games")} juegos, ${result.optInt("products")} paquetes (${result.optInt("available_products")} disponibles)."
                    refreshRemoteGameCatalog()
                } else {
                    val diagnostics = withContext(Dispatchers.IO) {
                        runCatching { backendRequest("/api/game-recharges/admin/status", token = storeAccessToken()) }.getOrNull()
                    }
                    val diagJson = diagnostics?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                    val catalogState = diagJson.optJSONObject("catalog") ?: JSONObject()
                    val lastError = catalogState.optString("last_error", "").takeIf { it.isNotBlank() }
                    val keyConfigured = if (diagJson.has("api_key_configured")) diagJson.optBoolean("api_key_configured") else null
                    status.setTextColor(ERR)
                    status.text = buildString {
                        append(providerAdminFailureMessage(response, json, "No se pudo actualizar el catálogo."))
                        if (keyConfigured == false && !contains("no está configurada")) append(" · Clave API ausente")
                        if (!lastError.isNullOrBlank()) append(" · Último error del catálogo: ").append(lastError.take(100))
                        if (diagnostics == null && response != null) append(" · No se pudo leer el diagnóstico del catálogo")
                    }
                }
            }
        })
        card.addView(actions)
        card.addView(btn("REVISAR PAGOS PENDIENTES").apply {
            textSize = 9f
            isAllCaps = false
            minHeight = dp(this@MainActivity, 42)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(this@MainActivity, 7)
            }
            setOnClickListener { showGameRechargePaymentReview() }
        })
        card.addView(txt("El saldo mostrado pertenece al proveedor y es independiente de la Wallet de clientes. Para validar transferencias manuales, usa la revisión segura; no cambies estados de pedidos directamente en la base de datos.", 9f, MUTED, top = 7))
        return card
    }

    private fun showGameRechargePaymentReview() {
        if (!isDeviceOnline()) {
            showSoToast("Necesitas conexión para revisar pagos pendientes.", Toast.LENGTH_LONG)
            return
        }
        val token = storeAccessToken()
        if (token.isBlank()) {
            showSoToast("Inicia sesión con una cuenta administradora.", Toast.LENGTH_LONG)
            return
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/game-recharges/admin/payment-review", token = token) }.getOrNull()
            }
            val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
            if (response == null || response.code !in 200..299) {
                showSoToast(json.optString("error", "No se pudieron cargar los pagos pendientes."), Toast.LENGTH_LONG)
                return@launch
            }
            val orders = json.optJSONArray("orders") ?: JSONArray()
            if (orders.length() == 0) {
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Pagos pendientes")
                    .setMessage("No hay tickets de transferencia esperando revisión.")
                    .setPositiveButton("Cerrar", null).show()
                return@launch
            }
            val entries = (0 until orders.length()).mapNotNull { orders.optJSONObject(it) }
            val labels = entries.map { order ->
                val amount = order.optDouble("amount", Double.NaN)
                val amountText = if (amount.isFinite()) "${formatCatalogPrice(amount.toLong())} CUP" else "Importe no disponible"
                val reviewLabel = when (order.optString("review_kind")) {
                    "CODE_DELIVERY_RECOVERY" -> "RECUPERAR CÓDIGO"
                    "DELIVERY_RECOVERY" -> "RECUPERAR ENTREGA"
                    else -> "PAGO PENDIENTE"
                }
                "${order.optString("ticket", "Ticket")} · ${order.optString("game_name", "Juego")} · $amountText · $reviewLabel · ${order.optString("status", "—")}"
            }
            ThemedAlertDialogBuilder(this@MainActivity).setTitle("Pagos de Game Market")
                .setItems(labels.toTypedArray()) { _, which ->
                    if (which in entries.indices) showGameRechargePaymentReviewDetails(entries[which])
                }
                .setNegativeButton("Cerrar", null).show()
        }
    }

    private fun showGameRechargePaymentReviewDetails(order: JSONObject) {
        val id = order.optString("id", "").trim()
        if (id.isBlank()) {
            showSoToast("Este ticket no tiene un identificador válido.", Toast.LENGTH_LONG)
            return
        }
        val payment = order.optJSONObject("payment")
        val nestedCard = payment?.optString("card", "").orEmpty().takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val nestedPhone = payment?.optString("confirmation_phone", "").orEmpty().takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val topCard = order.optString("destination_card", "").takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val topPhone = order.optString("confirmation_phone", "").takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val card = nestedCard.ifBlank { topCard.ifBlank { "—" } }
        val phone = nestedPhone.ifBlank { topPhone.ifBlank { "—" } }
        val amount = order.optDouble("amount", Double.NaN)
        val amountText = if (amount.isFinite()) "${formatCatalogPrice(amount.toLong())} CUP" else "importe no disponible"
        val recovery = order.optString("review_kind") == "DELIVERY_RECOVERY"
        val codeRecovery = order.optString("review_kind") == "CODE_DELIVERY_RECOVERY"
        val instructions = if (codeRecovery) {
            "Este pedido está configurado para entregar un código. Se consultará el pedido original con el proveedor y se recuperará el código si ya fue emitido; no se generará otra compra ni se realizará otro cobro."
        } else if (recovery) {
            "El estado guardado no demuestra una entrega del proveedor y el ticket no conserva un ID de proveedor ni código de entrega. Verifica que el pago fue recibido y que el cliente no recibió el producto. Se recuperará el mismo ticket usando su referencia original para evitar duplicados."
        } else {
            "Confirma solo después de verificar en Transfermóvil el importe, la tarjeta receptora y el movimiento. Esta acción marcará el pago y enviará el pedido al proveedor."
        }
        val details = "Ticket: ${order.optString("ticket", id)}\nProducto: ${order.optString("game_name", "Juego")} · ${order.optString("offer_title", "Oferta")}\nImporte esperado: $amountText\nMóvil pagador: ${order.optString("payer_phone", "—")}\nTarjeta receptora: $card\nTeléfono de confirmación: $phone\nEstado guardado: ${order.optString("status", "—")}\n\n$instructions"
        val actionLabel = if (codeRecovery) "RECUPERAR CÓDIGO" else "PAGO VERIFICADO · ENVIAR"
        val dialog = ThemedAlertDialogBuilder(this).setTitle(if (codeRecovery) "Recuperar código" else "Verificar pago")
            .setMessage(details).setNegativeButton("Cancelar", null)
            .setPositiveButton(actionLabel, null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            val positiveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            positiveButton.setOnClickListener {
                positiveButton.isEnabled = false
                positiveButton.text = "ENVIANDO…"
                uiScope.launch {
                    val response = withContext(Dispatchers.IO) {
                        runCatching {
                            backendRequest(
                                if (codeRecovery) "/api/game-recharges/admin/orders/$id/recover-delivery" else "/api/game-recharges/admin/orders/$id/confirm-payment",
                                "POST",
                                storeAccessToken(),
                                if (codeRecovery) JSONObject() else JSONObject().put("confirmation", true).put("note", "Pago verificado manualmente desde administración.")
                            )
                        }.getOrNull()
                    }
                    val result = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                    if (response != null && response.code in 200..299 && result.optBoolean("ok", false)) {
                        dialog.dismiss()
                        val latest = result.optJSONObject("order") ?: JSONObject()
                        StoreStatusWorker.seedStatus(this@MainActivity, "GAMEMARKET", id, latest.optString("status", "SUBMITTING_TO_PROVIDER"))
                        StoreStatusWorker.refreshNow(this@MainActivity)
                        showStoreReceiptDialog("GAMEMARKET", latest, "/api/game-recharges/orders/$id")
                        val feedback = if (codeRecovery && latest.optString("delivery_note").isNotBlank()) {
                            "Código recuperado y guardado en el ticket."
                        } else if (codeRecovery) {
                            "El proveedor aún no entregó el código; el pedido queda pendiente de actualización."
                        } else {
                            "Pago revisado. Estado de entrega: ${latest.optString("status", "en proceso")}."
                        }
                        showSoToast(feedback, Toast.LENGTH_LONG)
                    } else {
                        positiveButton.isEnabled = true
                        positiveButton.text = actionLabel
                        showSoToast(result.optString("error", "No se pudo confirmar el pago."), Toast.LENGTH_LONG)
                    }
                }
            }
        }
        dialog.show()
    }

    private fun parseRemoteGameCatalog(json: JSONObject): List<GameCatalogItem> {
        val games = json.optJSONArray("games") ?: JSONArray()
        val accents = listOf(Color.parseColor("#FF9A58"), Color.parseColor("#52C8FF"), Color.parseColor("#E5BE69"), Color.parseColor("#63E4C7"))
        val deep = listOf(Color.parseColor("#612532"), Color.parseColor("#173B68"), Color.parseColor("#39264D"), Color.parseColor("#214A58"))
        return (0 until games.length()).mapNotNull { index ->
            val g = games.optJSONObject(index) ?: return@mapNotNull null
            val id = g.optString("id", "").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val offerArray = g.optJSONArray("offers") ?: JSONArray()
            val offers = (0 until offerArray.length()).mapNotNull offerMap@ { j ->
                val o = offerArray.optJSONObject(j) ?: return@offerMap null
                val published = o.optBoolean("published", true)
                val available = o.optBoolean("available", true)
                GameOfferItem(
                    id = o.optString("id", UUID.randomUUID().toString()),
                    title = o.optString("title", "Oferta"),
                    description = o.optString("description", ""),
                    priceCup = o.optDouble("price_cup", 0.0).toLong(),
                    priceSaldo = o.optDouble("price_saldo", 0.0).toLong(),
                    baseUsd = if (o.has("base_cost_usd") && !o.isNull("base_cost_usd")) o.optDouble("base_cost_usd") else null,
                    autoPricing = o.optBoolean("auto_pricing", false),
                    active = published && available,
                    category = o.optString("category", "Paquete"),
                    available = available,
                    published = published,
                    packageData = o.optJSONObject("package_data") ?: JSONObject(),
                    resellerPriceCup = if (o.has("price_reseller_cup") && !o.isNull("price_reseller_cup")) o.optDouble("price_reseller_cup").toLong() else null,
                    resellerPriceSaldo = if (o.has("price_reseller_saldo") && !o.isNull("price_reseller_saldo")) o.optDouble("price_reseller_saldo").toLong() else null,
                    providerConnected = o.optBoolean("provider_connected", o.optJSONObject("package_data")?.optJSONObject("rechargegames")?.optBoolean("automatic", false) == true)
                )
            }
            val name = g.optString("name", "Juego")
            val category = g.optString("category", "Juegos")
            GameCatalogItem(
                name = name,
                subtitle = category,
                monogram = name.split(Regex("\\s+")).filter { it.isNotBlank() }.take(2).map { it.take(1).uppercase(Locale.ROOT) }.joinToString("").ifBlank { "GM" },
                accent = accents[index % accents.size], deepAccent = deep[index % deep.size],
                badge = g.optString("badge", category),
                imageUrl = g.optString("thumbnail_url", "").takeIf { it.startsWith("https://") || it.startsWith("http://") },
                id = id, imageUri = null, offers = offers,
                description = g.optString("description", ""), thumbnailPath = g.optString("thumbnail_path", "").takeIf { it.isNotBlank() },
                isActive = g.optBoolean("is_active", true)
            )
        }
    }

    private fun parseRemoteEtecsaCatalog(json: JSONObject): GameCatalogItem? {
        val source = json.optJSONArray("offers") ?: JSONArray()
        val offers = mutableListOf<GameOfferItem>()
        for (index in 0 until source.length()) {
            val row = source.optJSONObject(index) ?: continue
            val offerId = row.optString("id", "").trim()
            val type = row.optString("type", "").lowercase(Locale.ROOT)
            if (offerId.isBlank() || type !in setOf("recharge", "nauta")) continue
            val prices = row.optJSONArray("prices") ?: JSONArray()
            for (priceIndex in 0 until prices.length()) {
                val price = prices.optJSONObject(priceIndex) ?: continue
                val priceId = price.optString("price_id", "").trim()
                val cup = price.optDouble("price_cup", 0.0).takeIf { it.isFinite() && it > 0 }?.toLong() ?: 0L
                val saldo = price.optDouble("price_saldo", 0.0).takeIf { it.isFinite() && it > 0 }?.toLong() ?: 0L
                if (priceId.isBlank() || (cup <= 0 && saldo <= 0)) continue
                val label = price.optString("label", "").trim().ifBlank { "Paquete ${priceIndex + 1}" }
                val meta = JSONObject().apply {
                    put("offer_id", offerId)
                    put("price_id", priceId)
                    put("type", type)
                    put("required_inputs", row.optJSONArray("required_inputs") ?: JSONArray().put("recipient"))
                    put("has_email", row.optBoolean("has_email", false))
                    put("is_preorder", row.optBoolean("is_preorder", false))
                }
                offers += GameOfferItem(
                    id = "etecsa:$offerId:$priceId",
                    title = "${row.optString("name", "ETECSA")} · $label",
                    description = row.optString("description", if (type == "nauta") "Acceso Nauta" else "Recarga móvil"),
                    priceCup = cup,
                    priceSaldo = saldo,
                    active = true,
                    category = "ETECSA",
                    available = true,
                    published = true,
                    packageData = JSONObject().put("etecsa", meta)
                )
            }
        }
        if (offers.isEmpty()) return null
        return GameCatalogItem(
            name = "ETECSA",
            subtitle = "Recargas móviles y Nauta",
            monogram = "ET",
            accent = Color.parseColor("#42B9D8"),
            deepAccent = Color.parseColor("#17415B"),
            badge = "RECARGAS CUBACEL · NAUTA",
            id = "etecsa-live",
            offers = offers,
            description = "Ofertas de recarga móvil y acceso Nauta disponibles.",
            isActive = true
        )
    }

    private fun refreshRemoteGameCatalog(onLoaded: (() -> Unit)? = null) {
        if (!isDeviceOnline()) {
            gameCatalog = emptyList()
            onLoaded?.invoke()
            return
        }
        val token = storeAccessToken()
        uiScope.launch {
            val role = if (token.isNotBlank()) withContext(Dispatchers.IO) { fetchClientRole(token) } else null
            if (!role.isNullOrBlank()) prefs.edit().putString("client_role", role).apply()
            val path = if (role == "admin") "/api/game-market/admin/catalog" else "/api/game-market/catalog"
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest(path, token = token) }.getOrNull() }
            var liveGames = emptyList<GameCatalogItem>()
            var regularJson: JSONObject? = null
            if (response != null && response.code in 200..299) {
                regularJson = runCatching { JSONObject(response.body) }.getOrNull()
                regularJson?.let { json ->
                    prefs.edit().putString("so_market_price_tier", json.optString("pricing_tier", "normal")).apply()
                    liveGames = runCatching { parseRemoteGameCatalog(json) }.getOrDefault(emptyList())
                    val pricing = json.optJSONObject("pricing")
                    if (pricing != null) {
                        pricing.optJSONObject("normal")?.let { applyRemotePricingToPrefs(it, "normal") }
                        pricing.optJSONObject("reseller")?.let { applyRemotePricingToPrefs(it, "reseller") }
                    }
                }
            }
            // ETECSA is an independent live API. A failure in either catalogue must not erase the other.
            val etecsaResponse = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/etecsa/catalog", token = token) }.getOrNull()
            }
            val liveEtecsa = if (etecsaResponse != null && etecsaResponse.code in 200..299) {
                runCatching { parseRemoteEtecsaCatalog(JSONObject(etecsaResponse.body)) }.getOrNull()
            } else null
            // Old manually seeded ETECSA rows caused an empty duplicate beside the live catalogue.
            // ETECSA is rendered only from its live catalog response, without exposing supplier branding.
            gameCatalog = liveGames.filterNot { isLegacyEtecsaCatalogItem(it) } + listOfNotNull(liveEtecsa)
            // Never substitute cached/demo offers or guessed prices on API failure.
            saveGameCatalog()
            if (liveGames.isEmpty() && liveEtecsa == null && response != null && response.code !in 200..299) {
                android.util.Log.w("SynthesisOne_Market", "Catálogos remotos no disponibles: Game Market ${response.code}; ETECSA ${etecsaResponse?.code ?: 0}")
            }
            onLoaded?.invoke()
        }
    }

    private fun loadLocalCartItems(): JSONArray = runCatching {
        JSONArray(prefs.getString(PREF_CART_ITEMS, "[]").orEmpty())
    }.getOrDefault(JSONArray())

    private fun saveLocalCartItems(items: JSONArray) {
        prefs.edit().putString(PREF_CART_ITEMS, items.toString()).remove(PREF_CART_IDEMPOTENCY_KEY).apply()
    }

    private fun addLocalCartItem(item: JSONObject) {
        val current = loadLocalCartItems()
        if (current.length() >= 25) {
            showSoToast("El carrito admite un máximo de 25 ofertas por pedido.", Toast.LENGTH_LONG)
            return
        }
        current.put(item)
        saveLocalCartItems(current)
        showSoToast("Oferta añadida al carrito (${current.length()}).", Toast.LENGTH_SHORT)
    }

    private fun beginOfferAddToCart(item: GameCatalogItem, offer: GameOfferItem) {
        if (!prefs.getBoolean(PREF_CART_FEATURE_AVAILABLE, false)) {
            showSoToast("El carrito todavía no está disponible.", Toast.LENGTH_LONG)
            return
        }
        if (!isDeviceOnline()) {
            showSoToast("Puedes guardar ofertas localmente, pero necesitas conexión para validar el catálogo y pagar el carrito.", Toast.LENGTH_LONG)
            return
        }
        val etecsaMeta = offer.packageData.optJSONObject("etecsa")
        if (etecsaMeta != null) {
            beginEtecsaCheckout(item, offer, etecsaMeta, addToCart = true)
            return
        }
        if (!offer.providerConnected) {
            showSoToast("Esta oferta no está disponible para compra automática.", Toast.LENGTH_LONG)
            return
        }
        showGameRechargeDetailsDialog(item, offer, walletCurrency = null, addToCart = true)
    }

    private data class CartPaymentChoice(val label: String, val method: String, val currency: String)

    private fun showStoreCartPanel() {
        val items = loadLocalCartItems()
        val form = ll().apply { setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 8), dp(this@MainActivity, 16), dp(this@MainActivity, 8)) }
        if (items.length() == 0) {
            form.addView(txt("Tu carrito está vacío. Añade ofertas desde el catálogo y vuelve aquí para confirmar la compra conjunta.", 12f, TEXT2, bot = 8))
            ThemedAlertDialogBuilder(this).setTitle("Mi carrito").setView(form).setPositiveButton("Cerrar", null).show().also { styleSoDialog(it) }
            return
        }
        form.addView(txt("Revisa todas las ofertas. Los precios son orientativos hasta que el servidor vuelva a validar el catálogo al crear el pedido.", 10f, TEXT2, bot = 8))
        val lineHost = ll()
        form.addView(lineHost)
        val estimate = txt("", 10f, TEXT, bold = true, top = 3, bot = 8)
        form.addView(estimate)
        fun renderLines() {
            lineHost.removeAllViews()
            val fresh = loadLocalCartItems()
            var displaySubtotal = 0L
            for (i in 0 until fresh.length()) {
                val line = fresh.optJSONObject(i) ?: continue
                val source = line.optString("source", "GAME_MARKET")
                val price = line.optLong("price_cup", 0L)
                displaySubtotal += price.coerceAtLeast(0L)
                val card = ll().apply {
                    setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 9), dp(this@MainActivity, 10), dp(this@MainActivity, 9))
                    background = roundedBackground(SURFACE2, 12, blendSurfaceColor(PURPLE, MUTED, 0.45f), 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 7) }
                }
                card.addView(txt(line.optString("product_title", "Oferta"), 11f, TEXT, bold = true, bot = 3))
                val priceText = if (source == "ETECSA") "${formatCatalogPrice(price)} CUP" else "${formatCatalogPrice(price)} CUP · ${formatCatalogPrice(line.optLong("price_saldo", 0L))} Saldo Móvil"
                card.addView(txt(priceText, 9f, TEXT2, bot = 5))
                val remove = btn("QUITAR ESTA OFERTA").apply {
                    isAllCaps = false; textSize = 9f; setTextColor(TEXT); background = roundedBackground(SURFACE, 9, ERR, 1)
                    setOnClickListener {
                        val old = loadLocalCartItems()
                        val replacement = JSONArray()
                        for (n in 0 until old.length()) {
                            val existing = old.optJSONObject(n) ?: continue
                            if (existing.optString("local_id") != line.optString("local_id")) replacement.put(existing)
                        }
                        saveLocalCartItems(replacement)
                        dialogCartDismissAndRefresh()
                    }
                }
                card.addView(remove)
                lineHost.addView(card)
            }
            estimate.text = "Subtotal estimado CUP: ${formatCatalogPrice(displaySubtotal)}"
        }
        val allGameMarket = (0 until items.length()).all { items.optJSONObject(it)?.optString("source") == "GAME_MARKET" }
        val allCupPriced = (0 until items.length()).all { (items.optJSONObject(it)?.optLong("price_cup", 0L) ?: 0L) > 0L }
        val allSaldoPriced = allGameMarket && (0 until items.length()).all { (items.optJSONObject(it)?.optLong("price_saldo", 0L) ?: 0L) > 0L }
        val choices = mutableListOf<CartPaymentChoice>()
        if (allCupPriced) {
            choices += CartPaymentChoice("Transferencia · CUP", "TRANSFERMOVIL", "CUP")
            if (allGameMarket) choices += CartPaymentChoice("Wallet · CUP", "WALLET", "CUP")
        }
        if (allSaldoPriced) choices += CartPaymentChoice("Wallet · Saldo Móvil", "WALLET", "SALDO")
        val methodSpinner = Spinner(this).apply { adapter = darkSpinnerAdapter(choices.map { it.label }) }
        val payer = inp("Móvil pagador (solo transferencia CUP)", maxLen = 8, numeric = true).apply { setSingleLine(true) }
        val coupon = inp("Código de cupón (opcional; solo CUP)", maxLen = 64).apply { setSingleLine(true); filters = arrayOf(InputFilter.AllCaps()) }
        form.addView(txt("MÉTODO DE PAGO", 8f, PURPLE, bold = true, top = 5, bot = 3))
        if (choices.isEmpty()) {
            form.addView(txt("No hay una moneda con precio válido para todas las ofertas seleccionadas. Quita o sustituye las ofertas que no compartan una moneda de pago.", 10f, ERR, bot = 5))
        } else form.addView(methodSpinner)
        form.addView(payer)
        form.addView(coupon)
        methodSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val choice = choices.getOrNull(position)
                payer.visibility = if (choice?.method == "TRANSFERMOVIL") View.VISIBLE else View.GONE
                coupon.visibility = if (choice?.currency == "CUP") View.VISIBLE else View.GONE
                val subtotal = (0 until loadLocalCartItems().length()).sumOf { idx ->
                    val row = loadLocalCartItems().optJSONObject(idx)
                    (row?.optLong(if (choice?.currency == "SALDO") "price_saldo" else "price_cup", 0L) ?: 0L).coerceAtLeast(0L)
                }
                estimate.text = "Subtotal estimado ${choice?.currency ?: "CUP"}: ${formatCatalogPrice(subtotal)}${if (choice?.currency == "SALDO") " Saldo Móvil" else " CUP"} · el total final se validará en el servidor"
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        if (choices.isEmpty()) methodSpinner.visibility = View.GONE
        renderLines()
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(form) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Mi carrito (${items.length()})").setView(scroll)
            .setNegativeButton("Cerrar", null).setNeutralButton("Vaciar", null).setPositiveButton("Confirmar compra", null).create()
        cartDialog = dialog
        dialog.setOnDismissListener { if (cartDialog === dialog) cartDialog = null }
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                saveLocalCartItems(JSONArray())
                dialog.dismiss()
                showStoreCartPanel()
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val choice = choices.getOrNull(methodSpinner.selectedItemPosition)
                if (choice == null) { showSoToast("Elige ofertas compatibles para el mismo método de pago.", Toast.LENGTH_LONG); return@setOnClickListener }
                if (!isDeviceOnline()) { showSoToast("Conéctate para validar los precios y crear el pedido.", Toast.LENGTH_LONG); return@setOnClickListener }
                val payerValue = payer.text.toString().trim().replace(" ", "")
                if (choice.method == "TRANSFERMOVIL" && !Regex("^5\\d{7}$").matches(payerValue)) { payer.error = "Debe tener 8 dígitos y empezar por 5"; return@setOnClickListener }
                val cartItems = loadLocalCartItems()
                val requestItems = JSONArray()
                for (i in 0 until cartItems.length()) {
                    val row = cartItems.optJSONObject(i) ?: continue
                    requestItems.put(JSONObject().put("source", row.optString("source"))
                        .put("offer_id", row.optString("offer_id")).put("price_id", row.optString("price_id"))
                        .put("player_id", row.optString("player_id")).put("server_id", row.optString("server_id"))
                        .put("recipient", row.optString("recipient")).put("recipient_name", row.optString("recipient_name"))
                        .put("email", row.optString("email")))
                }
                if (requestItems.length() == 0) { showSoToast("El carrito está vacío.", Toast.LENGTH_SHORT); return@setOnClickListener }
                val idemKey = prefs.getString(PREF_CART_IDEMPOTENCY_KEY, null) ?: ("so-cart-" + UUID.randomUUID().toString()).also {
                    prefs.edit().putString(PREF_CART_IDEMPOTENCY_KEY, it).apply()
                }
                val payload = JSONObject().put("payment_method", choice.method).put("price_basis", choice.currency)
                    .put("items", requestItems).put("idempotency_key", idemKey)
                if (choice.method == "TRANSFERMOVIL") payload.put("payer_phone", payerValue)
                if (choice.currency == "CUP" && coupon.text.toString().trim().isNotBlank()) payload.put("coupon_code", coupon.text.toString().trim().uppercase(Locale.ROOT))
                fun submitCartOrder(destinationId: String? = null) {
                    if (choice.method == "TRANSFERMOVIL" && destinationId.isNullOrBlank()) {
                        showSoToast("Selecciona una cuenta receptora antes de crear el pedido.", Toast.LENGTH_LONG)
                        return
                    }
                    if (!destinationId.isNullOrBlank()) payload.put("payment_destination_id", destinationId)
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).text = "VALIDANDO…"
                    uiScope.launch {
                        val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/cart/orders", "POST", storeAccessToken(), payload) }.getOrNull() }
                        val json = runCatching { JSONObject(response?.body.orEmpty()) }.getOrNull() ?: JSONObject()
                        if (response != null && response.code in 200..299) {
                            val order = json.optJSONObject("order") ?: json
                            prefs.edit().remove(PREF_CART_ITEMS).remove(PREF_CART_IDEMPOTENCY_KEY).apply()
                            dialog.dismiss()
                            val id = order.optString("id", "").trim()
                            StoreStatusWorker.seedStatus(this@MainActivity, "CART", id, order.optString("status", "WAITING_PAYMENT"))
                            StoreStatusWorker.refreshNow(this@MainActivity)
                            showStoreReceiptDialog("CART", order, if (id.isBlank()) "" else "/api/store/cart/orders/$id")
                        } else {
                            val code = response?.code ?: 0
                            if (code in 400..499) prefs.edit().remove(PREF_CART_IDEMPOTENCY_KEY).apply()
                            showSoToast(json.optString("error", "No se pudo confirmar el carrito. No hagas una transferencia si no recibiste un ticket válido."), Toast.LENGTH_LONG)
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).text = "Confirmar compra"
                        }
                    }
                }
                if (choice.method == "TRANSFERMOVIL") {
                    choosePaymentDestinationForCheckout(storeAccessToken()) { destinationId -> submitCartOrder(destinationId) }
                } else submitCartOrder()
            }
        }
        dialog.show()
    }

    private fun dialogCartDismissAndRefresh() {
        cartDialog?.dismiss()
        cartDialog = null
        showStoreCartPanel()
    }

    private fun beginOfferCheckout(item: GameCatalogItem, offer: GameOfferItem) {
        if (!isDeviceOnline()) {
            showSoToast("La compra requiere conexión a Internet.", Toast.LENGTH_LONG)
            return
        }
        val etecsaMeta = offer.packageData.optJSONObject("etecsa")
        if (etecsaMeta != null) {
            beginEtecsaCheckout(item, offer, etecsaMeta)
            return
        }
        val providerMeta = offer.packageData.optJSONObject("rechargegames")
        if (!offer.providerConnected) {
            ThemedAlertDialogBuilder(this).setTitle("Compra no conectada")
                .setMessage("Esta oferta no está asociada a un producto verificable del proveedor. No iniciaremos un cobro. Pide al administrador que la conecte al catálogo oficial.")
                .setPositiveButton("Entendido", null).show()
            return
        }
        val labels = mutableListOf<String>()
        val actions = mutableListOf<String>()
        if (offer.priceCup > 0L) {
            labels.add("Comprar con Wallet · ${formatCatalogPrice(offer.priceCup)} CUP")
            actions.add("WALLET_CUP")
            labels.add("Transferencia · ${formatCatalogPrice(offer.priceCup)} CUP")
            actions.add("TRANSFER_CUP")
        }
        if (offer.priceSaldo > 0L) {
            labels.add("Comprar con Wallet · ${formatCatalogPrice(offer.priceSaldo)} Saldo Móvil")
            actions.add("WALLET_SALDO")
        }
        if (labels.isEmpty()) {
            ThemedAlertDialogBuilder(this).setTitle("Precio no disponible")
                .setMessage("El proveedor no tiene una tarifa de venta válida para CUP ni para Saldo Móvil. No iniciaremos un cobro.")
                .setPositiveButton("Cerrar", null).show()
            return
        }
        ThemedAlertDialogBuilder(this).setTitle(item.name + " · " + offer.title)
            .setItems(labels.toTypedArray()) { _, choice ->
                when (actions[choice]) {
                    "WALLET_CUP" -> showGameRechargeDetailsDialog(item, offer, walletCurrency = "CUP")
                    "WALLET_SALDO" -> showGameRechargeDetailsDialog(item, offer, walletCurrency = "SALDO")
                    else -> showGameRechargeDetailsDialog(item, offer, walletCurrency = null)
                }
            }
            .setNegativeButton("Cancelar", null).show()
    }

    // null means a direct Transfermóvil ticket; CUP/SALDO use separate Wallet ledgers.
    private fun showGameRechargeDetailsDialog(item: GameCatalogItem, offer: GameOfferItem, walletCurrency: String?, addToCart: Boolean = false) {
        val useWallet = walletCurrency != null && !addToCart
        val selectedAmount = if (walletCurrency == "SALDO") offer.priceSaldo else offer.priceCup
        if (useWallet && selectedAmount <= 0L) {
            showSoToast("Esta oferta no tiene precio para la moneda de Wallet seleccionada.", Toast.LENGTH_LONG)
            return
        }
        val form = ll().apply {
            setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 4))
        }
        val player = inp("ID del jugador", maxLen = 120).apply { setSingleLine(true) }
        val providerProduct = offer.packageData.optJSONObject("rechargegames")
        val providerGameSlug = providerProduct?.optString("game_slug", "").orEmpty().trim()
        val providerKeyParts = providerProduct?.optString("product_key", "").orEmpty().split('/')
        val providerRegionSlug = providerKeyParts.getOrNull(2)?.trim()?.takeIf { it.isNotBlank() }
            ?: providerProduct?.optString("region_slug", "").orEmpty().trim()
        val requiresPlayer = !providerProduct?.optString("delivery", "player_id").equals("code", ignoreCase = true)
        val needsServer = item.name.contains("mobile legends", true) || item.name.contains("mobile legend", true) ||
            providerGameSlug.contains("mobile-legends", true) || providerGameSlug.contains("mobile_legends", true)
        val server = inp("ID de servidor / zona (según el juego)", maxLen = 80).apply { setSingleLine(true) }
        val payer = inp("Móvil cubano que enviará la transferencia", maxLen = 8, numeric = true).apply { setSingleLine(true) }
        val coupon = inp("Código de cupón (opcional)", maxLen = 64).apply { setSingleLine(true); filters = arrayOf(InputFilter.AllCaps()) }
        if (!addToCart && walletCurrency != "SALDO") {
            form.addView(txt("CUPÓN DE DESCUENTO (OPCIONAL)", 8f, PURPLE, bold = true, top = 8, bot = 3))
            form.addView(coupon)
        }
        var regionBlockedPlayerId = ""
        val checkoutMessage = when {
            addToCart -> "Esta oferta se añadirá al carrito. Más adelante elegirás un único método de pago para todo el pedido. El servidor comprobará de nuevo el precio antes de cobrar."
            walletCurrency == "CUP" -> "Se descontará ${formatCatalogPrice(offer.priceCup)} CUP de tu Wallet CUP. La Wallet Saldo Móvil es independiente."
            walletCurrency == "SALDO" -> "Se descontará ${formatCatalogPrice(offer.priceSaldo)} unidades de Saldo Móvil de tu Wallet Saldo Móvil. No se convierte a CUP."
            else -> "El ticket Transfermóvil se cobra únicamente en CUP (${formatCatalogPrice(offer.priceCup)} CUP). El precio de Saldo Móvil no se interpreta como dinero CUP."
        }
        form.addView(txt(checkoutMessage, 10f, TEXT2, bot = 8))
        if (requiresPlayer) {
            form.addView(txt("ID DEL JUGADOR", 8f, PURPLE, bold = true, bot = 3)); form.addView(player)
            if (providerGameSlug.isNotBlank() && providerRegionSlug.isNotBlank()) {
                val regionStatus = txt("Verificación opcional para juegos compatibles; no todos los juegos admiten esta comprobación.", 9f, MUTED, top = 5, bot = 4)
                val regionCheckButton = btn("VERIFICAR ID Y REGIÓN").apply {
                    textSize = 9f
                    isAllCaps = false
                    minHeight = dp(this@MainActivity, 42)
                    setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 8), dp(this@MainActivity, 8), dp(this@MainActivity, 8))
                }
                regionCheckButton.setOnClickListener {
                    val uid = player.text.toString().trim()
                    if (uid.isBlank()) { player.error = "Introduce el ID del jugador"; return@setOnClickListener }
                    if (uid.length > 32) { player.error = "El verificador admite IDs de hasta 32 caracteres"; return@setOnClickListener }
                    regionCheckButton.isEnabled = false
                    regionCheckButton.text = "VERIFICANDO…"
                    regionStatus.setTextColor(TEXT2)
                    regionStatus.text = "Comprobando los datos del jugador…"
                    uiScope.launch {
                        val response = withContext(Dispatchers.IO) {
                            runCatching {
                                backendRequest("/api/game-recharges/region-check", "POST", storeAccessToken(), JSONObject()
                                    .put("game", providerGameSlug).put("uid", uid).put("region", providerRegionSlug))
                            }.getOrNull()
                        }
                        regionCheckButton.isEnabled = true
                        regionCheckButton.text = "VERIFICAR ID Y REGIÓN"
                        val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() } ?: JSONObject()
                        if (response == null || response.code !in 200..299) {
                            regionStatus.setTextColor(ERR)
                            regionStatus.text = json.optString("error", "No se pudo verificar la región. Comprueba tu conexión o continúa con cuidado.")
                            return@launch
                        }
                        val result = json.optString("result", "UNVERIFIED").uppercase(Locale.ROOT)
                        val actualRegion = json.optString("actual_region", "").takeUnless { it == "null" }.orEmpty()
                        regionBlockedPlayerId = if (result == "WRONG_REGION" || result == "UID_NOT_FOUND") uid else ""
                        when (result) {
                            "OK" -> { regionStatus.setTextColor(GREEN); regionStatus.text = "ID y región verificados${if (actualRegion.isNotBlank()) ": $actualRegion" else ""}." }
                            "EXISTS" -> { regionStatus.setTextColor(GREEN); regionStatus.text = "La cuenta existe. Confirma que la región seleccionada sea correcta${if (actualRegion.isNotBlank()) " ($actualRegion)" else ""}." }
                            "WRONG_REGION" -> { regionStatus.setTextColor(ERR); regionStatus.text = "La región de esta cuenta no coincide con el paquete${if (actualRegion.isNotBlank()) ". Región detectada: $actualRegion" else ""}. Vuelve y elige la región correcta." }
                            "UID_NOT_FOUND" -> { regionStatus.setTextColor(ERR); regionStatus.text = "No se pudo verificar este ID. Revísalo antes de comprar." }
                            "NO_LOCK" -> { regionStatus.setTextColor(PURPLE); regionStatus.text = "El proveedor no detectó bloqueo regional para esta cuenta; verifica los datos del juego." }
                            "UNSUPPORTED" -> { regionStatus.setTextColor(MUTED); regionStatus.text = "Este juego no permite verificar la región automáticamente. Introduce los datos con cuidado." }
                            else -> { regionStatus.setTextColor(MUTED); regionStatus.text = "El proveedor no pudo confirmar la región. Comprueba el ID antes de continuar." }
                        }
                    }
                }
                form.addView(regionCheckButton)
                form.addView(regionStatus)
            }
        }
        if (needsServer) {
            form.addView(txt("ID DE SERVIDOR DEL JUGADOR", 8f, PURPLE, bold = true, top = 8, bot = 3))
            form.addView(server)
            form.addView(txt("La región del paquete se elige en el catálogo y determina los precios. Este campo es el ID de servidor asociado a tu cuenta dentro del juego; introduce el identificador que muestra el juego.", 9f, MUTED, top = 4))
        }
        if (!useWallet && !addToCart) {
            form.addView(txt("MÓVIL PAGADOR", 8f, PURPLE, bold = true, top = 8, bot = 3)); form.addView(payer)
        }
        val dialog = ThemedAlertDialogBuilder(this).setTitle(if (addToCart) "Añadir oferta al carrito" else "Datos de la recarga")
            .setView(form).setNegativeButton("Cancelar", null).setPositiveButton(if (addToCart) "Añadir" else "Continuar", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val playerId = player.text.toString().trim()
                val serverId = server.text.toString().trim()
                val payerPhone = payer.text.toString().trim().replace(" ", "")
                if (requiresPlayer && playerId.isBlank()) { player.error = "Introduce el ID del jugador"; return@setOnClickListener }
                if (regionBlockedPlayerId.isNotBlank() && regionBlockedPlayerId == playerId) {
                    showSoToast("Corrige el ID o vuelve y elige la región adecuada antes de comprar.", Toast.LENGTH_LONG)
                    return@setOnClickListener
                }
                if (needsServer && serverId.isBlank()) { server.error = "Introduce el ID del servidor/zona"; return@setOnClickListener }
                if (!addToCart && !useWallet && !Regex("^5\\d{7}$").matches(payerPhone)) { payer.error = "Debe tener 8 dígitos y empezar por 5"; return@setOnClickListener }
                if (addToCart) {
                    val cartLine = JSONObject().put("local_id", UUID.randomUUID().toString()).put("source", "GAME_MARKET")
                        .put("offer_id", offer.id).put("product_title", "${item.name} · ${offer.title}")
                        .put("price_cup", offer.priceCup).put("price_saldo", offer.priceSaldo)
                        .put("player_id", playerId).put("server_id", serverId)
                    dialog.dismiss()
                    addLocalCartItem(cartLine)
                    return@setOnClickListener
                }
                val couponCode = if (walletCurrency == "SALDO") "" else coupon.text.toString().trim().uppercase(Locale.ROOT)
                dialog.dismiss()
                if (useWallet) beginGameRechargeWalletCheckout(item, offer, playerId, serverId, walletCurrency ?: "CUP", couponCode)
                else beginGameRechargeCheckout(item, offer, playerId, serverId, payerPhone, couponCode)
            }
        }
        dialog.show()
    }

    private fun beginGameRechargeWalletCheckout(item: GameCatalogItem, offer: GameOfferItem, playerId: String, serverId: String, currency: String, couponCode: String = "") {
        val token = storeAccessToken()
        if (token.isBlank()) { showSoToast("Activa una sesión de tienda antes de comprar.", Toast.LENGTH_LONG); return }
        // Keep the key on-device until the server gives a definite response. This makes a retry safe if the HTTP response is lost.
        val normalizedCurrency = if (currency == "SALDO") "SALDO" else "CUP"
        val idempotencyScope = "wallet_game_order_idempotency_${normalizedCurrency}_${offer.id}"
        val idempotencyKey = prefs.getString(idempotencyScope, null) ?: ("so-" + UUID.randomUUID().toString()).also {
            prefs.edit().putString(idempotencyScope, it).apply()
        }
        val payload = JSONObject().put("offer_id", offer.id).put("price_basis", normalizedCurrency)
            .put("idempotency_key", idempotencyKey).put("player_id", playerId).put("server_id", serverId)
        if (couponCode.isNotBlank()) payload.put("coupon_code", couponCode)
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/wallet/game-orders", "POST", token, payload) }.getOrNull() }
            if (response == null || response.code >= 500 || response.code == 0) {
                // Keep the same key on transport/5xx errors; a retry must not reserve Wallet funds twice.
                showSoToast("No se pudo confirmar la respuesta. Reintenta con seguridad: se conservará el mismo intento de compra.", Toast.LENGTH_LONG)
                return@launch
            }
            val json = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
            if (response.code in 200..299) {
                prefs.edit().remove(idempotencyScope).apply()
                val order = json.optJSONObject("order") ?: json
                val id = order.optString("id", "").trim()
                if (id.isNotBlank()) {
                    StoreStatusWorker.seedStatus(this@MainActivity, "GAMEMARKET", id, order.optString("status", "SUBMITTING_TO_PROVIDER"))
                    StoreStatusWorker.refreshNow(this@MainActivity)
                }
                showStoreReceiptDialog("GAMEMARKET", order, if (id.isBlank()) "" else "/api/game-recharges/orders/$id")
            } else {
                // The server returned a definite 4xx; this intent did not succeed and can be replaced.
                if (response.code in 400..499) prefs.edit().remove(idempotencyScope).apply()
                showSoToast(json.optString("error", "La compra con Wallet no se completó."), Toast.LENGTH_LONG)
            }
        }
    }

    private fun beginGameRechargeCheckout(item: GameCatalogItem, offer: GameOfferItem, playerId: String, serverId: String, payerPhone: String, couponCode: String = "") {
        val token = storeAccessToken()
        choosePaymentDestinationForCheckout(token) { destinationId ->
            val payload = JSONObject().put("offer_id", offer.id).put("price_basis", "CUP")
                .put("player_id", playerId).put("server_id", serverId).put("payer_phone", payerPhone)
                .put("payment_destination_id", destinationId)
            if (couponCode.isNotBlank()) payload.put("coupon_code", couponCode)
            uiScope.launch {
                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-recharges/orders", "POST", token, payload) }.getOrNull() }
                if (response == null) { showSoToast("No se pudo crear el ticket. Comprueba el historial antes de volver a pagar.", Toast.LENGTH_LONG); return@launch }
                val json = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
                if (response.code in 200..299) {
                    val order = json.optJSONObject("order") ?: json
                    val id = order.optString("id", "").trim()
                    if (id.isNotBlank()) {
                        StoreStatusWorker.seedStatus(this@MainActivity, "GAMEMARKET", id, order.optString("status", "WAITING_PAYMENT"))
                        StoreStatusWorker.refreshNow(this@MainActivity)
                    }
                    showStoreReceiptDialog("GAMEMARKET", order, if (id.isBlank()) "" else "/api/game-recharges/orders/$id")
                } else showSoToast(json.optString("error", "No se pudo crear el ticket de pago."), Toast.LENGTH_LONG)
            }
        }
    }

    private fun beginEtecsaCheckout(item: GameCatalogItem, offer: GameOfferItem, meta: JSONObject, addToCart: Boolean = false) {
        val token = storeAccessToken()
        val form = ll().apply { setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 4)) }
        val recipient = inp(if (meta.optString("type") == "nauta") "Cuenta Nauta del destinatario" else "Móvil cubano que recibirá la recarga", maxLen = 191).apply { setSingleLine(true) }
        val email = inp("Correo electrónico (si lo exige el paquete)", maxLen = 191).apply { setSingleLine(true); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        val payer = inp("Móvil pagador (8 dígitos, empieza por 5)", maxLen = 8, numeric = true).apply { setSingleLine(true) }
        val coupon = inp("Código de cupón (opcional)", maxLen = 64).apply { setSingleLine(true); filters = arrayOf(InputFilter.AllCaps()) }
        form.addView(txt("Selecciona el destinatario y confirma el importe antes de pagar. La transferencia se verifica por el ticket y el importe exacto en CUP.", 10f, TEXT2, bot = 8))
        form.addView(txt("DESTINATARIO", 8f, PURPLE, bold = true, bot = 3)); form.addView(recipient)
        form.addView(txt("CORREO", 8f, PURPLE, bold = true, top = 8, bot = 3)); form.addView(email)
        if (!addToCart) {
            form.addView(txt("MÓVIL PAGADOR", 8f, PURPLE, bold = true, top = 8, bot = 3)); form.addView(payer)
            form.addView(txt("CUPÓN DE DESCUENTO (OPCIONAL)", 8f, PURPLE, bold = true, top = 8, bot = 3)); form.addView(coupon)
        } else {
            form.addView(txt("La oferta se añadirá al carrito. Elegirás el método de pago y el cupón al revisar el pedido completo.", 10f, TEXT2, top = 8, bot = 3))
        }
        val dialog = ThemedAlertDialogBuilder(this).setTitle(if (addToCart) "Añadir oferta ETECSA" else offer.title).setView(form).setNegativeButton("Cancelar", null).setPositiveButton(if (addToCart) "Añadir" else "Elegir precio", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val dest = recipient.text.toString().trim()
                val emailText = email.text.toString().trim()
                val payerText = payer.text.toString().trim().replace(" ", "")
                if (dest.isBlank()) { recipient.error = "Introduce el destinatario"; return@setOnClickListener }
                if (meta.optString("type") == "recharge" && !Regex("^5\\d{7}$").matches(dest)) { recipient.error = "El móvil debe tener 8 dígitos y empezar por 5"; return@setOnClickListener }
                if (!addToCart && !Regex("^5\\d{7}$").matches(payerText)) { payer.error = "El móvil pagador debe tener 8 dígitos y empezar por 5"; return@setOnClickListener }
                val requiredInputs = meta.optJSONArray("required_inputs")
                val emailRequired = meta.optBoolean("has_email", false) || (0 until (requiredInputs?.length() ?: 0)).any { requiredInputs?.optString(it).equals("email", ignoreCase = true) }
                if (emailRequired && !android.util.Patterns.EMAIL_ADDRESS.matcher(emailText).matches()) { email.error = "El paquete requiere un correo válido"; return@setOnClickListener }
                if (meta.optString("type").equals("nauta", ignoreCase = true) && emailRequired && !emailText.trim().lowercase(Locale.ROOT).endsWith("@nauta.com.cu")) { email.error = "El correo Nauta debe terminar en @nauta.com.cu"; return@setOnClickListener }
                // The current checkout is paid in CUP via the configured bank-transfer destination.
                // A mobile-balance quote is informational only until a verified balance-payment method exists.
                if (offer.priceCup <= 0) {
                    showSoToast("Esta oferta no tiene un precio CUP pagable. El precio en saldo móvil no se cobrará como CUP.", Toast.LENGTH_LONG)
                    return@setOnClickListener
                }
                if (addToCart) {
                    val cartLine = JSONObject().put("local_id", UUID.randomUUID().toString()).put("source", "ETECSA")
                        .put("offer_id", meta.optString("offer_id")).put("price_id", meta.optString("price_id"))
                        .put("product_title", offer.title).put("price_cup", offer.priceCup).put("price_saldo", 0L)
                        .put("recipient", dest).put("recipient_name", "").put("email", emailText)
                        .put("offer_type", meta.optString("type"))
                    dialog.dismiss()
                    addLocalCartItem(cartLine)
                    return@setOnClickListener
                }
                dialog.dismiss()
                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Confirmar pago en CUP")
                    .setItems(arrayOf("CUP · ${offer.priceCup}")) { _, _ ->
                        val basis = "CUP"
                        val payload = JSONObject().put("offer_id", meta.optString("offer_id"))
                            .put("price_id", meta.optString("price_id")).put("price_basis", basis).put("payer_phone", payerText)
                            .put("coupon_code", coupon.text.toString().trim().uppercase(Locale.ROOT))
                        choosePaymentDestinationForCheckout(token) { destinationId ->
                            payload.put("payment_destination_id", destinationId)
                            uiScope.launch {
                                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/etecsa/orders", "POST", token, payload) }.getOrNull() }
                                if (response == null) { showSoToast("No se recibió respuesta. Comprueba el estado del pedido antes de pagar.", Toast.LENGTH_LONG); return@launch }
                                val json = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
                                if (response.code in 200..299) {
                                    val order = json.optJSONObject("order") ?: json
                                    val id = order.optString("id", "").trim()
                                    if (id.isNotBlank()) {
                                        prefs.edit().putString("pending_etecsa_recipient_$id", dest).putString("pending_etecsa_email_$id", emailText).apply()
                                        StoreStatusWorker.seedStatus(this@MainActivity, "ETECSA", id, order.optString("status", "WAITING_PAYMENT"))
                                        StoreStatusWorker.refreshNow(this@MainActivity)
                                    }
                                    showStoreReceiptDialog("ETECSA", order, if (id.isBlank()) "" else "/api/etecsa/orders/$id")
                                } else showSoToast(json.optString("error", "No se pudo crear el ticket ETECSA."), Toast.LENGTH_LONG)
                            }
                        }
                    }.setNegativeButton("Cancelar", null).show()
            }
        }
        dialog.show()
    }

    private fun openWalletPanel() {
        if (!isDeviceOnline()) { showSoToast("Wallet requiere conexión.", Toast.LENGTH_LONG); return }
        val token = storeAccessToken()
        if (token.isBlank()) { showSoToast("Activa una sesión válida antes de usar Wallet.", Toast.LENGTH_LONG); return }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/wallet", token = token) }.getOrNull() }
            if (response == null || response.code !in 200..299) {
                val message = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrDefault("")
                showSoToast(message.ifBlank { "No se pudo cargar Wallet. Revisa la sesión de tienda." }, Toast.LENGTH_LONG)
                return@launch
            }
            val body = JSONObject(response.body)
            val next = body.optJSONObject("wallet") ?: body
            fun render(next: JSONObject, fetchBalance: Boolean = false) {
                if (fetchBalance) {
                    uiScope.launch {
                        val refreshed = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/wallet", token = token) }.getOrNull() }
                        if (refreshed != null && refreshed.code in 200..299) render(JSONObject(refreshed.body).optJSONObject("wallet") ?: JSONObject(refreshed.body), fetchBalance = false)
                        else showSoToast("No se pudo actualizar el saldo confirmado.", Toast.LENGTH_LONG)
                    }
                    return
                }
                val wallet = next.optJSONObject("wallet") ?: next
                // Saldo no confirmado: nunca convertir un campo ausente o inconsistente en 0 CUP.
                val balanceMissing = !wallet.has("balance_cup") || !wallet.has("balance_saldo")
                val balanceCup = wallet.optDouble("balance_cup", Double.NaN)
                val balanceSaldo = wallet.optDouble("balance_saldo", Double.NaN)
                val walletIntegrity = wallet.optJSONObject("integrity")
                val integrityHealthy = walletIntegrity?.optBoolean("healthy", false) == true
                val confirmed = !balanceMissing && balanceCup.isFinite() && balanceCup >= 0 && balanceSaldo.isFinite() && balanceSaldo >= 0 && integrityHealthy
                val balanceText = if (confirmed) "${formatCatalogPrice(balanceCup.toLong())} CUP\n${formatCatalogPrice(balanceSaldo.toLong())} Saldo Móvil" else "Saldos no confirmados"
                val integrityText = if (integrityHealthy) "Libro de movimientos CUP y Saldo Móvil: consistente" else "ALERTA: los saldos y el libro de movimientos requieren revisión. No realices compras hasta que se resuelva."
                val assistantWalletAdvice = if (!integrityHealthy) {
                    "SO Assistant recomienda no realizar compras ni nuevos depósitos hasta que el equipo revise la consistencia del saldo."
                } else {
                    "SO Assistant recuerda: CUP y Saldo Móvil son independientes. Antes de depositar, confirma que la automatización esté disponible y usa siempre un ticket vigente."
                }
                val message = "Saldos actuales independientes:\n$balanceText\n\n$integrityText\n\n✦ SO ASSISTANT\n$assistantWalletAdvice\n\nLos depósitos solo se acreditan después de conciliar el SMS real de la moneda correspondiente."
                val dialog = ThemedAlertDialogBuilder(this@MainActivity).setTitle("MI WALLET")
                    .setMessage(message).setPositiveButton("AÑADIR FONDOS", null)
                    .setNeutralButton("🔄 ACTUALIZAR", null).setNegativeButton("HISTORIAL", null).create()
                dialog.setOnShowListener {
            styleSoDialog(dialog)
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { dialog.dismiss(); chooseWalletTopupCurrency() }
                    dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { dialog.dismiss(); render(JSONObject(), fetchBalance = true) }
                    dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener { dialog.dismiss(); openStoreHistory() }
                }
                dialog.show()
            }
            render(next, fetchBalance = false)
        }
    }

    private fun chooseWalletTopupCurrency() {
        ThemedAlertDialogBuilder(this).setTitle("¿Qué saldo quieres depositar?")
            .setItems(arrayOf("Depositar CUP · Transfermóvil", "Depositar Saldo Móvil · CUBACEL")) { _, choice ->
                beginWalletTopup(if (choice == 1) "SALDO" else "CUP")
            }.setNegativeButton("Cancelar", null).show()
    }

    private fun beginWalletTopup(currency: String) {
        ensureAutomationAvailableForTransfer { beginWalletTopupForm(currency) }
    }

    private fun beginWalletTopupForm(currency: String) {
        val isSaldo = currency == "SALDO"
        val form = ll().apply { setPadding(dp(this@MainActivity, 18), dp(this@MainActivity, 8), dp(this@MainActivity, 18), dp(this@MainActivity, 4)) }
        val amountLabel = if (isSaldo) "Importe en Saldo Móvil (100–1.000.000)" else "Importe en CUP (100–1.000.000)"
        val amount = inp(amountLabel, maxLen = 7, numeric = true).apply { setSingleLine(true) }
        val phone = inp("Móvil cubano desde el que pagarás", maxLen = 8, numeric = true).apply { setSingleLine(true) }
        val depositInstructions = if (isSaldo)
            "Se creará un ticket en Saldo Móvil. Envía exactamente esa cantidad CUBACEL al número receptor que mostrará el ticket. El SMS del teléfono receptor debe estar supervisado por SMS Relay. No se convierte a CUP."
        else
            "Se creará un ticket CUP para pagar por Transfermóvil. No se acreditará saldo hasta que los SMS y los datos de la transferencia coincidan."
        form.addView(txt(depositInstructions, 10f, TEXT2, bot = 8))
        form.addView(amount); form.addView(space(8)); form.addView(phone)
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Añadir fondos a Wallet").setView(form).setNegativeButton("Cancelar", null).setPositiveButton("Crear ticket", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val amountValue = amount.text.toString().trim().toLongOrNull()
                val payerPhone = phone.text.toString().trim().replace(" ", "")
                if (amountValue == null || amountValue !in 100L..1_000_000L) { amount.error = "Importe fuera del rango permitido"; return@setOnClickListener }
                if (!Regex("^5\\d{7}$").matches(payerPhone)) { phone.error = "Debe tener 8 dígitos y empezar por 5"; return@setOnClickListener }
                dialog.dismiss()
                val token = storeAccessToken()
                fun submitTopup(destinationId: String? = null) {
                    uiScope.launch {
                        val payload = JSONObject().put("currency", currency).put("payer_phone", payerPhone)
                        payload.put(if (isSaldo) "amount_saldo" else "amount_cup", amountValue)
                        if (!destinationId.isNullOrBlank()) payload.put("payment_destination_id", destinationId)
                        val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/wallet/topups", "POST", token, payload) }.getOrNull() }
                        if (response == null) { showSoToast("No se pudo comprobar si el ticket se creó. Revisa el historial antes de intentarlo otra vez.", Toast.LENGTH_LONG); return@launch }
                        val json = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
                        if (response.code in 200..299) {
                            val topup = json.optJSONObject("topup") ?: json
                            val id = topup.optString("id", "").trim()
                            if (id.isNotBlank()) {
                                StoreStatusWorker.seedStatus(this@MainActivity, "WALLET", id, topup.optString("status", "WAITING_PAYMENT"))
                                StoreStatusWorker.refreshNow(this@MainActivity)
                            }
                            showStoreReceiptDialog("WALLET", topup, if (id.isBlank()) "" else "/api/store/wallet/topups/$id/refresh", "POST")
                        } else showSoToast(json.optString("error", "No se pudo crear el ticket."), Toast.LENGTH_LONG)
                    }
                }
                if (isSaldo) submitTopup() else choosePaymentDestinationForCheckout(token) { submitTopup(it) }
            }
        }
        dialog.show()
    }

    private fun loadStoreAnnouncements(host: LinearLayout) {
        host.removeAllViews()
        if (!isDeviceOnline()) return
        val token = storeAccessToken()
        if (token.isBlank()) return
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/announcements", token = token) }.getOrNull() }
            if (response == null || response.code !in 200..299) {
                android.util.Log.w("SynthesisOne_Store", "Avisos de tienda no disponibles; code=${response?.code ?: 0}")
                return@launch
            }
            val announcements = runCatching { JSONObject(response.body).optJSONArray("announcements") ?: JSONArray() }.getOrDefault(JSONArray())
            host.removeAllViews()
            for (index in 0 until announcements.length()) {
                val item = announcements.optJSONObject(index) ?: continue
                val title = item.optString("title", "Aviso de la tienda").trim().take(100)
                val message = item.optString("message", "").trim().take(1500)
                if (title.isBlank() || message.isBlank()) continue
                val severity = item.optString("severity", "INFO").uppercase(Locale.ROOT)
                val accent = if (severity == "WARN") Color.parseColor("#E7A844") else if (severity == "PROMO") PURPLE else Color.parseColor("#3C7EAB")
                val card = ll().apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 10), dp(this@MainActivity, 12), dp(this@MainActivity, 10))
                    background = roundedBackground(SURFACE2, 12, accent, 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 7) }
                }
                card.addView(txt(title, 10f, TEXT, bold = true))
                card.addView(txt(message, 9f, TEXT2, top = 4))
                host.addView(card)
            }
        }
    }

    private fun openStoreHistory() {
        val token = storeAccessToken()
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/store/history", token = token) }.getOrNull() }
            if (response == null || response.code !in 200..299) { showSoToast("No se pudo cargar el historial oficial de la tienda.", Toast.LENGTH_LONG); return@launch }
            val entries = JSONObject(response.body).optJSONArray("entries") ?: JSONArray()
            if (entries.length() == 0) { ThemedAlertDialogBuilder(this@MainActivity).setTitle("Historial de la tienda").setMessage("Todavía no hay movimientos registrados.").setPositiveButton("Cerrar", null).show(); return@launch }
            val historyContent = ll().apply { setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 8), dp(this@MainActivity, 12), dp(this@MainActivity, 8)) }
            val historyScroll = ScrollView(this@MainActivity).apply { addView(historyContent); isFillViewport = true }
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                val source = entry.optString("source", "MOVIMIENTO")
                val title = entry.optString("title", "Operación")
                val status = entry.optString("status", "—")
                val receipt = entry.optString("receipt_code", entry.optString("id", ""))
                val card = ll().apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 11), dp(this@MainActivity, 12), dp(this@MainActivity, 11))
                    background = roundedBackground(SURFACE, 12, Color.parseColor("#2A3043"), 1)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 8) }
                }
                card.addView(txt("$source · $title", 11f, TEXT, bold = true))
                card.addView(txt("$status · $receipt", 9f, TEXT2, top = 4))
                card.setOnClickListener { showStoreReceiptDialog(entry) }
                historyContent.addView(card)
            }
            ThemedAlertDialogBuilder(this@MainActivity).setTitle("Historial oficial")
                .setView(historyScroll).setNegativeButton("Cerrar", null).show()
        }
    }

    private fun showStoreReceiptDialog(entry: JSONObject) {
        val source = entry.optString("source", "").uppercase(Locale.ROOT)
        val id = entry.optString("ticket_id", entry.optString("id", "")).trim()
        val endpoint = when (source) {
            "ETECSA" -> if (id.isNotBlank()) "/api/etecsa/orders/$id" else ""
            "GAMEMARKET" -> if (id.isNotBlank()) "/api/game-recharges/orders/$id" else ""
            "WALLET" -> if (id.isNotBlank()) "/api/store/wallet/topups/$id/refresh" else ""
            "CART" -> if (id.isNotBlank()) "/api/store/cart/orders/$id" else ""
            else -> ""
        }
        val method = if (source == "WALLET") "POST" else "GET"
        if (source == "GAMEMARKET" && endpoint.isNotBlank() && isDeviceOnline()) {
            uiScope.launch {
                val response = withContext(Dispatchers.IO) {
                    runCatching { backendRequest(endpoint, method, storeAccessToken()) }.getOrNull()
                }
                val json = response?.let { runCatching { JSONObject(it.body) }.getOrNull() }
                val latest = if (response != null && response.code in 200..299) json?.optJSONObject("order") ?: json else null
                if (latest != null) showStoreReceiptDialog(source, latest, endpoint, method)
                else showStoreReceiptDialog(source, entry, endpoint, method)
            }
            return
        }
        showStoreReceiptDialog(source, entry, endpoint, method)
    }

    private fun showStoreReceiptDialog(source: String, order: JSONObject, endpoint: String, method: String = "GET") {
        val id = order.optString("id", order.optString("ticket_id", "")).trim()
        val ticket = order.optString("ticket", order.optString("receipt_code", id)).ifBlank { id }
        val status = order.optString("status", "UNKNOWN")
        val payment = order.optJSONObject("payment")
        val currency = order.optString("currency", "CUP").trim().uppercase(Locale.ROOT).let { if (it == "SALDO") "SALDO" else "CUP" }
        val amount = order.optDouble(if (currency == "SALDO") "amount_saldo" else "amount_cup", order.optDouble("amount", Double.NaN))
        val amountUnit = if (currency == "SALDO") "Saldo Móvil" else "CUP"
        val amountText = if (amount.isFinite()) "\nImporte: ${formatCatalogPrice(amount.toLong())} $amountUnit" else ""
        val paymentMethod = payment?.optString("method", "").orEmpty().uppercase(Locale.ROOT)
        val nestedCard = payment?.optString("card", "").orEmpty().takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val nestedPhone = payment?.optString("confirmation_phone", "").orEmpty().takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val topCard = order.optString("destination_card", "").takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val topPhone = order.optString("confirmation_phone", "").takeUnless { it.equals("null", ignoreCase = true) }.orEmpty()
        val destinationCard = nestedCard.ifBlank { topCard }.trim()
        val confirmationPhone = nestedPhone.ifBlank { topPhone }.trim()
        val isWaitingPayment = status.equals("WAITING_PAYMENT", ignoreCase = true)
        val transferDetailsMissing = source == "GAMEMARKET" && isWaitingPayment && (destinationCard.isBlank() || confirmationPhone.isBlank())
        val paymentText = when {
            source == "CART" && order.optString("payment_source").equals("TRANSFERMOVIL", ignoreCase = true) -> "\nMóvil pagador: ${order.optString("payer_phone", "—")}\nTarjeta destino: ${order.optString("destination_card", "—")}\nTeléfono de confirmación: ${order.optString("confirmation_phone", "—")}\n\nRealiza una sola transferencia por el importe exacto de este carrito."
            source == "CART" && order.optString("payment_source").equals("WALLET", ignoreCase = true) -> "\nEste carrito se pagó con Wallet. No realices otra transferencia."
            paymentMethod == "CUBACEL" -> "\nNúmero CUBACEL receptor: ${payment?.optString("receiver_phone", confirmationPhone).orEmpty().ifBlank { "—" }}\n\nEnvía el importe exacto en Saldo Móvil. El saldo solo se acredita tras verificar el SMS del receptor."
            transferDetailsMissing -> "\n\n⚠️ NO TRANSFIERAS TODAVÍA: no se recibió la tarjeta ni el teléfono de confirmación de este ticket. No envíes dinero; contacta con soporte o actualiza más tarde."
            source == "GAMEMARKET" && isWaitingPayment -> "\nMóvil pagador: ${order.optString("payer_phone", "—")}\nTarjeta destino: ${destinationCard.ifBlank { "—" }}\nTeléfono de confirmación: ${confirmationPhone.ifBlank { "—" }}\n\nRealiza la transferencia únicamente por el importe exacto de este ticket."
            payment != null -> "\nTarjeta destino: ${destinationCard.ifBlank { "—" }}\nTeléfono de confirmación: ${confirmationPhone.ifBlank { "—" }}\n\nRealiza la transferencia únicamente con los datos de este ticket."
            else -> ""
        }
        val note = order.optString("message", order.optString("failure_reason", ""))
        val basis = order.optString("price_basis", "").trim().uppercase(Locale.ROOT)
        val paymentSource = order.optString("payment_source", "").trim().uppercase(Locale.ROOT)
        val basisText = when {
            source == "WALLET" && currency == "SALDO" -> "\nMoneda: Wallet Saldo Móvil. Se acreditará en un libro separado del saldo CUP."
            source == "WALLET" && currency == "CUP" -> "\nMoneda: Wallet CUP."
            paymentSource == "WALLET" && basis == "SALDO" -> "\nCompra descontada de Wallet Saldo Móvil."
            paymentSource == "WALLET" -> "\nCompra descontada de Wallet CUP."
            basis == "CUP" -> "\nTarifa: CUP. El importe del ticket debe transferirse en CUP."
            else -> ""
        }
        val cartDiscountText = if (source == "CART") {
            val subtotal = order.optDouble("base_subtotal", Double.NaN)
            val discount = order.optDouble("discount_amount", 0.0)
            (if (subtotal.isFinite()) "\nSubtotal: ${formatCatalogPrice(subtotal.toLong())} $amountUnit" else "") +
                (if (discount > 0.0) "\nDescuento aplicado: −${formatCatalogPrice(discount.toLong())} $amountUnit" else "")
        } else ""
        val providerDelivery = order.optString("provider_delivery", "").trim().lowercase(Locale.ROOT)
        val providerStatus = order.optString("provider_status", "").trim().lowercase(Locale.ROOT)
        val deliveryNote = order.optString("delivery_note", "").takeUnless { it.equals("null", ignoreCase = true) }.orEmpty().trim()
        val redeemCodeReady = source == "GAMEMARKET" && providerDelivery == "code" && deliveryNote.isNotBlank() &&
            (status.equals("COMPLETED", ignoreCase = true) || providerStatus == "delivered")
        val deliveryText = when {
            redeemCodeReady -> "\n\nCÓDIGO DE CANJE\n$deliveryNote\n\nGuarda este código. Puedes volver a copiarlo desde el historial de la tienda."
            source == "GAMEMARKET" && providerDelivery == "code" && status.uppercase(Locale.ROOT) in listOf("WAITING_PAYMENT", "SUBMITTING_TO_PROVIDER", "PROCESSING", "FULFILLMENT_REVIEW") -> "\n\nEl código de canje aparecerá aquí cuando el proveedor confirme la entrega."
            deliveryNote.isNotBlank() -> "\n\nDetalle de entrega: $deliveryNote"
            else -> ""
        }
        val baseMessage = "Ticket: $ticket\nEstado: $status$cartDiscountText$amountText$basisText\n${if (note.isNotBlank()) "\n$note" else ""}$paymentText$deliveryText\n\nNo vuelvas a pagar un ticket pendiente sin comprobar primero su estado."
        val receiptContent = ll().apply {
            setPadding(dp(this@MainActivity, 5), dp(this@MainActivity, 4), dp(this@MainActivity, 5), dp(this@MainActivity, 4))
        }
        receiptContent.addView(txt(baseMessage, 11f, TEXT2, bot = 10))
        val canCopyDestination = destinationCard.isNotBlank() && confirmationPhone.isNotBlank() &&
            paymentMethod != "CUBACEL" && !transferDetailsMissing
        if (canCopyDestination) {
            receiptContent.addView(txt("DATOS DE ESTA CUENTA RECEPTORA", 9f, PURPLE, bold = true, top = 4, bot = 6))
            val copyRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            copyRow.addView(btn("COPIAR TARJETA").apply {
                textSize = 9f; isAllCaps = false
                layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f).apply { marginEnd = dp(this@MainActivity, 5) }
                setOnClickListener { copyPaymentValue("Tarjeta receptora", destinationCard) }
            })
            copyRow.addView(btn("COPIAR NÚMERO").apply {
                textSize = 9f; isAllCaps = false
                layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f).apply { marginStart = dp(this@MainActivity, 5) }
                setOnClickListener { copyPaymentValue("Número de confirmación", confirmationPhone) }
            })
            receiptContent.addView(copyRow)
        }
        val receiptScroll = ScrollView(this).apply {
            isFillViewport = false
            addView(receiptContent)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val dialog = ThemedAlertDialogBuilder(this).setTitle(when (source) { "ETECSA" -> "Recarga ETECSA"; "GAMEMARKET" -> "Compra Game Market"; "CART" -> "Compra de carrito"; "WALLET" -> "Recarga de Wallet"; else -> "Comprobante" })
            .setView(receiptScroll).setNeutralButton("🔄 ACTUALIZAR", null).setPositiveButton(if (redeemCodeReady) "COPIAR CÓDIGO" else "COPIAR ID", null).setNegativeButton("Cerrar", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                if (redeemCodeReady) {
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Código de canje", deliveryNote))
                    showSoToast("Código de canje copiado.", Toast.LENGTH_SHORT)
                } else {
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("ID SynthesisOne", ticket))
                    showSoToast("ID copiado: $ticket", Toast.LENGTH_SHORT)
                }
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener {
                if (endpoint.isBlank() || id.isBlank()) { showSoToast("Este movimiento no tiene un ticket actualizable.", Toast.LENGTH_SHORT); return@setOnClickListener }
                dialog.dismiss()
                uiScope.launch {
                    val token = storeAccessToken()
                    val response = withContext(Dispatchers.IO) { runCatching { backendRequest(endpoint, method, token) }.getOrNull() }
                    if (response == null || response.code !in 200..299) {
                        val errorText = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrDefault("")
                        showSoToast(errorText.ifBlank { "No se pudo actualizar el ticket." }, Toast.LENGTH_LONG)
                        showStoreReceiptDialog(source, order, endpoint, method)
                        return@launch
                    }
                    val refreshed = JSONObject(response.body)
                    var latest = refreshed.optJSONObject("order") ?: refreshed.optJSONObject("topup") ?: refreshed
                    if (source == "WALLET" && refreshed.has("wallet")) {
                        val wallet = refreshed.optJSONObject("wallet") ?: JSONObject()
                        latest.put("wallet_balance_cup", if (wallet.has("balance_cup")) wallet.optDouble("balance_cup", Double.NaN) else JSONObject.NULL)
                        latest.put("wallet_balance_saldo", if (wallet.has("balance_saldo")) wallet.optDouble("balance_saldo", Double.NaN) else JSONObject.NULL)
                    }
                    if (source == "ETECSA" && latest.optString("status") == "PAYMENT_RECEIVED_WAITING_DETAILS") {
                        val recipient = prefs.getString("pending_etecsa_recipient_$id", "").orEmpty()
                        val email = prefs.getString("pending_etecsa_email_$id", "").orEmpty()
                        if (recipient.isNotBlank()) {
                            val recipientPayload = JSONObject().put("recipient", recipient).put("email", email)
                            val submit = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/etecsa/orders/$id/recipient", "POST", token, recipientPayload) }.getOrNull() }
                            if (submit != null && submit.code in 200..299) {
                                latest = JSONObject(submit.body).optJSONObject("order") ?: latest
                                prefs.edit().remove("pending_etecsa_recipient_$id").remove("pending_etecsa_email_$id").apply()
                            } else {
                                showSoToast("El pago se detectó. No se pudo enviar el destinatario todavía; comprueba la conexión y actualiza otra vez.", Toast.LENGTH_LONG)
                            }
                        } else {
                            val requirements = latest.optJSONObject("requirements")
                            val requiredInputs = requirements?.optJSONArray("required_inputs")
                            val emailRequired = requirements?.optBoolean("has_email", false) == true || (0 until (requiredInputs?.length() ?: 0)).any { requiredInputs?.optString(it).equals("email", ignoreCase = true) }
                            showEtecsaRecipientDialog(id, latest.optString("offer_type").equals("nauta", ignoreCase = true) && emailRequired)
                            return@launch
                        }
                    }
                    StoreStatusWorker.seedStatus(this@MainActivity, source, id, latest.optString("status", "UNKNOWN"))
                    StoreStatusWorker.refreshNow(this@MainActivity)
                    showStoreReceiptDialog(source, latest, endpoint, method)
                }
            }
        }
        dialog.show()
    }

    private fun showEtecsaRecipientDialog(orderId: String, nautaEmailRequired: Boolean = false) {
        val form = ll().apply { setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 6), dp(this@MainActivity, 16), dp(this@MainActivity, 4)) }
        val recipient = inp("Número/cuenta destinataria", maxLen = 191).apply { setSingleLine(true) }
        val email = inp("Correo si el paquete lo requiere", maxLen = 191).apply { setSingleLine(true); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        form.addView(recipient); form.addView(space(8)); form.addView(email)
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Pago ETECSA confirmado · destinatario").setMessage("El pago fue detectado. Introduce los datos para enviar la recarga al proveedor.").setView(form).setNegativeButton("Ahora no", null).setPositiveButton("Enviar datos", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val dest = recipient.text.toString().trim(); val mail = email.text.toString().trim()
                if (dest.isBlank()) { recipient.error = "Campo obligatorio"; return@setOnClickListener }
                if (nautaEmailRequired && !mail.lowercase(Locale.ROOT).endsWith("@nauta.com.cu")) { email.error = "El correo Nauta debe terminar en @nauta.com.cu"; return@setOnClickListener }
                uiScope.launch {
                    val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/etecsa/orders/$orderId/recipient", "POST", storeAccessToken(), JSONObject().put("recipient", dest).put("email", mail)) }.getOrNull() }
                    if (response != null && response.code in 200..299) {
                        dialog.dismiss()
                        val order = JSONObject(response.body).optJSONObject("order") ?: JSONObject(response.body)
                        prefs.edit().remove("pending_etecsa_recipient_$orderId").remove("pending_etecsa_email_$orderId").apply()
                        showStoreReceiptDialog("ETECSA", order, "/api/etecsa/orders/$orderId")
                    } else showSoToast(runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrDefault("No se pudieron enviar los datos."), Toast.LENGTH_LONG)
                }
            }
        }
        dialog.show()
    }

    private fun refreshRemoteProfileCache() {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank() || !isDeviceOnline()) return
        uiScope.launch {
            if (prefs.getBoolean(PREF_LAYOUT_SYNC_PENDING, false)) {
                val layout = selectedLayoutStyle()
                val savedLayout = withContext(Dispatchers.IO) {
                    runCatching { backendRequest("/api/game-market/profile", "PUT", token, JSONObject().put("layout_style", layout)) }.getOrNull()
                }
                if (savedLayout != null && savedLayout.code in 200..299) prefs.edit().putBoolean(PREF_LAYOUT_SYNC_PENDING, false).apply()
            }
            if (prefs.getBoolean(PREF_PROFILE_SYNC_PENDING, false)) {
                val localAge = prefs.getString(PREF_PROFILE_AGE, "").orEmpty().toIntOrNull()
                val localPayload = JSONObject().apply {
                    put("display_name", prefs.getString(PREF_PROFILE_NAME, "").orEmpty())
                    put("username", prefs.getString(PREF_PROFILE_USERNAME, "").orEmpty().removePrefix("@"))
                    put("age", if (localAge != null && localAge in 1..120) localAge else JSONObject.NULL)
                    put("province", prefs.getString(PREF_PROFILE_PROVINCE, "").orEmpty())
                    put("municipality", prefs.getString(PREF_PROFILE_MUNICIPALITY, "").orEmpty())
                    put("theme", prefs.getString(PREF_THEME, "violet").orEmpty())
                    put("layout_style", selectedLayoutStyle())
                    put("display_name_public", prefs.getBoolean(PREF_PROFILE_DISPLAY_NAME_PUBLIC, false))
                    put("avatar_public", prefs.getBoolean(PREF_PROFILE_AVATAR_PUBLIC, false))
                    put("age_public", prefs.getBoolean(PREF_PROFILE_AGE_PUBLIC, false))
                    put("location_public", prefs.getBoolean(PREF_PROFILE_LOCATION_PUBLIC, false))
                }
                val saved = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile", "PUT", token, localPayload) }.getOrNull() }
                if (saved != null && saved.code in 200..299) prefs.edit().putBoolean(PREF_PROFILE_SYNC_PENDING, false).apply()
            }
            var response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile", token = token) }.getOrNull() } ?: return@launch
            if (response.code !in 200..299) return@launch
            var profile = runCatching { JSONObject(response.body).optJSONObject("profile") }.getOrNull() ?: return@launch
            if (!profile.optBoolean("local_data_imported", false)) {
                val localAge = prefs.getString(PREF_PROFILE_AGE, "").orEmpty().toIntOrNull()
                val import = JSONObject().apply {
                    put("display_name", prefs.getString(PREF_PROFILE_NAME, "").orEmpty())
                    put("username", prefs.getString(PREF_PROFILE_USERNAME, "").orEmpty().removePrefix("@"))
                    put("age", if (localAge != null && localAge in 1..120) localAge else JSONObject.NULL)
                    put("province", prefs.getString(PREF_PROFILE_PROVINCE, "").orEmpty())
                    put("municipality", prefs.getString(PREF_PROFILE_MUNICIPALITY, "").orEmpty())
                    put("theme", prefs.getString(PREF_THEME, "violet").orEmpty())
                    put("layout_style", selectedLayoutStyle())
                    put("display_name_public", prefs.getBoolean(PREF_PROFILE_DISPLAY_NAME_PUBLIC, false))
                    put("avatar_public", prefs.getBoolean(PREF_PROFILE_AVATAR_PUBLIC, false))
                    put("age_public", prefs.getBoolean(PREF_PROFILE_AGE_PUBLIC, false))
                    put("location_public", prefs.getBoolean(PREF_PROFILE_LOCATION_PUBLIC, false))
                }
                val imported = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile/import-local", "POST", token, import) }.getOrNull() }
                if (imported != null && imported.code in 200..299) {
                    response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile", token = token) }.getOrNull() } ?: response
                    profile = runCatching { JSONObject(response.body).optJSONObject("profile") }.getOrNull() ?: profile
                }
            }
            val localPhoto = prefs.getString(PREF_PROFILE_PHOTO_URI, "").orEmpty()
            if ((prefs.getBoolean(PREF_PROFILE_AVATAR_PENDING, false) || profile.optString("avatar_url", "").isBlank()) && localPhoto.startsWith("content://") && isDeviceOnline()) {
                val upload = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile/avatar", "POST", token, imagePayloadFromUri(localPhoto)) }.getOrNull() }
                if (upload != null && upload.code in 200..299) {
                    profile = runCatching { JSONObject(upload.body).optJSONObject("profile") }.getOrNull() ?: profile
                    prefs.edit().putBoolean(PREF_PROFILE_AVATAR_PENDING, false).apply()
                }
            }
            val theme = profile.optString("theme", "violet").takeIf { it in setOf("violet", "light", "red", "green", "cyan", "gold", "ocean") } ?: "violet"
            val remoteLayout = profile.optString("layout_style", "hybrid").takeIf { it in setOf("hybrid", "professional", "glass", "minimal", "aurora", "arena", "soft") } ?: "hybrid"
            prefs.edit().apply {
                putString(PREF_PROFILE_NAME, profile.optString("display_name", prefs.getString(PREF_PROFILE_NAME, "").orEmpty()))
                putString(PREF_PROFILE_USERNAME, profile.optString("username", prefs.getString(PREF_PROFILE_USERNAME, "").orEmpty()).removePrefix("@"))
                if (profile.has("age") && !profile.isNull("age")) putString(PREF_PROFILE_AGE, profile.optInt("age").toString())
                putString(PREF_PROFILE_PROVINCE, profile.optString("province", prefs.getString(PREF_PROFILE_PROVINCE, "").orEmpty()))
                putString(PREF_PROFILE_MUNICIPALITY, profile.optString("municipality", prefs.getString(PREF_PROFILE_MUNICIPALITY, "").orEmpty()))
                putString(PREF_PROFILE_AVATAR_URL, profile.optString("avatar_url", ""))
                putBoolean(PREF_PROFILE_DISPLAY_NAME_PUBLIC, profile.optBoolean("display_name_public", false))
                putBoolean(PREF_PROFILE_AVATAR_PUBLIC, profile.optBoolean("avatar_public", false))
                putBoolean(PREF_PROFILE_AGE_PUBLIC, profile.optBoolean("age_public", false))
                putBoolean(PREF_PROFILE_LOCATION_PUBLIC, profile.optBoolean("location_public", false))
                putString(PREF_THEME, theme)
                if (profile.has("layout_style") && !prefs.getBoolean(PREF_LAYOUT_SYNC_PENDING, false)) putString(PREF_LAYOUT_STYLE, remoteLayout)
            }.apply()
        }
    }

    private fun imagePayloadFromUri(uriText: String, prefix: String? = null): JSONObject {
        val uri = android.net.Uri.parse(uriText)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri).use { stream ->
            if (stream == null) throw IllegalStateException("No se puede leer la imagen seleccionada")
            BitmapFactory.decodeStream(stream, null, bounds)
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("La imagen seleccionada no es válida")
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1200) sample *= 2
        val decoded = contentResolver.openInputStream(uri).use { stream ->
            if (stream == null) throw IllegalStateException("No se puede abrir la imagen")
            BitmapFactory.decodeStream(stream, null, BitmapFactory.Options().apply { inSampleSize = sample })
                ?: throw IllegalStateException("No se pudo decodificar la imagen")
        }
        val maxEdge = maxOf(decoded.width, decoded.height)
        val scaled = if (maxEdge > 1000) {
            val factor = 1000f / maxEdge
            Bitmap.createScaledBitmap(decoded, (decoded.width * factor).toInt().coerceAtLeast(1), (decoded.height * factor).toInt().coerceAtLeast(1), true)
        } else decoded
        val out = java.io.ByteArrayOutputStream()
        var quality = 78
        do {
            out.reset(); scaled.compress(Bitmap.CompressFormat.JPEG, quality, out); quality -= 6
        } while (out.size() > 1_350_000 && quality >= 36)
        if (scaled !== decoded) scaled.recycle()
        decoded.recycle()
        if (out.size() > 1_500_000) throw IllegalStateException("La foto sigue siendo demasiado grande después de optimizarla")
        val payload = JSONObject()
        val b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
        if (prefix == null) payload.put("content_type", "image/jpeg").put("image_base64", b64)
        else payload.put("${prefix}_content_type", "image/jpeg").put("${prefix}_base64", b64)
        return payload
    }

    private fun applyRemotePricingToPrefs(pricing: JSONObject, tier: String) {
        val cup = pricing.optDouble("usd_to_cup", 1050.0)
        val saldo = pricing.optDouble("usd_to_saldo", 380.0)
        val margin = pricing.optDouble("profit_margin_pct", 0.0)
        val cupStep = pricing.optDouble("cup_rounding_step", 5.0).toInt().coerceAtLeast(1)
        val saldoStep = pricing.optDouble("saldo_rounding_step", 1.0).toInt().coerceAtLeast(1)
        val mode = pricing.optString("rounding_mode", "ceil")
        prefs.edit().putString("so_rate_usd_cup_$tier", cup.toString())
            .putString("so_rate_usd_saldo_$tier", saldo.toString())
            .putString("so_market_margin_$tier", margin.toString())
            .putInt("so_market_rounding_cup_$tier", cupStep)
            .putInt("so_market_rounding_saldo_$tier", saldoStep)
            .putString("so_market_rounding_mode_$tier", mode).apply()
        if (tier == "normal") {
            prefs.edit().putInt(PREF_RATE_USD_CUP, cup.toInt()).putInt(PREF_RATE_USD_SALDO, saldo.toInt())
                .putString(PREF_MARKET_MARGIN, margin.toString()).putInt(PREF_MARKET_ROUNDING, cupStep).apply()
        }
    }

    private fun uploadMarketImage(token: String, uriText: String): JSONObject? {
        return try {
            val response = backendRequest("/api/game-market/admin/images", "POST", token, imagePayloadFromUri(uriText))
            if (response.code in 200..299) JSONObject(response.body) else null
        } catch (_: Exception) { null }
    }

    private fun adminMarketRequest(token: String, path: String, method: String, payload: JSONObject? = null): BackendResponse =
        backendRequest("/api/game-market/admin$path", method, token, payload)

    private fun pollResellerStatus(showNotifications: Boolean) {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank() || !isDeviceOnline()) return
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/reseller/status", token = token) }.getOrNull() } ?: return@launch
            if (response.code !in 200..299) return@launch
            val json = runCatching { JSONObject(response.body) }.getOrNull() ?: return@launch
            val app = json.optJSONObject("application")
            val status = app?.optString("status", "not_reseller")?.takeIf { it.isNotBlank() } ?: json.optJSONObject("reseller")?.optString("status", "not_reseller") ?: "not_reseller"
            val depositPaymentStatus = app?.optString("deposit_payment_status", "NOT_DETECTED")?.uppercase(Locale.ROOT) ?: "NOT_DETECTED"
            val previousDepositStatus = prefs.getString(PREF_RESELLER_DEPOSIT_LAST_SEEN, "").orEmpty()
            if (showNotifications && depositPaymentStatus == "PAYMENT_DETECTED_PENDING_ADMIN" && previousDepositStatus != depositPaymentStatus) {
                NotificationService.showAppEventNotification(
                    this@MainActivity,
                    "Depósito SO Reseller confirmado",
                    "Detectamos el depósito requerido en tu Wallet. El equipo de SO debe revisarlo y aprobarlo manualmente; tus precios reseller todavía no están activados.",
                    "reseller-deposit-pending-admin-${app?.optString("deposit_topup_id", "wallet") ?: "wallet"}",
                    true
                )
            }
            if (depositPaymentStatus.isNotBlank()) prefs.edit().putString(PREF_RESELLER_DEPOSIT_LAST_SEEN, depositPaymentStatus).apply()
            val previous = prefs.getString(PREF_RESELLER_STATUS_LAST_SEEN, "").orEmpty()
            if (showNotifications && previous.isNotBlank() && previous != status) {
                val (title, detail, success) = when (status) {
                    "approved_awaiting_deposit" -> Triple("KYC SO Reseller aprobado", "Tu documentación fue aprobada. El equipo debe verificar el saldo de trabajo de 50.000 CUP antes de activar los precios reseller.", true)
                    "active" -> Triple("SO Reseller activado", "Tu acceso a los precios especiales está activo. Actualiza Game Market para ver los precios reseller.", true)
                    "rejected" -> Triple("Solicitud SO Reseller revisada", app?.optString("review_note", "Revisa los detalles en Ajustes.") ?: "Revisa los detalles en Ajustes.", false)
                    "pending_review" -> Triple("SO Reseller en revisión", "Tu solicitud está en revisión manual. El plazo orientativo de respuesta es de 24–48 horas.", true)
                    else -> Triple("Estado SO Reseller actualizado", "Tu estado actual es: $status", status == "active")
                }
                NotificationService.showAppEventNotification(this@MainActivity, title, detail, "reseller-$status-${System.currentTimeMillis()}", success)
            }
            prefs.edit().putString(PREF_RESELLER_STATUS_LAST_SEEN, status).apply()
        }
    }

    private fun pollAdminResellerCount() {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank() || !isDeviceOnline()) return
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/admin/reseller/pending-count", token = token) }.getOrNull() } ?: return@launch
            if (response.code !in 200..299) return@launch
            val json = runCatching { JSONObject(response.body) }.getOrNull() ?: return@launch
            val count = json.optInt("pending_count", 0)
            val seen = prefs.getInt(PREF_ADMIN_RESELLER_PENDING_SEEN, -1)
            if (seen >= 0 && count > seen) {
                NotificationService.showAppEventNotification(this@MainActivity, "Nueva solicitud SO Reseller", "Hay ${count - seen} nueva(s) solicitud(es) pendiente(s) de revisión manual.", "admin-reseller-pending-$count", true)
            }
            prefs.edit().putInt(PREF_ADMIN_RESELLER_PENDING_SEEN, count).apply()
        }
    }

    private fun resellerStatusLabel(status: String): String = when (status) {
        "pending_review" -> "Solicitud enviada · revisión manual pendiente"
        "changes_requested" -> "Se necesitan correcciones · revisa la nota del equipo"
        "approved_awaiting_deposit" -> "KYC aprobado · falta verificar el depósito de trabajo"
        "active" -> "SO Reseller activo · precios especiales habilitados"
        "rejected" -> "Solicitud revisada · consulta el motivo para volver a solicitarlo"
        "suspended" -> "Cuenta reseller suspendida · contacta con soporte"
        "expired" -> "Condición reseller expirada"
        else -> "Todavía no has solicitado SO Reseller"
    }

    private fun showResellerIntro() {
        if (!isDeviceOnline()) {
            showSoToast("Necesitas conexión para solicitar SO Reseller.", Toast.LENGTH_LONG)
            return
        }
        rootFrame.removeAllViews()
        val scroll = ScrollView(this)
        val content = ll().apply { setPadding(dp(this@MainActivity, 20), dp(this@MainActivity, 34), dp(this@MainActivity, 20), dp(this@MainActivity, 28)) }
        scroll.addView(content)
        content.addView(futuristicBackButton("←  VOLVER A AJUSTES") { showConfig() })
        content.addView(txt("SYNTHESISONE · GAME MARKET", 9f, PURPLE, bold=true, ls=.14f, top=14, bot=7))
        content.addView(txt("SO Reseller", 29f, TEXT, bold=true, bot=6))
        content.addView(txt("Precios especiales para quienes trabajan con recargas digitales.", 13f, TEXT2, bot=18))

        fun infoCard(title: String, text: String, accent: Int = RED) {
            val card = ll().apply {
                setPadding(dp(this@MainActivity, 14), dp(this@MainActivity, 13), dp(this@MainActivity, 14), dp(this@MainActivity, 13))
                background = roundedBackground(SURFACE, 15, Color.parseColor("#30384E"), 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 10) }
            }
            card.addView(txt(title, 12f, accent, bold=true, bot=6))
            card.addView(txt(text, 11f, TEXT2))
            content.addView(card)
        }
        infoCard("¿QUÉ VENTAJAS TIENE?", "Acceso a precios reservados para resellers en las ofertas que tengan activa esta modalidad. Las diferencias orientativas pueden ser de 10, 50 o 100 CUP, y mayores en algunos paquetes grandes. No todas las ofertas tienen descuento fijo ni se garantiza un ahorro concreto.", PURPLE)
        infoCard("REQUISITOS DE SOLICITUD", "• Carnet cubano: foto por delante y por detrás.\n• Foto tuya sosteniendo el carnet y una hoja blanca que diga exactamente “SO Reseller”.\n• Número de las tarjetas y teléfonos que utilizarás.\n• Revisión manual del equipo de SynthesisOne antes de activar la modalidad.")
        infoCard("DEPÓSITO DE TRABAJO: 50.000 CUP", "El depósito mínimo se solicita después de que el KYC sea aprobado. No es un pago ni una comisión por convertirte en reseller: el dinero debe mantenerse íntegro en tu wallet como fondo para realizar las recargas. No se descontará una tarifa por activación.", GREEN)
        infoCard("RETIROS NO DISPONIBLES POR AHORA", "La función de retirar fondos todavía no está habilitada. Las limitaciones operativas de las transferencias en Cuba pueden dificultar atender retiros de muchos usuarios o de importes elevados. Antes de depositar, debes aceptar que el saldo está destinado a las operaciones admitidas dentro del servicio y que no existe retirada general disponible en esta versión.", Color.parseColor("#FFC56E"))
        infoCard("ACTIVIDAD MÍNIMA", "Una vez activado, se requiere un mínimo de 15 ventas válidas cada mes. Las ventas fallidas, canceladas o duplicadas no cuentan. Si no se alcanza el mínimo, la cuenta podrá revisarse conforme a las condiciones del programa.")
        infoCard("REVISIÓN MANUAL · 24–48 HORAS", "Después de enviar los documentos recibirás una respuesta en la aplicación. El plazo habitual previsto es de 24–48 horas, aunque puede ampliarse si el equipo necesita comprobar datos o solicitar una corrección.", PURPLE)
        content.addView(txt("Somos un proyecto hecho por cubanos para usuarios cubanos. Explicamos las condiciones de forma directa: los descuentos no son exagerados, pero pueden ayudarte si realizas recargas con frecuencia. Solicitarlo es opcional.", 11f, TEXT2, top=3, bot=15))
        content.addView(btn("INICIAR SOLICITUD KYC").apply {
            textSize = 11f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 12, RED, 0)
            setOnClickListener { showResellerApplicationForm() }
        })
        content.addView(btn("AHORA NO").apply {
            textSize = 10f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 12, MUTED, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 44)).apply { topMargin = dp(this@MainActivity, 8) }
            setOnClickListener { showConfig() }
        })
        rootFrame.addView(scroll)
    }

    private fun showResellerApplicationForm() {
        if (!isDeviceOnline()) { showSoToast("Conéctate a Internet para enviar el KYC.", Toast.LENGTH_LONG); return }
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) { showSoToast("Necesitas una sesión autorizada para solicitar SO Reseller.", Toast.LENGTH_LONG); return }
        rootFrame.removeAllViews()
        resellerPhotoStatusViews.clear()
        resellerPhotoPreviewViews.clear()
        resellerPhotoCardViews.clear()
        resellerPhotoButtonViews.clear()
        val scroll = ScrollView(this)
        val content = ll().apply { setPadding(dp(this@MainActivity, 20), dp(this@MainActivity, 30), dp(this@MainActivity, 20), dp(this@MainActivity, 30)) }
        scroll.addView(content)
        content.addView(futuristicBackButton("←  INFORMACIÓN SO RESELLER") { showResellerIntro() })
        content.addView(txt("SOLICITUD KYC", 9f, PURPLE, bold=true, ls=.14f, top=16, bot=6))
        content.addView(txt("Verificación de identidad", 24f, TEXT, bold=true, bot=5))
        content.addView(txt("Las imágenes y los datos serán revisados únicamente por el equipo autorizado. Envía solo la información solicitada para el programa.", 11f, TEXT2, bot=14))
        content.addView(lbl("TARJETAS QUE UTILIZARÁS", top=4))
        val cards = inp("Una tarjeta por línea (puedes añadir varias)", multiline=true, maxLen=160).apply { minLines = 2; setText(prefs.getString("so_reseller_cards_draft", "").orEmpty()) }
        content.addView(cards)
        content.addView(lbl("TELÉFONOS QUE UTILIZARÁS", top=10))
        val phones = inp("Un teléfono por línea", multiline=true, maxLen=100).apply { minLines = 2; setText(prefs.getString("so_reseller_phones_draft", "").orEmpty()) }
        content.addView(phones)
        content.addView(lbl("TELÉFONO DE CONTACTO", top=10))
        val contactPhone = inp("Teléfono de contacto", maxLen=20, numeric=true).apply { setText(prefs.getString("phone_number", "").orEmpty()) }
        content.addView(contactPhone)

        content.addView(txt("DOCUMENTOS QUE DEBES ADJUNTAR", 9f, PURPLE, bold=true, ls=.10f, top=14, bot=3))
        content.addView(txt("Cada recuadro identifica una fotografía distinta. Verás una miniatura y el estado cuando la añadas; las imágenes se envían solo al presentar la solicitud.", 10f, TEXT2, bot=6))
        fun pickerRow(label: String, req: Int, key: String, title: String): LinearLayout {
            val savedUri = prefs.getString(key, "").orEmpty()
            val selected = savedUri.isNotBlank()
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10))
                background = roundedBackground(Color.parseColor("#101A28"), 13, if (selected) GREEN else Color.parseColor("#344259"), 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(this@MainActivity, 7)
                }
                minimumHeight = dp(this@MainActivity, 104)
            }
            resellerPhotoCardViews[req] = row
            val previewFrame = FrameLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 70), dp(this@MainActivity, 84)).apply {
                    marginEnd = dp(this@MainActivity, 11)
                }
                background = roundedBackground(Color.parseColor("#1B2939"), 9, if (selected) GREEN else Color.parseColor("#3A4863"), 1)
                clipToOutline = true
            }
            val preview = ImageView(this).apply {
                layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                scaleType = ImageView.ScaleType.FIT_CENTER
                setPadding(dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2))
                contentDescription = label
                if (selected) {
                    val loaded = runCatching { setImageURI(android.net.Uri.parse(savedUri)); drawable != null }.getOrDefault(false)
                    if (!loaded) {
                        setImageResource(android.R.drawable.ic_menu_camera)
                        setColorFilter(TEXT2)
                    }
                } else {
                    setImageResource(android.R.drawable.ic_menu_camera)
                    setColorFilter(TEXT2)
                }
            }
            previewFrame.addView(preview)
            resellerPhotoPreviewViews[req] = preview

            val left = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
            left.addView(txt(label.uppercase(Locale.ROOT), 8.5f, PURPLE, bold=true, ls=.06f, bot=4))
            left.addView(txt(title, 12f, TEXT, bold=true, bot=3))
            val requiredHint = when (req) {
                REQUEST_RESELLER_ID_FRONT -> "Carnet cubano · lado del frente, completo y legible."
                REQUEST_RESELLER_ID_BACK -> "Carnet cubano · lado del reverso, completo y legible."
                else -> "Sostén tu carnet y una hoja blanca donde se lea claramente: SO Reseller."
            }
            left.addView(txt(requiredHint, 9f, TEXT2, bot=5))
            val statusView = txt(
                if (selected) "✓ IMAGEN AÑADIDA\nLISTA PARA ENVIAR" else "PENDIENTE · AÑADE ESTA FOTO",
                8f, if (selected) GREEN else Color.parseColor("#FFC56E"), bold=true
            ).apply {
                maxLines = 2
                setPadding(dp(this@MainActivity, 7), dp(this@MainActivity, 5), dp(this@MainActivity, 7), dp(this@MainActivity, 5))
                background = pillBackground(if (selected) Color.parseColor("#164136") else Color.parseColor("#4A3822"), 18)
            }
            left.addView(statusView)
            resellerPhotoStatusViews[req] = statusView

            val choose = btn(if (selected) "CAMBIAR" else "ELEGIR FOTO").apply {
                textSize = 8f
                isAllCaps = false
                setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 7), dp(this@MainActivity, 8), dp(this@MainActivity, 7))
                setTextColor(TEXT); background = roundedBackground(SURFACE2, 9, PURPLE, 1)
                contentDescription = if (selected) "Cambiar: $label" else "Elegir: $label"
                setOnClickListener { openImagePicker(req) }
            }
            resellerPhotoButtonViews[req] = choose
            row.addView(previewFrame)
            row.addView(left)
            row.addView(choose, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = dp(this@MainActivity, 7)
            })
            return row
        }
        content.addView(pickerRow("1 · CARNET DELANTE", REQUEST_RESELLER_ID_FRONT, PREF_RESELLER_ID_FRONT_URI, "Anverso del carnet cubano"))
        content.addView(pickerRow("2 · CARNET DETRÁS", REQUEST_RESELLER_ID_BACK, PREF_RESELLER_ID_BACK_URI, "Reverso del carnet cubano"))
        content.addView(pickerRow("3 · FOTO TUYA + CARNET", REQUEST_RESELLER_SELFIE, PREF_RESELLER_SELFIE_URI, "Carnet y hoja blanca: SO Reseller"))
        val terms = CheckBox(this).apply {
            text = "Confirmo que soy el titular de los documentos, que los datos son correctos y que leí las condiciones de SO Reseller, incluidas la revisión manual, el depósito de trabajo y la ausencia de retiros en esta versión."
            setTextColor(TEXT2); textSize = 10.5f; setPadding(0, dp(this@MainActivity, 12), 0, dp(this@MainActivity, 12))
        }
        content.addView(terms)
        val status = txt("", 10f, TEXT2, top=4, bot=8)
        content.addView(status)
        content.addView(btn("ENVIAR SOLICITUD PARA REVISIÓN").apply {
            textSize = 10f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 12, RED, 0)
            setOnClickListener {
                if (!terms.isChecked) { status.setTextColor(ERR); status.text = "Debes aceptar las condiciones para continuar."; return@setOnClickListener }
                if (!isDeviceOnline()) { status.setTextColor(ERR); status.text = "No hay conexión. Los documentos no se han enviado."; return@setOnClickListener }
                val front = prefs.getString(PREF_RESELLER_ID_FRONT_URI, "").orEmpty()
                val back = prefs.getString(PREF_RESELLER_ID_BACK_URI, "").orEmpty()
                val selfie = prefs.getString(PREF_RESELLER_SELFIE_URI, "").orEmpty()
                if (front.isBlank() || back.isBlank() || selfie.isBlank()) { status.setTextColor(ERR); status.text = "Selecciona las tres fotografías requeridas."; return@setOnClickListener }
                fun splitValues(text: String) = text.split(Regex("[,;\\n\\r]+")).map { it.trim() }.filter { it.isNotBlank() }.distinct().take(5)
                val cardList = splitValues(cards.text.toString())
                val phoneList = splitValues(phones.text.toString())
                if (cardList.isEmpty() || phoneList.isEmpty()) { status.setTextColor(ERR); status.text = "Introduce al menos una tarjeta y un teléfono."; return@setOnClickListener }
                val submitButton = it as Button
                submitButton.isEnabled = false; submitButton.text = "OPTIMIZANDO Y ENVIANDO…"
                status.setTextColor(MUTED); status.text = "Comprimiendo las imágenes y enviando los documentos privados…"
                uiScope.launch {
                    val response = withContext(Dispatchers.IO) {
                        runCatching {
                            val payload = JSONObject().apply {
                                put("accepted_terms", true)
                                put("contact_phone", contactPhone.text.toString().trim())
                                put("card_numbers", JSONArray(cardList))
                                put("phone_numbers", JSONArray(phoneList))
                            }
                            listOf("id_front" to front, "id_back" to back, "selfie_with_id" to selfie).forEach { (prefix, uri) ->
                                val image = imagePayloadFromUri(uri, prefix)
                                val keys = image.keys()
                                while (keys.hasNext()) { val key = keys.next(); payload.put(key, image.get(key)) }
                            }
                            backendRequest("/api/game-market/reseller/applications", "POST", token, payload)
                        }.getOrNull()
                    }
                    submitButton.isEnabled = true; submitButton.text = "ENVIAR SOLICITUD PARA REVISIÓN"
                    if (response != null && response.code in 200..299) {
                        val message = runCatching { JSONObject(response.body).optString("message") }.getOrNull().orEmpty()
                        prefs.edit().remove(PREF_RESELLER_ID_FRONT_URI).remove(PREF_RESELLER_ID_BACK_URI).remove(PREF_RESELLER_SELFIE_URI)
                            .putString(PREF_RESELLER_STATUS_LAST_SEEN, "pending_review").apply()
                        NotificationService.showAppEventNotification(this@MainActivity, "Solicitud SO Reseller enviada", "El equipo revisará tu propuesta. El plazo orientativo de respuesta es de 24–48 horas.", "reseller-application-${System.currentTimeMillis()}", true)
                        showSoToast(message.ifBlank { "Solicitud enviada. Respuesta prevista en 24–48 horas." }, Toast.LENGTH_LONG)
                        showDashboard()
                    } else {
                        val detail = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrNull().orEmpty()
                        android.util.Log.w("SO/Reseller", "No se pudo enviar la solicitud KYC: ${detail.take(180)}; HTTP=${response?.code}")
                        status.setTextColor(ERR)
                        status.text = when {
                            response?.code == 400 -> "Revisa que los datos estén completos y que las tres imágenes sean válidas."
                            response?.code == 401 || response?.code == 403 -> "Tu sesión necesita actualizarse. Vuelve a iniciar sesión e inténtalo otra vez."
                            response != null -> "No se pudo enviar la solicitud ahora mismo. Comprueba los datos e inténtalo de nuevo."
                            else -> "No se pudo conectar. Los documentos siguen guardados en este teléfono; inténtalo cuando tengas conexión."
                        }
                    }
                }
            }
        })
        rootFrame.addView(scroll)
    }

    private fun showResellerStatus() {
        if (!isDeviceOnline()) { showSoToast("Conéctate a Internet para consultar el estado más reciente.", Toast.LENGTH_LONG); return }
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) { showResellerIntro(); return }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/reseller/status", token = token) }.getOrNull() }
            if (response == null || response.code !in 200..299) {
                showSoToast("No se pudo actualizar el estado del programa reseller.", Toast.LENGTH_LONG); return@launch
            }
            val json = JSONObject(response.body)
            val app = json.optJSONObject("application")
            val reseller = json.optJSONObject("reseller")
            val status = app?.optString("status", "")?.takeIf { it.isNotBlank() } ?: reseller?.optString("status", "not_reseller") ?: "not_reseller"
            val note = app?.optString("review_note", "").orEmpty()
            val additional = when (status) {
                "pending_review" -> "El equipo revisará tu propuesta. El plazo orientativo de respuesta es de 24–48 horas. No realices un depósito para solicitar la revisión inicial."
                "changes_requested" -> "El equipo pidió correcciones antes de continuar. ${note.ifBlank { "Consulta los requisitos y vuelve a presentar la documentación." }} No realices el depósito hasta que el KYC esté aprobado."
                "approved_awaiting_deposit" -> "El KYC está aprobado. Falta que el equipo confirme el depósito mínimo de 50.000 CUP. El dinero no es una comisión, pero los retiros no están habilitados en esta versión."
                "active" -> "Ya tienes SO Reseller activo. Los precios especiales aparecen al actualizar Game Market. Ventas válidas registradas este mes: ${reseller?.optInt("monthly_sales_count", 0) ?: 0}/15. El recuento es manual y auditado mientras no exista un sistema de pedidos."
                "rejected" -> "La solicitud fue rechazada o necesita una nueva revisión. ${note.ifBlank { "Consulta soporte si necesitas más información." }}"
                else -> "Todavía no hay una solicitud registrada. Puedes consultar las condiciones y comenzar cuando quieras."
            }
            ThemedAlertDialogBuilder(this@MainActivity).setTitle("SO Reseller · ${resellerStatusLabel(status)}")
                .setMessage(additional)
                .setPositiveButton(if (status in setOf("not_reseller", "rejected", "changes_requested")) "Ver requisitos / corregir" else "Cerrar") { _, _ ->
                    if (status in setOf("not_reseller", "rejected", "changes_requested")) showResellerIntro()
                }
                .setNeutralButton("Actualizar Game Market") { _, _ -> refreshRemoteGameCatalog { showSoToast("Catálogo actualizado.", Toast.LENGTH_SHORT) } }
                .show()
            val previous = prefs.getString(PREF_RESELLER_STATUS_LAST_SEEN, "").orEmpty()
            if (previous.isNotBlank() && previous != status) {
                NotificationService.showAppEventNotification(this@MainActivity, "Estado SO Reseller actualizado", resellerStatusLabel(status), "reseller-status-${System.currentTimeMillis()}", status == "active" || status == "approved_awaiting_deposit")
            }
            prefs.edit().putString(PREF_RESELLER_STATUS_LAST_SEEN, status).apply()
        }
    }

    private fun showAdminResellerApplications(initialStatus: String = "pending_review") {
        if (!prefs.getString("client_role", "client").equals("admin", true)) {
            showSoToast("Esta sección es solo para administradores.", Toast.LENGTH_LONG); return
        }
        if (!isDeviceOnline()) { showSoToast("Necesitas conexión para revisar solicitudes KYC.", Toast.LENGTH_LONG); return }
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) return
        val content = ll().apply { setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 6), dp(this@MainActivity, 8), dp(this@MainActivity, 8)) }
        val scroll = ScrollView(this).apply { addView(content) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("SO Reseller · Revisión KYC").setView(scroll).setNegativeButton("Cerrar", null).create()
        var currentStatus = initialStatus
        fun openDocument(url: String?, title: String) {
            if (url.isNullOrBlank()) { showSoToast("El acceso temporal al documento expiró o no está disponible. Actualiza la lista.", Toast.LENGTH_LONG); return }
            val wrapper = FrameLayout(this).apply { setBackgroundColor(BG) }
            val image = ImageView(this).apply { layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 420)); scaleType = ImageView.ScaleType.FIT_CENTER }
            val loading = txt("Cargando documento privado…", 10f, TEXT2).apply { gravity = Gravity.CENTER; layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 420)) }
            wrapper.addView(image); wrapper.addView(loading)
            ThemedAlertDialogBuilder(this).setTitle(title).setView(wrapper).setPositiveButton("Cerrar", null).show()
            loadGameThumbnail(url, image, loading)
        }
        fun refreshRows() {
            content.removeAllViews()
            content.addView(txt("DOCUMENTACIÓN PRIVADA · SOLO ADMINISTRACIÓN", 9f, RED, bold=true, ls=.10f, bot=5))
            content.addView(txt("Los documentos se muestran mediante acceso privado temporal. No descargues ni compartas fotos fuera del proceso autorizado.", 10f, TEXT2, bot=8))
            val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            listOf("pending_review" to "PENDIENTES", "changes_requested" to "CORREGIR", "approved_awaiting_deposit" to "DEPÓSITO", "active" to "ACTIVOS", "rejected" to "RECHAZADOS").forEach { (status, label) ->
                tabs.addView(btn(label).apply {
                    textSize = 7.5f; isAllCaps = false; background = roundedBackground(if (status == currentStatus) RED else SURFACE2, 8, if (status == currentStatus) RED else MUTED, 1)
                    setOnClickListener { currentStatus = status; refreshRows() }
                }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginEnd = dp(this@MainActivity, 3) })
            }
            content.addView(tabs)
            content.addView(txt("Cargando solicitudes…", 10f, MUTED, top=10))
            uiScope.launch {
                val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/admin/reseller/applications?status=$currentStatus", token = token) }.getOrNull() }
                if (!content.isAttachedToWindow && dialog.isShowing.not()) return@launch
                content.removeAllViews()
                content.addView(txt("DOCUMENTACIÓN PRIVADA · SOLO ADMINISTRACIÓN", 9f, RED, bold=true, ls=.10f, bot=5))
                content.addView(tabs)
                if (response == null || response.code !in 200..299) {
                    content.addView(txt("No se pudo consultar la lista. Comprueba tu conexión y vuelve a intentarlo.", 11f, ERR, top=12)); return@launch
                }
                val json = JSONObject(response.body)
                val apps = json.optJSONArray("applications") ?: JSONArray()
                val count = json.optInt("pending_count", 0)
                val seen = prefs.getInt(PREF_ADMIN_RESELLER_PENDING_SEEN, -1)
                if (seen >= 0 && count > seen) NotificationService.showAppEventNotification(this@MainActivity, "Nueva solicitud SO Reseller", "Hay ${count - seen} nueva(s) solicitud(es) pendiente(s) de revisión.", "admin-reseller-open-$count", true)
                prefs.edit().putInt(PREF_ADMIN_RESELLER_PENDING_SEEN, count).apply()
                content.addView(txt("${apps.length()} solicitud(es) · respuesta informativa prevista: 24–48 horas", 10f, TEXT2, top=8, bot=6))
                for (i in 0 until apps.length()) {
                    val app = apps.optJSONObject(i) ?: continue
                    val id = app.optString("id")
                    val card = ll().apply {
                        setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 11), dp(this@MainActivity, 12), dp(this@MainActivity, 11))
                        background = roundedBackground(SURFACE, 13, Color.parseColor("#30384E"), 1)
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity, 8) }
                    }
                    card.addView(txt(app.optString("client_name", "Cliente"), 14f, TEXT, bold=true, bot=3))
                    card.addView(txt("ID: ${app.optString("client_id")} · ${app.optString("client_phone", "Sin teléfono")}", 9f, TEXT2, bot=3))
                    card.addView(txt("Tarjetas: ${app.optJSONArray("card_numbers")?.join(", ") ?: "—"}", 9f, TEXT2, bot=2))
                    card.addView(txt("Teléfonos: ${app.optJSONArray("phone_numbers")?.join(", ") ?: "—"}", 9f, TEXT2, bot=7))
                    val docs = app.optJSONObject("documents") ?: JSONObject()
                    val docRow = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
                    listOf("Carnet delante" to "id_front_url", "Carnet detrás" to "id_back_url", "Foto SO" to "selfie_url").forEach { (label, key) ->
                        docRow.addView(btn(label).apply {
                            textSize = 8f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, PURPLE, 1)
                            setOnClickListener { openDocument(docs.optString(key, ""), label) }
                        }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 38), 1f).apply { marginEnd = dp(this@MainActivity, 3) })
                    }
                    card.addView(docRow)
                    val status = app.optString("status", "")
                    val depositStatus = app.optString("deposit_payment_status", "NOT_DETECTED").uppercase(Locale.ROOT)
                    card.addView(txt("Estado: ${resellerStatusLabel(status)}", 9f, if (status == "active") GREEN else Color.parseColor("#FFC56E"), bold=true, top=6, bot=4))
                    val depositTopup = app.optString("deposit_topup_id", "")
                    val depositTx = app.optString("deposit_transaction_id", "")
                    val depositAt = app.optString("deposit_detected_at", "")
                    val depositText = when (depositStatus) {
                        "PAYMENT_DETECTED_PENDING_ADMIN" -> "Wallet: depósito ≥ mínimo detectado · pendiente de revisión manual. Ticket: ${depositTopup.take(12).ifBlank { "—" }} · Transacción: ${depositTx.ifBlank { "no informada" }}${if (depositAt.isNotBlank()) " · Fecha: $depositAt" else ""}"
                        "APPROVED" -> "Wallet: depósito revisado y aprobado por administración."
                        "REJECTED" -> "Wallet: depósito revisado y rechazado."
                        else -> "Wallet: todavía no se ha detectado una recarga elegible de 50.000 CUP o más."
                    }
                    card.addView(txt(depositText, 9f, if (depositStatus == "PAYMENT_DETECTED_PENDING_ADMIN") Color.parseColor("#FFC56E") else TEXT2, top=2, bot=6))
                    val note = app.optString("review_note", "")
                    if (note.isNotBlank()) card.addView(txt("Nota: $note", 10f, TEXT2, bot=5))
                    if (status == "active") {
                        val monthlySales = app.optInt("monthly_sales_count", 0)
                        card.addView(txt("Ventas válidas registradas este mes: $monthlySales / 15", 10f, if (monthlySales >= 15) GREEN else TEXT2, bold=true, top=3, bot=5))
                        card.addView(txt("El recuento es manual y auditado hasta que exista un sistema de pedidos; no se inventan ventas automáticamente.", 9f, MUTED, bot=5))
                        card.addView(btn("ACTUALIZAR VENTAS DEL MES").apply {
                            textSize = 8.5f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, PURPLE, 1)
                            setOnClickListener {
                                val form = ll().apply { setPadding(dp(this@MainActivity, 8), dp(this@MainActivity, 6), dp(this@MainActivity, 8), dp(this@MainActivity, 4)) }
                                val countInput = inp("Número de ventas válidas este mes", numeric=true).apply { setText(monthlySales.toString()) }
                                val reasonInput = inp("Motivo del ajuste (obligatorio)", multiline=true, maxLen=500)
                                form.addView(countInput); form.addView(reasonInput)
                                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Control mensual SO Reseller").setMessage("El cambio queda en una tabla de auditoría con el administrador, fecha y valor anterior/nuevo.").setView(form)
                                    .setNegativeButton("Cancelar", null).setPositiveButton("Guardar recuento") { _, _ ->
                                        val newCount = countInput.text.toString().toIntOrNull()
                                        val reason = reasonInput.text.toString().trim()
                                        if (newCount == null || newCount < 0 || reason.isBlank()) {
                                            showSoToast("Introduce un entero válido y el motivo del cambio.", Toast.LENGTH_LONG)
                                        } else uiScope.launch {
                                            val body = JSONObject().put("monthly_sales_count", newCount).put("reason", reason)
                                            val result = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/admin/reseller/applications/$id/sales-count", "POST", token, body) }.getOrNull() }
                                            if (result != null && result.code in 200..299) {
                                                showSoToast("Recuento mensual actualizado y auditado.", Toast.LENGTH_LONG); refreshRows()
                                            } else showSoToast(runCatching { JSONObject(result?.body.orEmpty()).optString("error") }.getOrNull().orEmpty().ifBlank { "No se pudo actualizar el recuento." }, Toast.LENGTH_LONG)
                                        }
                                    }.show()
                            }
                        })
                    }
                    when (status) {
                        "pending_review" -> {
                            val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
                            row.addView(btn("APROBAR KYC").apply {
                                textSize = 8.5f; isAllCaps = false; setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 8, RED, 0)
                                setOnClickListener { reviewResellerApplication(id, "approve", "", token) { refreshRows() } }
                            }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f).apply { marginEnd = dp(this@MainActivity, 4) })
                            row.addView(btn("RECHAZAR / CORREGIR").apply {
                                textSize = 8.5f; isAllCaps = false; setTextColor(TEXT); background = roundedBackground(SURFACE2, 8, ERR, 1)
                                setOnClickListener {
                                    val noteInput = inp("Motivo o documentos que debe corregir", multiline=true, maxLen=500)
                                    ThemedAlertDialogBuilder(this@MainActivity).setTitle("Respuesta a la solicitud").setView(noteInput)
                                        .setItems(arrayOf("Solicitar correcciones", "Rechazar solicitud")) { _, which -> reviewResellerApplication(id, if (which == 0) "request_changes" else "reject", noteInput.text.toString().trim(), token) { refreshRows() } }
                                        .setNegativeButton("Cancelar", null).show()
                                }
                            }, LinearLayout.LayoutParams(0, dp(this@MainActivity, 40), 1f).apply { marginStart = dp(this@MainActivity, 4) })
                            card.addView(row)
                        }
                        "approved_awaiting_deposit" -> card.addView(btn(if (depositStatus == "PAYMENT_DETECTED_PENDING_ADMIN") "REVISAR DEPÓSITO DETECTADO Y ACTIVAR" else "ESPERANDO DEPÓSITO ELEGIBLE EN WALLET").apply {
                            textSize = 8.5f; isAllCaps = false
                            isEnabled = depositStatus == "PAYMENT_DETECTED_PENDING_ADMIN"
                            alpha = if (isEnabled) 1f else 0.5f
                            background = roundedBackground(if (isEnabled) RED else SURFACE2, 8, if (isEnabled) RED else MUTED, if (isEnabled) 0 else 1)
                            setOnClickListener {
                                if (depositStatus != "PAYMENT_DETECTED_PENDING_ADMIN") {
                                    showSoToast("Todavía no se ha detectado un depósito de Wallet que cumpla los requisitos.", Toast.LENGTH_LONG)
                                    return@setOnClickListener
                                }
                                ThemedAlertDialogBuilder(this@MainActivity).setTitle("Revisión manual del depósito").setMessage("Se detectó un crédito de Wallet que podría cumplir los requisitos. Verifica que el ticket y la transacción corresponden al depósito real de al menos 50.000 CUP antes de aprobar. La cuenta no se activa hasta que confirmes aquí.")
                                    .setNegativeButton("Cancelar", null).setPositiveButton("Verificado: activar reseller") { _, _ ->
                                        uiScope.launch {
                                            val result = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/admin/reseller/applications/$id/activate", "POST", token, JSONObject().put("deposit_confirmed", true)) }.getOrNull() }
                                            if (result != null && result.code in 200..299) {
                                                NotificationService.showAppEventNotification(this@MainActivity, "SO Reseller activado", "Se ha activado el acceso reseller para el solicitante.", "admin-reseller-activated-$id", true)
                                                refreshRows()
                                            } else showSoToast("No se pudo activar: verifica la migración y los permisos.", Toast.LENGTH_LONG)
                                        }
                                    }.show()
                            }
                        })
                    }
                    content.addView(card)
                }
                if (apps.length() == 0) content.addView(txt("No hay solicitudes en esta categoría.", 11f, MUTED, top=16))
            }
        }
        fun selectStatus(status: String) { currentStatus = status; refreshRows() }
        refreshRows()
        dialog.show()
    }

    private fun reviewResellerApplication(id: String, action: String, note: String, token: String, onComplete: () -> Unit) {
        if (action != "approve" && note.isBlank()) { showSoToast("Escribe un motivo o las correcciones solicitadas.", Toast.LENGTH_LONG); return }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/game-market/admin/reseller/applications/$id/review", "POST", token, JSONObject().put("action", action).put("note", note)) }.getOrNull()
            }
            if (response != null && response.code in 200..299) {
                val msg = runCatching { JSONObject(response.body).optString("message") }.getOrNull().orEmpty()
                showSoToast(msg.ifBlank { "Revisión guardada." }, Toast.LENGTH_LONG)
                onComplete()
            } else {
                val err = runCatching { JSONObject(response?.body.orEmpty()).optString("error") }.getOrNull().orEmpty()
                showSoToast(err.ifBlank { "No se pudo guardar la revisión." }, Toast.LENGTH_LONG)
            }
        }
    }

    private fun formatCupAmount(amount: Double): String {
        val number = kotlin.math.round(amount).toLong().toString()
        return number.reversed().chunked(3).joinToString(" ").reversed()
    }

    private fun fetchAutomationPublicStatus(): JSONObject? {
        return try {
            val response = backendRequest("/api/system/status")
            if (response.code !in 200..299) null else JSONObject(response.body)
        } catch (_: Exception) { null }
    }

    private fun fetchClientRole(token: String): String? {
        if (token.isBlank()) return null
        return try {
            val response = backendRequest("/api/auth/me", token = token)
            if (response.code !in 200..299) return null
            val client = JSONObject(response.body).optJSONObject("client") ?: return null
            // Never trust a locally cached role to reveal administrator controls.
            if (!client.optBoolean("active", false) || client.optBoolean("store_only", false)) return null
            client.optString("role", "client").trim().lowercase(Locale.ROOT)
        } catch (_: Exception) { null }
    }

    private fun loadDashboardAccountControls(statusView: TextView, adminHost: LinearLayout) {
        // Hide and clear immediately. The admin switch is only rendered after the server
        // confirms an active account with the exact administrator role.
        adminHost.removeAllViews()
        adminHost.visibility = View.GONE
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        uiScope.launch {
            val automation = withContext(Dispatchers.IO) { fetchAutomationPublicStatus() }
            if (statusView.isAttachedToWindow) {
                val enabled = automation?.optBoolean("automation_enabled", false) == true
                val message = automation?.optString("automation_message", "")?.takeIf { it.isNotBlank() }
                statusView.text = if (enabled) "● Automática activa" else "● " + (message ?: "Automatización no disponible")
                statusView.setTextColor(if (enabled) GREEN else ERR)
            }
            val role = withContext(Dispatchers.IO) { fetchClientRole(token) }
            prefs.edit().putString("client_role", role ?: "client").apply()
            if (role == "admin" && adminHost.isAttachedToWindow) {
                adminHost.addView(buildAdminAutomationCard(token))
                adminHost.visibility = View.VISIBLE
            } else if (adminHost.isAttachedToWindow) {
                adminHost.removeAllViews()
                adminHost.visibility = View.GONE
            }
        }
    }

    private fun buildAdminAutomationCard(token: String): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 14), dp(this@MainActivity, 16), dp(this@MainActivity, 14))
            background = roundedBackground(SURFACE2, 12, RED, 1)
        }
        card.addView(txt("CONTROL DE AUTOMATIZACIÓN · ADMIN", 10f, RED, bold = true, ls = .10f, bot = 10))
        val automationSwitch = Switch(this).apply {
            text = "Automatización disponible"
            setTextColor(TEXT)
            isEnabled = false
        }
        card.addView(automationSwitch)
        val messageInput = EditText(this).apply {
            hint = "Mensaje para los clientes cuando esté desconectado"
            setTextColor(TEXT); setHintTextColor(MUTED)
            textSize = 12f; minLines = 2; maxLines = 4
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10))
            background = roundedBackground(BG, 8, MUTED, 1)
            isEnabled = false
        }
        val automationStatus = txt("Cargando configuración…", 11f, TEXT2, top = 8, bot = 8)
        val saveMessageBtn = btn("GUARDAR AVISO").apply {
            textSize = 10f; setTextColor(TEXT); background = roundedBackground(SURFACE, 8, RED, 1); isEnabled = false
        }
        card.addView(space(8)); card.addView(messageInput); card.addView(automationStatus); card.addView(saveMessageBtn)

        card.addView(space(14))
        card.addView(gradientDivider())
        card.addView(txt("MI CUENTA DE TRANSFERENCIA", 10f, PURPLE, bold = true, ls = .08f, top = 12, bot = 5))
        card.addView(txt("Tu tarjeta y su número de confirmación se guardan como una pareja. Cada administrador configura su propia cuenta; nunca se mezclan entre pagos.", 10f, TEXT2, bot = 8))
        val paymentCardInput = inp("Número de tarjeta receptora", maxLen = 24).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            setSingleLine(true)
        }
        val paymentPhoneInput = inp("Número móvil asociado para confirmar", maxLen = 8, numeric = true).apply { setSingleLine(true) }
        val ownDestinationSwitch = Switch(this).apply {
            text = "Mostrar mi cuenta a los clientes"
            setTextColor(TEXT)
            isEnabled = false
        }
        val destinationStatus = txt("Cargando cuenta…", 10f, TEXT2, top = 5, bot = 6)
        val saveDestinationBtn = btn("GUARDAR MI TARJETA Y NÚMERO").apply {
            textSize = 10f; setTextColor(TEXT); background = roundedBackground(SURFACE, 8, PURPLE, 1); isEnabled = false
        }
        val publishUpdateBtn = btn("PUBLICAR ACTUALIZACIÓN DE LA APP").apply {
            textSize = 10f; setTextColor(TEXT); background = roundedBackground(SURFACE, 8, RED, 1)
            setOnClickListener { openAppUpdatePicker() }
        }
        card.addView(paymentCardInput); card.addView(space(6)); card.addView(paymentPhoneInput)
        card.addView(ownDestinationSwitch); card.addView(destinationStatus); card.addView(saveDestinationBtn)
        card.addView(space(6)); card.addView(publishUpdateBtn)

        var automationLoaded = false
        var actualAutomationEnabled = false
        var actualAutomationMessage = ""
        var destinationLoaded = false
        var actualDestinationEnabled = false
        var savingDestination = false

        suspend fun saveAutomation(enabled: Boolean, message: String) {
            val payload = JSONObject().put("enabled", enabled).put("message", message)
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/system/automation", "PUT", token, payload) }.getOrNull()
            }
            val parsed = runCatching { JSONObject(response?.body.orEmpty()) }.getOrNull() ?: JSONObject()
            if (response != null && response.code in 200..299 && parsed.optBoolean("ok", false)) {
                actualAutomationEnabled = parsed.optBoolean("enabled", enabled)
                actualAutomationMessage = parsed.optString("message", message)
                automationSwitch.setOnCheckedChangeListener(null)
                automationSwitch.isChecked = actualAutomationEnabled
                automationSwitch.setOnCheckedChangeListener { _, checked ->
                    if (automationLoaded && checked != actualAutomationEnabled) {
                        automationLoaded = false
                        automationSwitch.isEnabled = false
                        uiScope.launch { saveAutomation(checked, messageInput.text.toString().ifBlank { actualAutomationMessage }); automationSwitch.isEnabled = true; automationLoaded = true }
                    }
                }
                messageInput.setText(actualAutomationMessage)
                automationStatus.text = if (actualAutomationEnabled) "✅ Automatización activa" else "⛔ Desactivada: los clientes no deben pagar"
                automationStatus.setTextColor(if (actualAutomationEnabled) GREEN else ERR)
                showSoToast(if (actualAutomationEnabled) "Automatización activada" else "Automatización desactivada", Toast.LENGTH_SHORT)
            } else {
                automationSwitch.setOnCheckedChangeListener(null)
                automationSwitch.isChecked = actualAutomationEnabled
                automationSwitch.setOnCheckedChangeListener { _, checked ->
                    if (automationLoaded && checked != actualAutomationEnabled) {
                        automationLoaded = false
                        automationSwitch.isEnabled = false
                        uiScope.launch { saveAutomation(checked, messageInput.text.toString().ifBlank { actualAutomationMessage }); automationSwitch.isEnabled = true; automationLoaded = true }
                    }
                }
                automationStatus.text = parsed.optString("error", "No se pudo guardar la disponibilidad. Verifica la conexión y los permisos de administrador.")
                automationStatus.setTextColor(ERR)
            }
        }

        suspend fun saveOwnDestination(enabled: Boolean) {
            if (savingDestination || !destinationLoaded) return
            savingDestination = true
            saveDestinationBtn.isEnabled = false
            ownDestinationSwitch.isEnabled = false
            val payload = JSONObject()
                .put("card_number", paymentCardInput.text.toString().trim())
                .put("confirmation_phone", paymentPhoneInput.text.toString().trim())
                .put("enabled", enabled)
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/system/payment-destinations/mine", "PUT", token, payload) }.getOrNull()
            }
            val parsed = runCatching { JSONObject(response?.body.orEmpty()) }.getOrNull() ?: JSONObject()
            if (response != null && response.code in 200..299 && parsed.optBoolean("ok", false)) {
                val destination = parsed.optJSONObject("destination") ?: JSONObject()
                paymentCardInput.setText(destination.optString("card_number", ""))
                paymentPhoneInput.setText(destination.optString("confirmation_phone", ""))
                actualDestinationEnabled = destination.optBoolean("enabled", enabled)
                ownDestinationSwitch.setOnCheckedChangeListener(null)
                ownDestinationSwitch.isChecked = actualDestinationEnabled
                ownDestinationSwitch.setOnCheckedChangeListener { _, checked ->
                    if (destinationLoaded && checked != actualDestinationEnabled) uiScope.launch { saveOwnDestination(checked) }
                }
                destinationStatus.text = if (actualDestinationEnabled) "✅ Tu cuenta está visible para pagos nuevos." else "Tu cuenta está guardada, pero no aparecerá a los clientes hasta activarla."
                destinationStatus.setTextColor(if (actualDestinationEnabled) GREEN else TEXT2)
                showSoToast("Cuenta de transferencia guardada.", Toast.LENGTH_SHORT)
            } else {
                ownDestinationSwitch.setOnCheckedChangeListener(null)
                ownDestinationSwitch.isChecked = actualDestinationEnabled
                ownDestinationSwitch.setOnCheckedChangeListener { _, checked ->
                    if (destinationLoaded && checked != actualDestinationEnabled) uiScope.launch { saveOwnDestination(checked) }
                }
                destinationStatus.text = parsed.optString("error", "No se pudo guardar la cuenta. Verifica los datos y la conexión.")
                destinationStatus.setTextColor(ERR)
            }
            savingDestination = false
            saveDestinationBtn.isEnabled = destinationLoaded
            ownDestinationSwitch.isEnabled = destinationLoaded
        }

        automationSwitch.setOnCheckedChangeListener { _, checked ->
            if (automationLoaded && checked != actualAutomationEnabled) {
                automationLoaded = false
                automationSwitch.isEnabled = false
                uiScope.launch {
                    saveAutomation(checked, messageInput.text.toString().ifBlank { actualAutomationMessage })
                    automationSwitch.isEnabled = true
                    automationLoaded = true
                }
            }
        }
        saveMessageBtn.setOnClickListener {
            saveMessageBtn.isEnabled = false
            uiScope.launch {
                saveAutomation(automationSwitch.isChecked, messageInput.text.toString())
                saveMessageBtn.isEnabled = true
            }
        }
        ownDestinationSwitch.setOnCheckedChangeListener { _, checked ->
            if (destinationLoaded && checked != actualDestinationEnabled) uiScope.launch { saveOwnDestination(checked) }
        }
        saveDestinationBtn.setOnClickListener {
            uiScope.launch { saveOwnDestination(ownDestinationSwitch.isChecked) }
        }

        uiScope.launch {
            val data = withContext(Dispatchers.IO) {
                runCatching {
                    val response = backendRequest("/api/system/automation", token = token)
                    if (response.code !in 200..299) null else JSONObject(response.body)
                }.getOrNull()
            }
            if (data == null) {
                automationStatus.text = "No se pudo cargar la configuración. Verifica que tu cuenta tenga permisos de administrador."
                automationStatus.setTextColor(ERR)
                return@launch
            }
            actualAutomationEnabled = data.optBoolean("enabled", false)
            actualAutomationMessage = data.optString("message", "")
            automationSwitch.isChecked = actualAutomationEnabled
            messageInput.setText(actualAutomationMessage)
            automationSwitch.isEnabled = true
            messageInput.isEnabled = true
            saveMessageBtn.isEnabled = true
            automationStatus.text = if (actualAutomationEnabled) "✅ Activa: el servicio puede recibir SMS" else "⛔ Desactivada: los clientes no deben pagar"
            automationStatus.setTextColor(if (actualAutomationEnabled) GREEN else ERR)
            automationLoaded = true
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/system/payment-destinations/mine", token = token) }.getOrNull()
            }
            val json = runCatching { JSONObject(response?.body.orEmpty()) }.getOrNull() ?: JSONObject()
            val destination = json.optJSONObject("destination")
            if (response != null && response.code in 200..299 && destination != null) {
                paymentCardInput.setText(destination.optString("card_number", ""))
                paymentPhoneInput.setText(destination.optString("confirmation_phone", ""))
                actualDestinationEnabled = destination.optBoolean("enabled", false)
                ownDestinationSwitch.isChecked = actualDestinationEnabled
                destinationStatus.text = if (actualDestinationEnabled) "✅ Tu cuenta está visible para pagos nuevos." else "Cuenta guardada desactivada. Actívala solo cuando puedas recibir pagos en esta cuenta."
                destinationStatus.setTextColor(if (actualDestinationEnabled) GREEN else TEXT2)
                destinationLoaded = true
                ownDestinationSwitch.isEnabled = true
                saveDestinationBtn.isEnabled = true
            } else {
                destinationStatus.text = json.optString("error", "No se pudo cargar tu cuenta de transferencia.")
                destinationStatus.setTextColor(ERR)
            }
        }
        return card
    }

    private fun storeAccessToken(): String {
        val storeToken = prefs.getString(SyncService.KEY_STORE_TOKEN, "").orEmpty()
        if (isStoreOnlySession()) return storeToken
        return prefs.getString(SyncService.KEY_TOKEN, "").orEmpty().ifBlank { storeToken }
    }

    private fun mergedSmsParse(sms: SmsEntity, receivedAt: Long = sms.receivedAt): SmsParser.ParsedSms {
        val parsed = SmsParser.parse(sms.body, receivedAt)
        fun bestText(current: String?, saved: String?, unknown: String = "DESCONOCIDO"): String =
            current?.takeIf { it.isNotBlank() && !it.equals(unknown, true) }
                ?: saved?.takeIf { it.isNotBlank() && !it.equals(unknown, true) }
                ?: (current ?: unknown)
        return parsed.copy(
            direction = bestText(parsed.direction, sms.direction),
            type = bestText(parsed.type, sms.type),
            network = bestText(parsed.network, sms.network),
            category = bestText(parsed.category, sms.category),
            amount = parsed.amount?.takeIf { it.isFinite() && it > 0 } ?: sms.amount?.takeIf { it.isFinite() && it > 0 },
            currency = parsed.currency?.takeIf { it.isNotBlank() } ?: sms.currency,
            senderPhone = parsed.senderPhone?.takeIf { it.isNotBlank() } ?: sms.senderPhone,
            receiverPhone = parsed.receiverPhone?.takeIf { it.isNotBlank() } ?: sms.receiverPhone,
            receiverAccount = parsed.receiverAccount?.takeIf { it.isNotBlank() } ?: sms.receiverAccount,
            transactionId = parsed.transactionId?.takeIf { it.isNotBlank() } ?: sms.transactionId,
            balanceAfter = parsed.balanceAfter?.takeIf { it.isFinite() && it >= 0 } ?: sms.balanceAfter,
            transactionAt = parsed.transactionAt ?: sms.transactionAt,
            note = parsed.note?.takeIf { it.isNotBlank() } ?: sms.note
        )
    }

    private fun clearAssistantFloatingUi() {
        assistantSpontaneousRunnable?.let { handler.removeCallbacks(it) }
        assistantSpontaneousRunnable = null
        assistantAlertDismiss?.let { handler.removeCallbacks(it) }
        assistantAlertDismiss = null
        (assistantAlertView?.parent as? ViewGroup)?.removeView(assistantAlertView)
        assistantAlertView = null
        (assistantLauncherView?.parent as? ViewGroup)?.removeView(assistantLauncherView)
        assistantLauncherView = null
    }

    private fun installAssistantFloatingLauncher() {
        if (!::rootFrame.isInitialized || !prefs.getBoolean(PREF_SO_ASSISTANT_FLOATING, true) || assistantLauncherView?.parent === rootFrame) return
        val launcher = ImageView(this).apply {
            setImageResource(R.drawable.so_assistant_avatar)
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = "Abrir SO Assistant"
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(SURFACE2)
                setStroke(dp(this@MainActivity, 2), Color.parseColor("#E34E64"))
            }
            clipToOutline = true
            setPadding(dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2))
            elevation = dp(this@MainActivity, 10).toFloat()
            isClickable = true
            isFocusable = true
            setOnClickListener { showAiAssistant() }
        }
        val params = FrameLayout.LayoutParams(dp(this, 58), dp(this, 58), Gravity.BOTTOM or Gravity.END).apply {
            setMargins(0, 0, dp(this@MainActivity, 16), dp(this@MainActivity, 100))
        }
        rootFrame.addView(launcher, params)
        assistantLauncherView = launcher
        launcher.animate().scaleX(1.04f).scaleY(1.04f).setDuration(650L).withEndAction {
            if (launcher.isAttachedToWindow) launcher.animate().scaleX(1f).scaleY(1f).setDuration(650L).start()
        }.start()
    }

    private fun assistantMoodMeta(emotion: String): Pair<String, Int> = when (emotion.lowercase(Locale.ROOT)) {
        "happy" -> "♡" to Color.parseColor("#FF82A8")
        "amused" -> "⌁" to Color.parseColor("#D9A6FF")
        "curious" -> "?" to Color.parseColor("#77D8FF")
        "thinking" -> "…" to Color.parseColor("#A9B4D0")
        "concerned" -> "!" to Color.parseColor("#F0A64B")
        "reassuring" -> "✓" to Color.parseColor("#53D6A3")
        "confident" -> "◆" to Color.parseColor("#A990FF")
        "excited" -> "✧" to Color.parseColor("#FFCB75")
        "playful" -> "✦" to Color.parseColor("#FF7D8D")
        "empathetic" -> "♡" to Color.parseColor("#E69BBE")
        "surprised" -> "!" to Color.parseColor("#FFCB75")
        "shy" -> "♡" to Color.parseColor("#E69BBE")
        "proud" -> "★" to Color.parseColor("#FFD36F")
        "sleepy" -> "z" to Color.parseColor("#A9B4D0")
        "determined" -> "◆" to Color.parseColor("#FF8B72")
        "sassy" -> "✦" to Color.parseColor("#FF7D8D")
        else -> "✦" to Color.parseColor("#B89AFF")
    }

    private fun createAssistantAvatar(sizeDp: Int, registerHeader: Boolean = false, emotion: String = "neutral"): FrameLayout {
        val frame = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(SURFACE2)
                setStroke(dp(this@MainActivity, 2), Color.parseColor("#C56A84"))
            }
            elevation = dp(this@MainActivity, 4).toFloat()
            contentDescription = "Avatar de SO Assistant"
        }
        val portrait = ImageView(this).apply {
            setImageResource(R.drawable.so_assistant_avatar)
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(SURFACE2) }
            clipToOutline = true
        }
        frame.addView(portrait, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            setMargins(dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2), dp(this@MainActivity, 2))
        })
        val meta = assistantMoodMeta(emotion)
        val badge = TextView(this).apply {
            text = meta.first
            textSize = if (sizeDp >= 56) 10f else 8f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(meta.second)
                setStroke(dp(this@MainActivity, 1), Color.parseColor("#160D20"))
            }
        }
        frame.addView(badge, FrameLayout.LayoutParams(dp(this, if (sizeDp >= 56) 20 else 16), dp(this, if (sizeDp >= 56) 20 else 16), Gravity.BOTTOM or Gravity.END))
        if (registerHeader) {
            assistantHeaderAvatarFrame = frame
            assistantHeaderMoodBadge = badge
        }
        return frame
    }

    private fun assistantMoodLabel(emotion: String): String = when (emotion.lowercase(Locale.ROOT)) {
        "happy" -> "Alegre"
        "amused" -> "Divertida"
        "curious" -> "Curiosa"
        "thinking" -> "Pensando"
        "concerned" -> "Atenta"
        "reassuring" -> "Tranquila"
        "confident" -> "Segura"
        "excited" -> "Entusiasmada"
        "playful" -> "Pícara"
        "empathetic" -> "Comprensiva"
        "surprised" -> "Sorprendida"
        "shy" -> "Tímida"
        "proud" -> "Orgullosa"
        "sleepy" -> "Relajada"
        "determined" -> "Decidida"
        "sassy" -> "Traviesa"
        else -> "Disponible"
    }

    private fun updateAssistantAvatarState(emotion: String = "neutral", gesture: String = "neutral") {
        val safeEmotion = emotion.lowercase(Locale.ROOT).takeIf { it in setOf("neutral", "happy", "amused", "curious", "thinking", "concerned", "reassuring", "confident", "excited", "playful", "empathetic", "surprised", "shy", "proud", "sleepy", "determined", "sassy") } ?: "neutral"
        val safeGesture = gesture.lowercase(Locale.ROOT).takeIf { it in setOf("neutral", "smile", "wink", "think", "nod", "wave", "alert", "celebrate", "tilt", "shrug", "bounce", "sigh", "blush", "peek") } ?: "neutral"
        val meta = assistantMoodMeta(safeEmotion)
        assistantHeaderMoodBadge?.apply {
            text = meta.first
            (background as? GradientDrawable)?.setColor(meta.second)
        }
        assistantMoodView?.text = "${assistantMoodLabel(safeEmotion).uppercase(Locale.ROOT)} · SO ASSISTANT"
        val avatar = assistantHeaderAvatarFrame ?: return
        avatar.animate().cancel()
        avatar.rotation = 0f
        avatar.translationY = 0f
        avatar.scaleX = 1f
        avatar.scaleY = 1f
        when (safeGesture) {
            "wave", "wink" -> avatar.animate().rotation(if (safeGesture == "wave") -5f else 4f).setDuration(180L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().rotation(0f).setDuration(260L).start()
            }.start()
            "think", "tilt" -> avatar.animate().rotation(if (safeGesture == "think") 3f else -3f).setDuration(280L).start()
            "nod" -> avatar.animate().translationY(dp(this, 4).toFloat()).setDuration(130L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().translationY(0f).setDuration(180L).start()
            }.start()
            "celebrate", "bounce" -> avatar.animate().translationY(-dp(this, 6).toFloat()).scaleX(1.07f).scaleY(1.07f).setDuration(180L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().translationY(0f).scaleX(1f).scaleY(1f).setDuration(240L).start()
            }.start()
            "alert" -> avatar.animate().scaleX(1.04f).scaleY(1.04f).setDuration(160L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().scaleX(1f).scaleY(1f).setDuration(220L).start()
            }.start()
            "shrug", "sigh" -> avatar.animate().rotation(if (safeGesture == "shrug") 6f else -4f).alpha(0.88f).setDuration(220L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().rotation(0f).alpha(1f).setDuration(220L).start()
            }.start()
            "blush", "peek" -> avatar.animate().scaleX(0.96f).scaleY(1.04f).rotation(if (safeGesture == "peek") -5f else 2f).setDuration(220L).withEndAction {
                if (avatar.isAttachedToWindow) avatar.animate().scaleX(1f).scaleY(1f).rotation(0f).setDuration(240L).start()
            }.start()
            else -> avatar.animate().alpha(1f).setDuration(160L).start()
        }
    }

    private fun scheduleAssistantSpontaneousPresence(retry: Int = 0) {
        assistantSpontaneousRunnable?.let { handler.removeCallbacks(it) }
        if (!prefs.getBoolean(PREF_SO_ASSISTANT_SPONTANEOUS, true) || storeAccessToken().isBlank()) return
        val dayKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        if (prefs.getString(PREF_SO_ASSISTANT_SPONTANEOUS_DAY, "") == dayKey) return
        val spontaneousLines = listOf(
            Triple("Una pequeña observación", "Mmm… a veces la mejor compra es la que uno se toma un momento para comparar. Sí, también sé dar consejos sensatos. Qué tragedia.", "playful") to "wink",
            Triple("SO Assistant · De buen humor", "Vaya, otra visita. Empiezo a pensar que te gusta tenerme cerca. No te preocupes, guardaré el secreto… de mí misma.", "amused") to "smile",
            Triple("SO Assistant · Curiosa", "¿Hoy vienes con una misión concreta o solo estás explorando? Ambas opciones me parecen aceptables.", "curious") to "tilt",
            Triple("Una nota de tu asistente", "Pequeño recordatorio: nunca compartas contraseñas, códigos SMS ni claves con nadie por chat. La seguridad también tiene su encanto.", "reassuring") to "nod",
            Triple("SO Assistant · Todo tranquilo", "Por aquí todo parece en calma. Cuando necesites encontrar algo, comparar una oferta o aclarar una operación, silba… bueno, pulsa mi icono.", "happy") to "wave",
            Triple("SO Assistant · Un pensamiento", "No hace falta tener prisa para decidir bien. Comprueba los detalles y deja que los números hablen; yo te ayudo a leerlos.", "confident") to "think"
        )
        val task = Runnable {
            if (isFinishing || isDestroyed || assistantScreenActive || assistantDashboardSection != "home") {
                if (retry < 2 && !isFinishing && !isDestroyed && assistantDashboardSection == "home") scheduleAssistantSpontaneousPresence(retry + 1)
                return@Runnable
            }
            if (assistantAlertView != null) {
                if (retry < 2) scheduleAssistantSpontaneousPresence(retry + 1)
                return@Runnable
            }
            // One optional, short model-generated ambient line per local day.
            // It is an ordinary metered assistant request with no account context.
            // If Groq is unavailable or quota is exhausted, use a local fallback.
            prefs.edit().putString(PREF_SO_ASSISTANT_SPONTANEOUS_DAY, dayKey).apply()
            val selected = spontaneousLines[Random().nextInt(spontaneousLines.size)]
            val fallback = selected.first
            val fallbackGesture = selected.second
            uiScope.launch {
                val token = storeAccessToken()
                val prompt = "Escribe una intervención espontánea y breve (máximo dos frases) para alguien que acaba de abrir SynthesisOne. Puedes saludar, compartir una observación ingeniosa, una broma amable, mostrar curiosidad o dar un pequeño ánimo. Varía tu personalidad y no repitas un saludo genérico. No menciones datos de la cuenta, ubicación, hora ni actividad que no se te hayan proporcionado. No pidas información privada, no promociones productos, no presiones para que respondan y no inventes incidencias. Devuelve el JSON habitual con reply, emotion, gesture y mood_text."
                val request = JSONObject()
                    .put("mode", "spontaneous")
                    .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
                val response = withContext(Dispatchers.IO) {
                    runCatching { backendRequest("/api/assistant/chat", "POST", token, request) }.getOrNull()
                }
                if (isFinishing || isDestroyed || assistantScreenActive || assistantDashboardSection != "home" || assistantAlertView != null) return@launch
                val data = response?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
                val aiReply = if (response != null && response.code in 200..299 && data?.optBoolean("ok", false) == true) data.optString("reply", "").trim() else ""
                val title = if (aiReply.isNotBlank()) "SO Assistant · Un pensamiento" else fallback.first
                val message = aiReply.ifBlank { fallback.second }
                val emotion = if (aiReply.isNotBlank()) data?.optString("emotion", "playful") ?: "playful" else fallback.third
                val gesture = if (aiReply.isNotBlank()) data?.optString("gesture", "smile") ?: "smile" else fallbackGesture
                updateAssistantAvatarState(emotion, gesture)
                showAssistantProactiveAlert(title, message, showWhatsApp = false)
            }
        }
        assistantSpontaneousRunnable = task
        handler.postDelayed(task, (34_000L + Random().nextInt(18_000).toLong()))
    }

    private fun showAssistantProactiveAlert(title: String, message: String, showWhatsApp: Boolean = true) {
        if (!::rootFrame.isInitialized || isFinishing || isDestroyed) return
        assistantAlertDismiss?.let { handler.removeCallbacks(it) }
        (assistantAlertView?.parent as? ViewGroup)?.removeView(assistantAlertView)

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 15), dp(this@MainActivity, 13), dp(this@MainActivity, 15), dp(this@MainActivity, 12))
            background = roundedBackground(SURFACE, 18, if (showWhatsApp) Color.parseColor("#E5A044") else PURPLE, 2)
            elevation = dp(this@MainActivity, 12).toFloat()
            alpha = 0f
            translationY = dp(this@MainActivity, 18).toFloat()
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(createAssistantAvatar(38, false, if (showWhatsApp) "concerned" else "playful"), LinearLayout.LayoutParams(dp(this, 38), dp(this, 38)).apply { marginEnd = dp(this@MainActivity, 9) })
        header.addView(txt("$title", 11f, if (showWhatsApp) Color.parseColor("#FFC56E") else PURPLE, bold = true).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(txt("×", 22f, MUTED, bold = true).apply {
            contentDescription = "Cerrar aviso de SO Assistant"
            setPadding(dp(this@MainActivity, 7), 0, 0, 0)
            setOnClickListener { clearAssistantAlertOnly() }
        })
        card.addView(header)
        card.addView(txt(message, 10.5f, TEXT2, top = 7, bot = if (showWhatsApp) 10 else 2))
        if (showWhatsApp) {
            card.addView(btn("CONTACTAR POR WHATSAPP  ·  +53 59190241").apply {
                textSize = 9f
                isAllCaps = false
                setTextColor(Color.WHITE)
                background = roundedBackground(Color.parseColor("#168B5B"), 11, Color.parseColor("#168B5B"), 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 40))
                setOnClickListener {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$SO_SUPPORT_WHATSAPP"))) }
                        .onFailure { showSoToast("No se pudo abrir WhatsApp. Escribe al +53 59190241.", Toast.LENGTH_LONG) }
                }
            })
        }
        val bottomMargin = if (assistantLauncherView?.parent === rootFrame) 98 else 16
        val params = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            setMargins(dp(this@MainActivity, 12), 0, dp(this@MainActivity, 12), dp(this@MainActivity, bottomMargin))
        }
        rootFrame.addView(card, params)
        assistantAlertView = card
        card.animate().alpha(1f).translationY(0f).setDuration(220L).start()
        val dismiss = Runnable {
            if (assistantAlertView === card) clearAssistantAlertOnly()
        }
        assistantAlertDismiss = dismiss
        handler.postDelayed(dismiss, 18_000L)
    }

    private fun clearAssistantAlertOnly() {
        assistantAlertDismiss?.let { handler.removeCallbacks(it) }
        assistantAlertDismiss = null
        (assistantAlertView?.parent as? ViewGroup)?.removeView(assistantAlertView)
        assistantAlertView = null
    }

    private fun pulseAssistantGuideTarget(target: View) {
        if (!target.isAttachedToWindow) return
        val originalBackground = target.background
        target.background = roundedBackground(SURFACE2, 14, PURPLE, 3)
        target.animate().cancel()
        target.animate().scaleX(1.025f).scaleY(1.025f).setDuration(360L).withEndAction {
            if (target.isAttachedToWindow) target.animate().scaleX(1f).scaleY(1f).setDuration(360L).start()
        }.start()
        handler.postDelayed({
            if (target.isAttachedToWindow) {
                target.animate().cancel()
                target.scaleX = 1f
                target.scaleY = 1f
                target.background = originalBackground
            }
        }, 7_000L)
    }

    private fun isResellerNavigationRequest(message: String): Boolean {
        val normalized = message.lowercase(Locale.ROOT)
        return normalized.contains("reseller") && Regex("d[oó]nde|encuentr|llev|ubic|acced|entrar|ir a|buscar").containsMatchIn(normalized)
    }

    private fun startResellerNavigationGuide() {
        assistantScreenActive = false
        assistantMessagesContainer = null
        assistantMessagesScroll = null
        assistantStatusView = null
        showDashboard(guidedSettings = true)
    }

    private fun ensureAutomationAvailableForTransfer(onAvailable: () -> Unit) {
        if (!isDeviceOnline()) {
            showAssistantProactiveAlert(
                "No se pudo verificar el servicio",
                "No realices una transferencia sin conexión. Recupera Internet y vuelve a comprobar la disponibilidad automática."
            )
            return
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/system/status") }.getOrNull()
            }
            val status = response?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
            when {
                response == null || response.code !in 200..299 || status == null || !status.has("automation_enabled") -> {
                    showAssistantProactiveAlert(
                        "Disponibilidad sin confirmar",
                        "No pudimos comprobar que las transferencias estén habilitadas. Por seguridad, no envíes dinero hasta confirmarlo con soporte."
                    )
                }
                !status.optBoolean("automation_enabled", false) -> {
                    val detail = status.optString("automation_message", "La automatización está temporalmente desactivada.")
                    showAssistantProactiveAlert(
                        "No realices la transferencia",
                        "$detail No envíes dinero ahora. Contacta al equipo por WhatsApp para confirmar cuándo estará disponible el servicio."
                    )
                }
                else -> onAvailable()
            }
        }
    }

    private fun showAiAssistant() {
        val token = storeAccessToken()
        if (token.isBlank()) {
            showSoToast("Conéctate a tu cuenta para utilizar el asistente.", Toast.LENGTH_LONG)
            return
        }
        clearAssistantFloatingUi()
        assistantScreenActive = true
        val sessionOwner = token.hashCode().toString()
        if (assistantHistoryOwner != sessionOwner) {
            assistantHistory.clear()
            assistantHistoryOwner = sessionOwner
        }
        rootFrame.removeAllViews()
        val root = ll().apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
            setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 22), dp(this@MainActivity, 16), dp(this@MainActivity, 12))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(futuristicBackButton("←  VOLVER") {
            assistantScreenActive = false
            assistantMessagesContainer = null
            assistantMessagesScroll = null
            assistantStatusView = null
            showDashboard()
        })
        val identityRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(this@MainActivity, 10), 0, dp(this@MainActivity, 8))
        }
        identityRow.addView(createAssistantAvatar(72, registerHeader = true, emotion = "happy"), LinearLayout.LayoutParams(dp(this, 72), dp(this, 72)).apply { marginEnd = dp(this@MainActivity, 13) })
        val identityInfo = ll().apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        identityInfo.addView(txt("SO ASSISTANT", 11f, PURPLE, bold=true, ls=0.16f, bot=3))
        identityInfo.addView(txt("A tu lado en SynthesisOne", 18f, TEXT, bold=true, bot=4))
        identityInfo.addView(txt("Elegante, curiosa y atenta. Pregunta lo que necesites; yo me encargo de orientarte.", 10.5f, TEXT2))
        assistantMoodView = txt("ALEGRE · SO ASSISTANT", 8f, MUTED, bold = true, top = 5)
        identityInfo.addView(assistantMoodView)
        identityRow.addView(identityInfo)
        root.addView(identityRow)
        val assistantQuickActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 9) }
        }
        assistantQuickActions.addView(btn("⌖  ENCONTRAR RESELLER").apply {
            textSize = 8.5f
            isAllCaps = false
            setTextColor(TEXT)
            background = roundedBackground(SURFACE2, 11, PURPLE, 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 42), 1f).apply { marginEnd = dp(this@MainActivity, 6) }
            setOnClickListener { startResellerNavigationGuide() }
        })
        assistantQuickActions.addView(btn("GUÍA RÁPIDA").apply {
            textSize = 8.5f
            isAllCaps = false
            setTextColor(TEXT)
            background = roundedBackground(SURFACE2, 11, blendSurfaceColor(PURPLE, MUTED, .25f), 1)
            layoutParams = LinearLayout.LayoutParams(0, dp(this@MainActivity, 42), 1f)
            setOnClickListener { showAssistantQuickTour() }
        })
        root.addView(assistantQuickActions)
        if (prefs.getString("client_role", "client").equals("admin", true)) {
            root.addView(btn("✦  DIAGNÓSTICO OPERATIVO · ADMIN").apply {
                textSize = 9f
                isAllCaps = false
                setTextColor(TEXT)
                background = roundedBackground(SURFACE2, 11, RED, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 42)).apply { bottomMargin = dp(this@MainActivity, 9) }
                setOnClickListener { showAdminAssistantInsights() }
            })
        }

        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(this@MainActivity, 8)
            }
        }
        assistantStatusView = txt("Comprobando disponibilidad…", 10f, MUTED)
        actionRow.addView(assistantStatusView, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val humanSupport = btn("CONTACTAR SOPORTE").apply {
            textSize = 9f
            isAllCaps = false
            setTextColor(TEXT)
            setPadding(dp(this@MainActivity, 9), dp(this@MainActivity, 7), dp(this@MainActivity, 9), dp(this@MainActivity, 7))
            background = roundedBackground(SURFACE, 10, PURPLE, 1)
            setOnClickListener {
                assistantScreenActive = false
                assistantMessagesContainer = null
                assistantMessagesScroll = null
                assistantStatusView = null
                showSupportInbox()
            }
        }
        actionRow.addView(humanSupport)
        root.addView(actionRow)

        val messagesScroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
                bottomMargin = dp(this@MainActivity, 9)
            }
            background = roundedBackground(SURFACE, 16, blendSurfaceColor(PURPLE, MUTED, 0.28f), 1)
            setPadding(dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10), dp(this@MainActivity, 10))
        }
        assistantMessagesContainer = ll().apply { orientation = LinearLayout.VERTICAL }
        messagesScroll.addView(assistantMessagesContainer)
        assistantMessagesScroll = messagesScroll
        root.addView(messagesScroll)

        if (assistantHistory.isEmpty()) {
            val greetings = listOf(
                Triple("Vaya, por fin nos conocemos. Soy SO Assistant. ✦\n\nPuedo ayudarte a encontrar funciones, comparar ofertas y entender tus operaciones. Si detecto algo que convenga revisar, te lo diré con claridad.\n\nY una cosa: no compartas contraseñas, códigos SMS, claves ni datos completos de tarjetas por este chat.", "happy", "wave"),
                Triple("Ah, llegas justo a tiempo. Soy SO Assistant. ✦\n\nCuéntame qué necesitas y veremos cómo resolverlo. Prometo ser amable… salvo que estés a punto de transferir dinero sin comprobar algo importante.", "playful", "wink"),
                Triple("Mmm… una nueva conversación. Interesante. Soy SO Assistant. ✦\n\nConozco los rincones de SynthesisOne y puedo ayudarte a encontrar lo que buscas, comparar opciones o revisar una operación.", "curious", "tilt"),
                Triple("Bienvenido. Soy SO Assistant. ✦\n\nNo necesitas memorizar cada menú. Puedo orientarte, explicar tus opciones y avisarte cuando algo merezca una segunda mirada.", "confident", "nod")
            )
            val greeting = greetings[Random().nextInt(greetings.size)]
            updateAssistantAvatarState(greeting.second, greeting.third)
            appendAssistantBubble("assistant", greeting.first, greeting.second, greeting.third)
        } else {
            assistantHistory.forEach { (role, content) -> appendAssistantBubble(role, content) }
        }

        val composer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val input = EditText(this).apply {
            hint = "Escribe tu pregunta…"
            setTextColor(TEXT); setHintTextColor(MUTED)
            textSize = 14f; minLines = 1; maxLines = 4
            filters = arrayOf(InputFilter.LengthFilter(1400))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 11), dp(this@MainActivity, 12), dp(this@MainActivity, 11))
            background = roundedBackground(SURFACE2, 13, MUTED, 1)
        }
        val send = btn("ENVIAR").apply {
            textSize = 10f
            setTextColor(contrastingTextColor(RED))
            background = roundedBackground(RED, 12, RED, 1)
            isEnabled = false
            layoutParams = LinearLayout.LayoutParams(dp(this@MainActivity, 88), dp(this@MainActivity, 48)).apply {
                marginStart = dp(this@MainActivity, 8)
            }
        }
        composer.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        composer.addView(send)
        root.addView(composer)
        rootFrame.addView(root)

        send.setOnClickListener {
            val message = input.text.toString().trim()
            if (message.isBlank()) return@setOnClickListener
            if (message.length > 1400) {
                showSoToast("La pregunta es demasiado larga.", Toast.LENGTH_SHORT)
                return@setOnClickListener
            }
            if (isResellerNavigationRequest(message)) {
                assistantHistory.add("user" to message)
                assistantHistory.add("assistant" to "¡Claro! Te guiaré hasta SO Reseller desde Ajustes.")
                while (assistantHistory.size > 12) assistantHistory.removeAt(0)
                startResellerNavigationGuide()
                return@setOnClickListener
            }
            if (send.tag != true) {
                showSoToast("El asistente todavía no está disponible.", Toast.LENGTH_SHORT)
                return@setOnClickListener
            }
            send.isEnabled = false
            updateAssistantAvatarState("thinking", "think")
            assistantStatusView?.text = "Preparando respuesta…"
            uiScope.launch {
                val historyJson = JSONArray()
                assistantHistory.takeLast(8).forEach { (role, content) ->
                    historyJson.put(JSONObject().put("role", role).put("content", content))
                }
                historyJson.put(JSONObject().put("role", "user").put("content", message))
                val response = withContext(Dispatchers.IO) {
                    runCatching {
                        backendRequest("/api/assistant/chat", "POST", token, JSONObject().put("messages", historyJson))
                    }.getOrNull()
                }
                if (!assistantScreenActive) return@launch
                val data = response?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
                if (response != null && response.code in 200..299 && data?.optBoolean("ok", false) == true) {
                    val reply = data.optString("reply", "").trim()
                    val emotion = data.optString("emotion", "neutral")
                    val gesture = data.optString("gesture", "neutral")
                    if (reply.isNotBlank()) {
                        assistantHistory.add("user" to message)
                        assistantHistory.add("assistant" to reply)
                        while (assistantHistory.size > 12) assistantHistory.removeAt(0)
                        appendAssistantBubble("user", message)
                        updateAssistantAvatarState(emotion, gesture)
                        appendAssistantBubble("assistant", reply, emotion, gesture)
                        input.setText("")
                    }
                    val remaining = data.optInt("remaining_today", -1)
                    assistantStatusView?.text = if (remaining >= 0) "Asistente conectado · $remaining preguntas disponibles hoy" else "Asistente conectado"
                } else {
                    val error = data?.optString("error")?.takeIf { it.isNotBlank() }
                        ?: if (response == null) "No se pudo conectar. Comprueba tu conexión." else "No se pudo generar una respuesta. Inténtalo nuevamente."
                    assistantStatusView?.text = error
                    updateAssistantAvatarState("concerned", "alert")
                    appendAssistantBubble("assistant", error, "concerned", "alert")
                }
                send.isEnabled = send.tag == true
            }
        }

        val supportSummaryButton = btn("✦  PREPARAR RESUMEN PARA SOPORTE").apply {
            textSize = 9f
            isAllCaps = false
            setTextColor(TEXT)
            background = roundedBackground(SURFACE2, 11, PURPLE, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 40)).apply {
                bottomMargin = dp(this@MainActivity, 8)
            }
            setOnClickListener {
                input.setText("Prepara un resumen breve de mis pedidos recientes, pagos pendientes y estado de mi Wallet para enviarlo a soporte. Distingue lo confirmado de lo pendiente y no incluyas contraseñas, códigos ni datos privados.")
                send.performClick()
            }
        }
        root.addView(supportSummaryButton, root.indexOfChild(composer))

        uiScope.launch {
            val config = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/assistant/config", token = token) }.getOrNull()
            }
            if (!assistantScreenActive) return@launch
            val data = config?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
            val enabled = config != null && config.code in 200..299 && data?.optBoolean("enabled", false) == true
            send.tag = enabled
            send.isEnabled = enabled
            assistantStatusView?.text = when {
                enabled -> "Asistente conectado · listo para ayudarte"
                config == null -> "Sin conexión con el servicio. Comprueba Internet."
                config.code == 401 || config.code == 403 -> "Vuelve a conectar tu cuenta para usar el asistente."
                else -> "El asistente todavía no está configurado."
            }
            if (!enabled) send.alpha = 0.55f
        }
    }


    private fun scheduleFirstVisitAssistantTutor() {
        if (prefs.getBoolean(PREF_SO_ASSISTANT_TUTOR_SEEN, false)) return
        if (storeAccessToken().isBlank()) return
        handler.postDelayed({
            if (!isFinishing && !isDestroyed && assistantAlertView == null) {
                prefs.edit().putBoolean(PREF_SO_ASSISTANT_TUTOR_SEEN, true).apply()
                showAssistantProactiveAlert(
                    "SO Assistant te da la bienvenida",
                    "Puedo ayudarte a encontrar funciones, entender tus pedidos, revisar cupones y detectar situaciones que requieren atención. En Juegos encontrarás Game Market; en Actividad, tus operaciones; y en Ajustes, tu perfil y SO Reseller. Pulsa ✦ cuando necesites ayuda.",
                    showWhatsApp = false
                )
            }
        }, 12_000L)
    }

    private fun showAssistantContextualTip(section: String) {
        val tip = when (section) {
            "activity" -> "En Actividad puedes revisar tus movimientos y el estado de los tickets. Si un pedido sigue pendiente, consulta primero ese ticket antes de volver a pagar."
            "cash" -> "El Libro de caja resume los movimientos registrados. Recuerda que CUP y Saldo Móvil son balances independientes."
            "market" -> "En Game Market puedes comparar ofertas antes de comprar. Comprueba siempre región, contenido y precio del paquete seleccionado."
            else -> return
        }
        val seen = prefs.getStringSet(PREF_SO_ASSISTANT_CONTEXT_TIPS, emptySet())?.toMutableSet() ?: mutableSetOf()
        if (!seen.add(section)) return
        prefs.edit().putStringSet(PREF_SO_ASSISTANT_CONTEXT_TIPS, seen).apply()
        handler.postDelayed({
            if (!isFinishing && !isDestroyed && !assistantScreenActive) {
                showAssistantProactiveAlert("Consejo contextual · ${section.uppercase(Locale.ROOT)}", tip, showWhatsApp = false)
            }
        }, 550L)
    }

    private fun pollProactiveAssistantInsights() {
        if (assistantInsightsPollInFlight || !isDeviceOnline()) return
        val token = storeAccessToken()
        if (token.isBlank()) return
        assistantInsightsPollInFlight = true
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/assistant/insights", token = token) }.getOrNull()
            }
            assistantInsightsPollInFlight = false
            if (isFinishing || isDestroyed || response == null || response.code !in 200..299) return@launch
            val data = runCatching { JSONObject(response.body) }.getOrNull() ?: return@launch
            val events = data.optJSONArray("events") ?: JSONArray()
            val seen = mutableListOf<String>()
            runCatching {
                val saved = JSONArray(prefs.getString(PREF_SO_ASSISTANT_SEEN_INSIGHTS, "[]").orEmpty())
                for (i in 0 until saved.length()) saved.optString(i).takeIf { it.isNotBlank() }?.let { seen.add(it) }
            }
            val seenSet = seen.toMutableSet()
            var selected: JSONObject? = null
            for (i in 0 until events.length()) {
                val event = events.optJSONObject(i) ?: continue
                val id = event.optString("event_id", "").trim()
                if (id.isBlank() || id in seenSet) continue
                selected = event
                seen.add(id)
                seenSet.add(id)
                break
            }
            if (selected == null) return@launch
            val savedIds = JSONArray()
            seen.distinct().takeLast(80).forEach { savedIds.put(it) }
            prefs.edit().putString(PREF_SO_ASSISTANT_SEEN_INSIGHTS, savedIds.toString()).apply()
            val title = selected.optString("title", "SO Assistant · Aviso").take(90)
            val message = selected.optString("message", "Hay una actualización en tu cuenta. Consulta el historial para ver los detalles.").take(700)
            val severity = selected.optString("severity", "info")
            val eventKind = selected.optString("kind", "")
            val needsHumanSupport = severity == "critical" || eventKind in setOf("payment_review", "missing_details", "support_review")
            if (assistantScreenActive) {
                appendAssistantBubble("assistant", "$title\n$message")
            } else {
                showAssistantProactiveAlert(title, message, showWhatsApp = needsHumanSupport)
            }
        }
    }

    private fun buildRewardsAssistantAdvice(data: JSONObject): View? {
        val coupons = data.optJSONArray("coupons") ?: JSONArray()
        val availableCoupons = (0 until coupons.length()).mapNotNull { coupons.optJSONObject(it) }
            .filter { it.optString("status", "").equals("AVAILABLE", true) }
        val missions = data.optJSONArray("missions") ?: JSONArray()
        val nearMission = (0 until missions.length()).mapNotNull { missions.optJSONObject(it) }
            .firstOrNull { mission ->
                val progress = mission.optInt("progress", 0)
                val target = mission.optInt("target", 0)
                !mission.optBoolean("completed", false) && target > 1 && progress > 0 && progress >= target - 1
            }
        val profile = data.optJSONObject("profile") ?: JSONObject()
        val codesLeft = profile.optInt("referral_codes_until_next_coupon", -1)
        val welcome = data.optJSONObject("welcome")
        val welcomeRemainingMs = welcome?.optLong("remaining_ms", 0L) ?: 0L
        val welcomeExpiring = welcome?.optBoolean("available", false) == true && welcomeRemainingMs in 1L..(6L * 60L * 60L * 1000L)
        val title: String
        val message: String
        when {
            availableCoupons.isNotEmpty() -> {
                title = "Tienes ${availableCoupons.size} cupón(es) disponible(s)"
                message = "Antes de comprar, revisa el porcentaje, el mínimo de compra, la moneda y el vencimiento. Los cupones solo se aplican cuando el carrito cumple sus condiciones."
            }
            nearMission != null -> {
                title = "Estás cerca de completar una misión"
                val progress = nearMission.optInt("progress", 0)
                val target = nearMission.optInt("target", 0)
                message = "${nearMission.optString("title", "Tu misión")}: $progress de $target. ${nearMission.optString("reward", "Revisa la recompensa al completarla.")}"
            }
            welcomeExpiring -> {
                val remainingHours = welcomeRemainingMs / 3_600_000.0
                title = "Tu oferta de bienvenida está por terminar"
                message = "Quedan aproximadamente ${String.format(Locale.getDefault(), "%.1f", remainingHours)} horas de tu ventana de bienvenida. Comprueba que tu primera compra elegible sea en CUP y revisa el total antes de confirmar."
            }
            codesLeft in 1..3 -> {
                title = "Casi alcanzas otra recompensa"
                message = "Te faltan $codesLeft código(s) de referido para alcanzar el siguiente cupón por esta actividad. Introduce únicamente códigos de personas que conozcas."
            }
            else -> return null
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 10), dp(this@MainActivity, 12), dp(this@MainActivity, 10))
            background = roundedBackground(blendSurfaceColor(SURFACE2, PURPLE, .13f), 13, PURPLE, 1)
            addView(txt("✦  SO ASSISTANT · CONSEJO", 9f, PURPLE, bold = true, bot = 4))
            addView(txt(title, 12f, TEXT, bold = true, bot = 3))
            addView(txt(message, 10f, TEXT2))
            setOnClickListener { showAiAssistant() }
        }
    }

    private fun showAssistantQuickTour() {
        val message = "INICIO\nConsulta el resumen y la actividad reciente.\n\nACTIVIDAD\nRevisa tickets, pagos y estados. Si un ticket sigue activo, no pagues otra vez sin comprobarlo.\n\nJUEGOS\nCompara paquetes de la misma región y modalidad antes de comprar.\n\nWALLET\nCUP y Saldo Móvil son saldos distintos. Comprueba el método de pago y la disponibilidad antes de transferir.\n\nAJUSTES\nEncuentra tu perfil, recompensas y SO Reseller. Puedes pedirme que te guíe hasta Reseller.\n\nSEGURIDAD\nNunca compartas contraseñas, códigos SMS/OTP ni claves privadas."
        ThemedAlertDialogBuilder(this)
            .setTitle("Guía rápida de SynthesisOne")
            .setMessage(message)
            .setPositiveButton("Entendido", null)
            .setNeutralButton("Ir a recompensas") { _, _ -> openRewardsEntry() }
            .show()
    }

    private fun showAdminAssistantInsights() {
        val token = storeAccessToken()
        if (token.isBlank() || !isDeviceOnline()) {
            showSoToast("Necesitas conexión y una sesión activa para consultar el diagnóstico.", Toast.LENGTH_LONG)
            return
        }
        showSoToast("Consultando indicadores operativos…", Toast.LENGTH_SHORT)
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/assistant/admin/insights", token = token) }.getOrNull()
            }
            val body = response?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (response == null || response.code !in 200..299 || body == null || !body.optBoolean("ok", false)) {
                val error = body?.optString("error")?.takeIf { it.isNotBlank() } ?: "No se pudo cargar el diagnóstico operativo."
                showSoToast(error, Toast.LENGTH_LONG)
                return@launch
            }
            val summary = body.optJSONObject("summary") ?: JSONObject()
            val report = StringBuilder()
            report.append("Servicio: ${summary.optString("service", "—")}  ·  Base de datos: ${summary.optString("database", "—")}\n\n")
            report.append("Incidencias abiertas: ${summary.optInt("open_incidents", 0)}\n")
            report.append("Críticas: ${summary.optInt("critical_incidents", 0)}\n")
            report.append("Pagos en revisión: ${summary.optInt("payment_reviews", 0)}\n")
            report.append("Tickets Wallet vencidos: ${summary.optInt("overdue_wallet_tickets", 0)}\n")
            report.append("Devoluciones pendientes: ${summary.optInt("pending_refunds", 0)}\n")
            report.append("Pedidos Game Market atascados: ${summary.optInt("stuck_game_orders", 0)}\n")
            report.append("Pedidos ETECSA atascados: ${summary.optInt("stuck_etecsa_orders", 0)}\n")
            report.append("Webhooks con fallos recientes: ${summary.optInt("webhook_failures", 0)}\n\n")
            val insights = body.optJSONArray("insights") ?: JSONArray()
            for (i in 0 until insights.length()) {
                val item = insights.optJSONObject(i) ?: continue
                val label = when (item.optString("severity")) { "critical" -> "CRÍTICO"; "warning" -> "ATENCIÓN"; "success" -> "BIEN"; else -> "INFO" }
                report.append("[$label] ${item.optString("title")}\n")
                report.append("${item.optString("message")}\n")
                report.append("Recomendación: ${item.optString("recommendation")}\n\n")
            }
            val scroll = ScrollView(this@MainActivity).apply {
                isFillViewport = true
                addView(txt(report.toString().trim(), 11f, TEXT).apply { setPadding(dp(this@MainActivity, 16), dp(this@MainActivity, 12), dp(this@MainActivity, 16), dp(this@MainActivity, 12)) })
            }
            val dialog = ThemedAlertDialogBuilder(this@MainActivity)
                .setTitle("SO Assistant · Diagnóstico administrativo")
                .setView(scroll)
                .setPositiveButton("Cerrar", null)
                .setNeutralButton("Actualizar") { _, _ -> showAdminAssistantInsights() }
                .create()
            dialog.setOnShowListener { styleSoDialog(dialog, expanded = true) }
            dialog.show()
        }
    }

    private fun appendAssistantBubble(role: String, message: String, emotion: String = "neutral", gesture: String = "neutral") {
        val container = assistantMessagesContainer ?: return
        val isAssistant = role == "assistant"
        val bubble = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(if (isAssistant) TEXT else Color.WHITE)
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 10), dp(this@MainActivity, 12), dp(this@MainActivity, 10))
            maxWidth = (resources.displayMetrics.widthPixels * if (isAssistant) 0.73f else 0.82f).toInt()
            background = roundedBackground(
                if (isAssistant) Color.parseColor("#211B36") else Color.parseColor("#5140A5"),
                14,
                if (isAssistant) blendSurfaceColor(PURPLE, MUTED, 0.40f) else Color.TRANSPARENT,
                if (isAssistant) 1 else 0
            )
        }
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = if (isAssistant) Gravity.START or Gravity.BOTTOM else Gravity.END
            setPadding(0, 0, 0, dp(this@MainActivity, 9))
        }
        if (isAssistant) {
            val messageAvatar = createAssistantAvatar(34, false, emotion)
            line.addView(messageAvatar, LinearLayout.LayoutParams(dp(this, 34), dp(this, 34)).apply { marginEnd = dp(this@MainActivity, 7) })
            messageAvatar.post {
                messageAvatar.pivotX = dp(this@MainActivity, 17).toFloat()
                messageAvatar.pivotY = dp(this@MainActivity, 17).toFloat()
                when (gesture) {
                    "wave", "wink", "tilt", "shrug", "sigh", "peek" -> messageAvatar.animate().rotation(if (gesture == "wink" || gesture == "peek") 4f else -4f).setDuration(190L).withEndAction { if (messageAvatar.isAttachedToWindow) messageAvatar.animate().rotation(0f).setDuration(210L).start() }.start()
                    "bounce", "celebrate" -> messageAvatar.animate().translationY(-dp(this@MainActivity, 4).toFloat()).setDuration(160L).withEndAction { if (messageAvatar.isAttachedToWindow) messageAvatar.animate().translationY(0f).setDuration(200L).start() }.start()
                    "nod" -> messageAvatar.animate().translationY(dp(this@MainActivity, 3).toFloat()).setDuration(140L).withEndAction { if (messageAvatar.isAttachedToWindow) messageAvatar.animate().translationY(0f).setDuration(160L).start() }.start()
                }
            }
            line.addView(bubble, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 1) })
        } else {
            line.addView(bubble, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        container.addView(line)
        assistantMessagesScroll?.post { assistantMessagesScroll?.fullScroll(View.FOCUS_DOWN) }
    }

    private fun showSupportInbox() {
        val token = storeAccessToken()
        if (token.isBlank()) {
            showSoToast("Activa tu licencia para contactar con soporte desde la app.", Toast.LENGTH_LONG)
            return
        }
        stopSupportPolling()
        supportScreenActive = true
        rootFrame.removeAllViews()
        val root = ll().apply {
            setBackgroundColor(BG)
            setPadding(dp(this@MainActivity,18), dp(this@MainActivity,28), dp(this@MainActivity,18), dp(this@MainActivity,12))
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(futuristicBackButton("←  VOLVER") { stopSupportPolling(); showDashboard() })
        root.addView(txt("SOPORTE", 11f, RED, bold=true, ls=0.14f, top=14, bot=4))
        root.addView(txt("Escríbenos y recibirás la respuesta aquí mismo.", 13f, TEXT2, bot=8))
        supportStatusView = txt("Conectando con soporte…", 10f, MUTED, bot=8)
        root.addView(supportStatusView)

        val messagesScroll = ScrollView(this).apply {
            isFillViewport = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
                bottomMargin = dp(this@MainActivity,10)
            }
            background = roundedBackground(SURFACE, 10, Color.TRANSPARENT, 0)
            setPadding(dp(this@MainActivity,10), dp(this@MainActivity,10), dp(this@MainActivity,10), dp(this@MainActivity,10))
        }
        supportMessagesContainer = ll().apply { orientation = LinearLayout.VERTICAL }
        messagesScroll.addView(supportMessagesContainer)
        supportMessagesScroll = messagesScroll
        root.addView(messagesScroll)

        val composer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(this@MainActivity,4), 0, 0)
        }
        val input = EditText(this).apply {
            hint = "Escribe tu mensaje…"
            setTextColor(TEXT); setHintTextColor(MUTED)
            textSize = 14f; minLines = 2; maxLines = 4
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setPadding(dp(this@MainActivity,12), dp(this@MainActivity,10), dp(this@MainActivity,12), dp(this@MainActivity,10))
            background = roundedBackground(SURFACE2, 10, MUTED, 1)
        }
        val send = btn("ENVIAR MENSAJE").apply {
            textSize = 11f
            setTextColor(contrastingTextColor(RED)); background = roundedBackground(RED, 10, RED, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(this@MainActivity,8) }
        }
        composer.addView(input); composer.addView(send)
        root.addView(composer)
        rootFrame.addView(root)

        send.setOnClickListener {
            val message = input.text.toString().trim()
            if (message.isBlank()) {
                showSoToast("Escribe un mensaje primero.", Toast.LENGTH_SHORT)
                return@setOnClickListener
            }
            if (message.length > 4000) {
                showSoToast("El mensaje es demasiado largo.", Toast.LENGTH_SHORT)
                return@setOnClickListener
            }
            send.isEnabled = false
            uiScope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        backendRequest("/api/support/messages", "POST", token, JSONObject().put("message", message))
                    }.getOrNull()
                }
                send.isEnabled = true
                val data = result?.body?.let { runCatching { JSONObject(it) }.getOrNull() }
                if (result != null && result.code in 200..299 && data?.optBoolean("ok", false) == true) {
                    input.setText("")
                    supportStatusView?.text = "Mensaje enviado · revisa esta bandeja para ver la respuesta."
                    handler.postDelayed({ refreshSupportMessages(silent = true) }, 600L)
                } else {
                    val error = data?.optString("error", "No se pudo enviar") ?: "No se pudo conectar con soporte"
                    supportStatusView?.text = "❌ $error"
                    showSoToast(error, Toast.LENGTH_LONG)
                }
            }
        }
        refreshSupportMessages(silent = false)
        supportPollRunnable = object : Runnable {
            override fun run() {
                if (!supportScreenActive) return
                refreshSupportMessages(silent = true)
                handler.postDelayed(this, 10_000L)
            }
        }
        handler.postDelayed(supportPollRunnable!!, 10_000L)
    }

    private fun refreshSupportMessages(silent: Boolean) {
        if (!supportScreenActive || supportRefreshInFlight) return
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) return
        supportRefreshInFlight = true
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/support/messages?limit=200", token = token) }.getOrNull()
            }
            supportRefreshInFlight = false
            if (!supportScreenActive || supportMessagesContainer == null) return@launch
            if (response == null || response.code !in 200..299) {
                if (!silent) supportStatusView?.text = "No se pudo cargar la bandeja. Comprueba tu conexión."
                return@launch
            }
            val json = runCatching { JSONObject(response.body) }.getOrNull()
            val messages = json?.optJSONArray("messages")
            if (messages == null) {
                if (!silent) supportStatusView?.text = "Respuesta de soporte no válida."
                return@launch
            }
            val container = supportMessagesContainer ?: return@launch
            container.removeAllViews()
            if (messages.length() == 0) {
                container.addView(txt("Todavía no hay mensajes. Escribe abajo para iniciar una conversación.", 12f, MUTED, top=8, bot=8))
            } else {
                for (i in 0 until messages.length()) {
                    val item = messages.optJSONObject(i) ?: continue
                    val role = item.optString("sender_role", "client")
                    val message = item.optString("message", "")
                    val created = item.optString("created_at", "")
                    val stamp = parseIsoDate(created)?.let { formatDateTime(it) } ?: created
                    val bubble = TextView(this@MainActivity).apply {
                        text = "$message\n\n${if (role == "admin") "SOPORTE" else "TÚ"} · $stamp"
                        textSize = 13f
                        setTextColor(if (role == "admin") TEXT else TEXT2)
                        setPadding(dp(this@MainActivity,12), dp(this@MainActivity,10), dp(this@MainActivity,12), dp(this@MainActivity,10))
                        maxWidth = resources.displayMetrics.widthPixels - dp(this@MainActivity,74)
                        background = roundedBackground(if (role == "admin") Color.parseColor("#241B35") else SURFACE2, 12, if (role == "admin") RED else Color.TRANSPARENT, if (role == "admin") 1 else 0)
                    }
                    val line = LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = if (role == "admin") Gravity.START else Gravity.END
                        setPadding(0, 0, 0, dp(this@MainActivity,8))
                        addView(bubble, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                    }
                    container.addView(line)
                }
            }
            supportStatusView?.text = if (messages.length() == 0) "Soporte disponible · los mensajes se actualizan automáticamente" else "${messages.length()} mensajes · actualización automática cada 10 segundos"
            supportMessagesScroll?.post { supportMessagesScroll?.fullScroll(View.FOCUS_DOWN) }
        }
    }

    private fun stopSupportPolling() {
        supportScreenActive = false
        supportPollRunnable?.let { handler.removeCallbacks(it) }
        supportPollRunnable = null
        supportRefreshInFlight = false
        supportMessagesContainer = null
        supportMessagesScroll = null
        supportStatusView = null
    }

    private fun checkForAppUpdate(showIfCurrent: Boolean) {
        if (!isDeviceOnline()) {
            if (showIfCurrent) showSoToast("Conéctate a internet para comprobar actualizaciones.", Toast.LENGTH_LONG)
            return
        }
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) {
            if (showIfCurrent) showSoToast("Inicia sesión para comprobar actualizaciones.", Toast.LENGTH_LONG)
            return
        }
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/app-updates/latest", token = token) }.getOrNull()
            }
            if (response == null || response.code !in 200..299) {
                if (showIfCurrent) showSoToast("No se pudo comprobar si hay una actualización disponible.", Toast.LENGTH_LONG)
                return@launch
            }
            val json = runCatching { JSONObject(response.body) }.getOrNull() ?: JSONObject()
            val releaseJson = json.optJSONObject("release")
            if (!json.optBoolean("available", false) || releaseJson == null) {
                if (showIfCurrent) showSoToast("Tienes la versión más reciente disponible.", Toast.LENGTH_LONG)
                return@launch
            }
            val release = AppRelease(
                versionCode = releaseJson.optLong("version_code", 0L),
                versionName = releaseJson.optString("version_name", "").trim(),
                releaseNotes = releaseJson.optString("release_notes", "").trim(),
                publishedAt = releaseJson.optString("published_at", "").trim(),
                sha256 = releaseJson.optString("sha256", "").trim().lowercase(Locale.ROOT),
                sizeBytes = releaseJson.optLong("size_bytes", 0L),
                downloadEndpoint = releaseJson.optString("download_endpoint", "/api/app-updates/download")
            )
            if (release.versionCode <= BuildConfig.VERSION_CODE.toLong()) {
                if (showIfCurrent) showSoToast("Tienes la versión más reciente disponible.", Toast.LENGTH_LONG)
                return@launch
            }
            showReleaseNotesDialog(release)
        }
    }

    private fun showReleaseNotesDialog(release: AppRelease) {
        if (isFinishing || isDestroyed) return
        val content = ll().apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 6), dp(this@MainActivity, 4), dp(this@MainActivity, 6), dp(this@MainActivity, 4))
        }
        content.addView(txt("Versión ${release.versionName.ifBlank { release.versionCode.toString() }}", 16f, TEXT, bold = true, bot = 5))
        val sizeLabel = if (release.sizeBytes > 0L) "Tamaño aproximado: ${String.format(Locale.getDefault(), "%.1f", release.sizeBytes / 1024.0 / 1024.0)} MB" else "Actualización disponible"
        content.addView(txt(sizeLabel, 10f, MUTED, bot = 12))
        content.addView(txt("NOVEDADES DE ESTA VERSIÓN", 9f, PURPLE, bold = true, ls = .08f, bot = 5))
        content.addView(txt(release.releaseNotes.ifBlank { "Hay una nueva versión disponible." }, 12f, TEXT2, bot = 10))
        if (release.publishedAt.isNotBlank()) {
            val date = parseIsoDate(release.publishedAt)?.let { formatDateTime(it) } ?: release.publishedAt
            content.addView(txt("Publicada: $date", 9f, MUTED, top = 2))
        }
        val scroll = ScrollView(this).apply { isFillViewport = false; addView(content) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Actualización disponible")
            .setView(scroll).setPositiveButton("DESCARGAR ACTUALIZACIÓN", null)
            .setNegativeButton("Más tarde", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                dialog.dismiss()
                downloadAndInstallRelease(release)
            }
        }
        dialog.show()
    }

    private fun downloadAndInstallRelease(release: AppRelease) {
        if (!isDeviceOnline()) {
            showSoToast("Conéctate a internet para descargar la actualización.", Toast.LENGTH_LONG)
            return
        }
        val progressText = txt("Descargando y verificando el archivo…", 12f, TEXT2, top = 6, bot = 12)
        val progressBar = ProgressBar(this).apply { isIndeterminate = true }
        val progressView = ll().apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(this@MainActivity, 22), dp(this@MainActivity, 12), dp(this@MainActivity, 22), dp(this@MainActivity, 12))
            addView(progressText); addView(progressBar)
        }
        val progressDialog = ThemedAlertDialogBuilder(this).setTitle("Descargando actualización")
            .setView(progressView).setCancelable(false).create()
        progressDialog.show()
        styleSoDialog(progressDialog)
        uiScope.launch {
            val downloaded = withContext(Dispatchers.IO) {
                runCatching {
                    val baseDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: File(cacheDir, "updates")
                    if (!baseDir.exists() && !baseDir.mkdirs()) throw IllegalStateException("No se pudo preparar el almacenamiento temporal")
                    val target = File(baseDir, "SynthesisOne-update-${release.versionCode}.apk")
                    val endpoint = release.downloadEndpoint.ifBlank { "/api/app-updates/download" }
                    if (!endpoint.startsWith("/api/app-updates/")) throw IllegalStateException("Ruta de actualización no válida")
                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                    if (token.isBlank()) throw IllegalStateException("Inicia sesión para descargar la actualización.")
                    val connection = (URL("$BACKEND_BASE_URL$endpoint").openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 20000
                        readTimeout = 120000
                        instanceFollowRedirects = true
                        setRequestProperty("Authorization", "Bearer $token")
                        setRequestProperty("Accept", "application/vnd.android.package-archive")
                        setRequestProperty("Cache-Control", "no-cache")
                    }
                    try {
                        val code = connection.responseCode
                        if (code !in 200..299) {
                            val errorBody = runCatching { connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty() }.getOrDefault("")
                            val message = runCatching { JSONObject(errorBody).optString("error") }.getOrDefault("")
                            throw IllegalStateException(message.ifBlank { "No se pudo descargar la actualización (código $code)." })
                        }
                        val length = connection.contentLengthLong
                        if (length > 80L * 1024L * 1024L) throw IllegalStateException("El archivo de actualización supera el tamaño permitido.")
                        connection.inputStream.use { input -> target.outputStream().buffered().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var total = 0L
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                if (total > 80L * 1024L * 1024L) throw IllegalStateException("El archivo de actualización supera el tamaño permitido.")
                                output.write(buffer, 0, count)
                            }
                        } }
                    } finally { connection.disconnect() }
                    if (!target.exists() || target.length() < 1024L) throw IllegalStateException("El archivo descargado está vacío o incompleto.")
                    val digest = MessageDigest.getInstance("SHA-256")
                    target.inputStream().buffered().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            digest.update(buffer, 0, count)
                        }
                    }
                    val checksum = digest.digest().joinToString("") { "%02x".format(it) }
                    if (release.sha256.isNotBlank() && !checksum.equals(release.sha256, ignoreCase = true)) {
                        target.delete()
                        throw IllegalStateException("La comprobación de seguridad del archivo no coincide. No se instalará.")
                    }
                    val signingFlags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
                    val packageInfo = packageManager.getPackageArchiveInfo(target.absolutePath, signingFlags)
                        ?: throw IllegalStateException("El archivo descargado no es una aplicación válida.")
                    val downloadedVersionCode = if (Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else packageInfo.versionCode.toLong()
                    if (packageInfo.packageName != packageName || downloadedVersionCode != release.versionCode) {
                        target.delete()
                        throw IllegalStateException("El archivo no corresponde a la versión anunciada de SynthesisOne.")
                    }
                    validateUpdateSigner(packageInfo)
                    target
                }
            }
            progressDialog.dismiss()
            downloaded.onSuccess { file ->
                pendingDownloadedUpdate = file
                pendingUpdateInstallPrompt = true
                tryInstallPendingUpdateIfAllowed()
            }.onFailure { error ->
                android.util.Log.e("SynthesisOne_Update", "No se pudo completar una descarga de actualización", error)
                showSoToast(error.message?.takeIf { it.isNotBlank() } ?: "No se pudo descargar la actualización.", Toast.LENGTH_LONG)
            }
        }
    }

    private fun tryInstallPendingUpdateIfAllowed() {
        val file = pendingDownloadedUpdate ?: return
        if (!file.exists()) { pendingDownloadedUpdate = null; return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            if (!pendingUpdateInstallPrompt) return
            pendingUpdateInstallPrompt = false
            val dialog = ThemedAlertDialogBuilder(this).setTitle("Permitir instalación")
                .setMessage("Android necesita tu permiso para instalar la actualización que acabas de descargar. Activa «Permitir desde esta fuente» para SynthesisOne y vuelve aquí.")
                .setPositiveButton("Abrir ajustes", null).setNegativeButton("Ahora no", null).create()
            dialog.setOnShowListener {
                styleSoDialog(dialog)
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    dialog.dismiss()
                    awaitingInstallPermission = true
                    try { startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")), REQUEST_INSTALL_PERMISSION) }
                    catch (_: Exception) { awaitingInstallPermission = false; showSoToast("Abre los ajustes de Android y permite instalar aplicaciones para SynthesisOne.", Toast.LENGTH_LONG) }
                }
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener { dialog.dismiss(); pendingDownloadedUpdate = null }
            }
            dialog.show()
            return
        }
        pendingDownloadedUpdate = null
        pendingUpdateInstallPrompt = false
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (error: Exception) {
            android.util.Log.e("SynthesisOne_Update", "No se pudo abrir el instalador del sistema", error)
            showSoToast("La descarga está completa, pero Android no pudo abrir el instalador. Inténtalo desde el botón de actualizaciones.", Toast.LENGTH_LONG)
        }
    }

    private fun openAppUpdatePicker() {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) { showSoToast("Inicia sesión con una cuenta administradora para publicar una versión.", Toast.LENGTH_LONG); return }
        uiScope.launch {
            val role = withContext(Dispatchers.IO) { fetchClientRole(token) }
            if (role != "admin") { showSoToast("Esta función está disponible únicamente para administradores.", Toast.LENGTH_LONG); return@launch }
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/vnd.android.package-archive", "application/octet-stream"))
            }
            try { startActivityForResult(intent, REQUEST_APP_UPDATE_APK) }
            catch (_: Exception) { showSoToast("No se pudo abrir el selector de archivos APK.", Toast.LENGTH_LONG) }
        }
    }

    @Suppress("DEPRECATION")
    private fun signingCertificateFingerprint(info: android.content.pm.PackageInfo): String? {
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        if (signatures.isNullOrEmpty()) return null
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) }
        }.sorted().joinToString("|")
    }

    @Suppress("DEPRECATION")
    private fun validateUpdateSigner(archive: android.content.pm.PackageInfo) {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = packageManager.getPackageInfo(packageName, flags)
        val archiveFingerprint = signingCertificateFingerprint(archive)
        val installedFingerprint = signingCertificateFingerprint(installed)
        if (archiveFingerprint.isNullOrBlank() || installedFingerprint.isNullOrBlank() || archiveFingerprint != installedFingerprint) {
            throw IllegalStateException("El APK debe estar firmado con la misma clave que la versión instalada de SynthesisOne.")
        }
    }

    @Suppress("DEPRECATION")
    private fun handleSelectedUpdateApk(uri: Uri) {
        val tempDir = File(cacheDir, "updates-admin")
        uiScope.launch {
            val parsed = withContext(Dispatchers.IO) {
                runCatching {
                    if (!tempDir.exists() && !tempDir.mkdirs()) throw IllegalStateException("No se pudo preparar el archivo temporal.")
                    val file = File(tempDir, "selected-${System.currentTimeMillis()}.apk")
                    contentResolver.openInputStream(uri)?.use { input -> file.outputStream().buffered().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > 80L * 1024L * 1024L) throw IllegalStateException("El APK supera el límite de 80 MB.")
                            output.write(buffer, 0, count)
                        }
                    } } ?: throw IllegalStateException("No se pudo leer el APK seleccionado.")
                    if (file.length() < 1024L) throw IllegalStateException("El archivo está vacío o incompleto.")
                    val signingFlags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
                    val archive = packageManager.getPackageArchiveInfo(file.absolutePath, signingFlags)
                        ?: throw IllegalStateException("El archivo no es un APK válido.")
                    if (archive.packageName != packageName) throw IllegalStateException("El APK seleccionado no pertenece a SynthesisOne.")
                    validateUpdateSigner(archive)
                    val versionCode = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
                    if (versionCode <= BuildConfig.VERSION_CODE.toLong()) throw IllegalStateException("El APK debe tener un número de versión superior a la versión instalada en este teléfono.")
                    Triple(file, versionCode, archive.versionName.orEmpty().ifBlank { versionCode.toString() })
                }
            }
            parsed.onSuccess { (file, versionCode, versionName) -> showPublishUpdateNotesDialog(file, versionCode, versionName) }
                .onFailure { error -> showSoToast(error.message ?: "No se pudo validar el APK.", Toast.LENGTH_LONG) }
        }
    }

    private fun showPublishUpdateNotesDialog(file: File, versionCode: Long, versionName: String) {
        val notes = EditText(this).apply {
            hint = "Describe los cambios que notarán los clientes…"
            setTextColor(TEXT); setHintTextColor(MUTED); textSize = 13f
            minLines = 5; maxLines = 10; gravity = Gravity.TOP or Gravity.START
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 10), dp(this@MainActivity, 12), dp(this@MainActivity, 10))
            background = roundedBackground(SURFACE2, 10, MUTED, 1)
        }
        val content = ll().apply { orientation = LinearLayout.VERTICAL; setPadding(dp(this@MainActivity, 6), dp(this@MainActivity, 4), dp(this@MainActivity, 6), dp(this@MainActivity, 4)) }
        content.addView(txt("Versión ${versionName.ifBlank { versionCode.toString() }} · ${String.format(Locale.getDefault(), "%.1f", file.length() / 1024.0 / 1024.0)} MB", 12f, TEXT, bold = true, bot = 10))
        content.addView(txt("Estas notas aparecerán a los clientes antes de que descarguen la actualización.", 10f, TEXT2, bot = 8))
        content.addView(notes)
        val scroll = ScrollView(this).apply { addView(content) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Publicar actualización")
            .setView(scroll).setPositiveButton("PUBLICAR", null).setNegativeButton("Cancelar", null).create()
        dialog.setOnShowListener {
            styleSoDialog(dialog)
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val releaseNotes = notes.text.toString().trim()
                if (releaseNotes.isBlank()) { notes.error = "Describe las novedades antes de publicar"; return@setOnClickListener }
                if (releaseNotes.length > 3000) { notes.error = "Máximo 3.000 caracteres"; return@setOnClickListener }
                dialog.dismiss()
                uploadAppUpdate(file, versionCode, versionName, releaseNotes)
            }
        }
        dialog.show()
    }

    private fun uploadAppUpdate(file: File, versionCode: Long, versionName: String, notes: String) {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) { showSoToast("Inicia sesión como administrador antes de publicar.", Toast.LENGTH_LONG); return }
        val query = "version_code=$versionCode&version_name=${java.net.URLEncoder.encode(versionName, "UTF-8")}"
        val notesHeader = android.util.Base64.encodeToString(notes.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
        val progress = ThemedAlertDialogBuilder(this).setTitle("Publicando versión")
            .setMessage("Subiendo el APK y guardando las notas de actualización…")
            .setCancelable(false).create()
        progress.show(); styleSoDialog(progress)
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching {
                    val connection = (URL("$BACKEND_BASE_URL/api/app-updates/publish?$query").openConnection() as HttpURLConnection).apply {
                        requestMethod = "PUT"; connectTimeout = 20000; readTimeout = 180000
                        doOutput = true
                        setRequestProperty("Authorization", "Bearer $token")
                        setRequestProperty("Content-Type", "application/vnd.android.package-archive")
                        setRequestProperty("X-Release-Notes-Base64", notesHeader)
                        setRequestProperty("Accept", "application/json")
                        setFixedLengthStreamingMode(file.length())
                    }
                    try {
                        connection.outputStream.use { output -> file.inputStream().buffered().use { input -> input.copyTo(output, 64 * 1024) } }
                        val code = connection.responseCode
                        val body = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
                        BackendResponse(code, body)
                    } finally { connection.disconnect() }
                }
            }
            progress.dismiss()
            response.onSuccess { result ->
                val json = runCatching { JSONObject(result.body) }.getOrNull() ?: JSONObject()
                if (result.code in 200..299 && json.optBoolean("ok", false)) {
                    file.delete()
                    val oldDeleted = json.optBoolean("old_file_deleted", true)
                    val message = if (oldDeleted) "La versión ${versionName.ifBlank { versionCode.toString() }} quedó publicada. Los clientes verán las notas antes de descargarla." else "La nueva versión quedó publicada, pero el archivo anterior no se pudo eliminar automáticamente. Revisa el registro de administración."
                    ThemedAlertDialogBuilder(this@MainActivity).setTitle("Publicación completada").setMessage(message).setPositiveButton("Aceptar", null).show().also { styleSoDialog(it) }
                } else {
                    val message = json.optString("error", "No se pudo publicar la actualización (código ${result.code}).")
                    showSoToast(message, Toast.LENGTH_LONG)
                }
            }.onFailure { error ->
                android.util.Log.e("SynthesisOne_Update", "No se pudo publicar una versión", error)
                showSoToast(error.message?.takeIf { it.isNotBlank() } ?: "No se pudo publicar la actualización.", Toast.LENGTH_LONG)
            }
        }
    }

    private fun parsePaymentDestinations(array: JSONArray): List<PaymentDestination> {
        val items = mutableListOf<PaymentDestination>()
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            val id = row.optString("id", "").trim()
            val card = row.optString("card_number", row.optString("card", "")).trim()
            val phone = row.optString("confirmation_phone", row.optString("phone", "")).trim()
            if (id.isBlank() || card.isBlank() || phone.isBlank()) continue
            items.add(PaymentDestination(id, row.optString("label", "Cuenta de transferencia ${index + 1}"), card, phone))
        }
        return items
    }

    private fun copyPaymentValue(label: String, value: String) {
        if (value.isBlank()) return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(label, value))
        showSoToast("$label copiado.", Toast.LENGTH_SHORT)
    }

    private fun choosePaymentDestination(
        destinations: List<PaymentDestination>,
        currentId: String = "",
        onSelected: (PaymentDestination) -> Unit
    ) {
        if (destinations.isEmpty()) {
            showSoToast("No hay cuentas receptoras activas. No realices la transferencia y vuelve a intentarlo más tarde.", Toast.LENGTH_LONG)
            return
        }
        if (destinations.size == 1) {
            onSelected(destinations.first())
            return
        }
        val rows = ll().apply { setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 4), dp(this@MainActivity, 12), dp(this@MainActivity, 8)) }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(rows) }
        val dialog = ThemedAlertDialogBuilder(this).setTitle("Elegir cuenta receptora")
            .setMessage("Selecciona una cuenta. La tarjeta y el número de confirmación se mantienen siempre juntos para este pago.")
            .setView(scroll).setNegativeButton("Cancelar", null).create()
        destinations.forEachIndexed { index, destination ->
            val itemCard = ll().apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(this@MainActivity, 12), dp(this@MainActivity, 12), dp(this@MainActivity, 12), dp(this@MainActivity, 12))
                background = roundedBackground(SURFACE2, 12, if (destination.id == currentId) PURPLE else MUTED, 1)
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(this@MainActivity, 9) }
            }
            itemCard.addView(txt(destination.label.ifBlank { "Cuenta de transferencia ${index + 1}" }, 12f, TEXT, bold = true, bot = 8))
            itemCard.addView(txt("TARJETA RECEPTORA", 9f, TEXT2, bold = true, bot = 2))
            val cardRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            cardRow.addView(txt(destination.card, 13f, TEXT, bold = true).apply { typeface = Typeface.MONOSPACE; layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
            cardRow.addView(btn("COPIAR").apply { textSize = 8f; setOnClickListener { copyPaymentValue("Tarjeta receptora", destination.card) } })
            itemCard.addView(cardRow)
            itemCard.addView(txt("NÚMERO DE CONFIRMACIÓN", 9f, TEXT2, bold = true, top = 8, bot = 2))
            val phoneRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            phoneRow.addView(txt(destination.confirmationPhone, 13f, TEXT, bold = true).apply { typeface = Typeface.MONOSPACE; layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
            phoneRow.addView(btn("COPIAR").apply { textSize = 8f; setOnClickListener { copyPaymentValue("Número de confirmación", destination.confirmationPhone) } })
            itemCard.addView(phoneRow)
            itemCard.addView(btn(if (destination.id == currentId) "USAR ESTA CUENTA ✓" else "USAR ESTA CUENTA").apply {
                textSize = 9f; layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(this@MainActivity, 38)).apply { topMargin = dp(this@MainActivity, 10) }
                setOnClickListener { dialog.dismiss(); onSelected(destination) }
            })
            rows.addView(itemCard)
        }
        dialog.setOnShowListener { styleSoDialog(dialog) }
        dialog.show()
    }

    private fun choosePaymentDestinationForCheckout(token: String, onSelected: (String) -> Unit) {
        uiScope.launch {
            val response = withContext(Dispatchers.IO) {
                runCatching { backendRequest("/api/system/payment-destinations", token = token) }.getOrNull()
            }
            val json = runCatching { JSONObject(response?.body.orEmpty()) }.getOrNull() ?: JSONObject()
            if (response == null || response.code !in 200..299) {
                showAssistantProactiveAlert(
                    "No pudimos verificar el pago",
                    "No se confirmó la disponibilidad de las transferencias. No envíes dinero todavía; contacta con soporte para comprobar el estado."
                )
                return@launch
            }
            if (json.has("automation_enabled") && !json.optBoolean("automation_enabled", false)) {
                val detail = json.optString("automation_message", "La automatización está temporalmente desactivada.")
                showAssistantProactiveAlert(
                    "No realices la transferencia",
                    "$detail No envíes dinero ahora. Contacta al equipo por WhatsApp antes de volver a intentarlo."
                )
                return@launch
            }
            val destinations = parsePaymentDestinations(json.optJSONArray("destinations") ?: JSONArray())
            if (destinations.isEmpty()) {
                showAssistantProactiveAlert(
                    "No hay cuentas receptoras disponibles",
                    "No pudimos confirmar una cuenta de pago activa. No realices la transferencia; contacta con soporte para recibir instrucciones."
                )
                return@launch
            }
            choosePaymentDestination(destinations, prefs.getString(PREF_SELECTED_PAYMENT_DESTINATION, "").orEmpty()) { selected ->
                prefs.edit().putString(PREF_SELECTED_PAYMENT_DESTINATION, selected.id).apply()
                onSelected(selected.id)
            }
        }
    }

    private fun fetchPaymentConfig(phoneNumber: String = ""): PaymentConfig? {
        return try {
            val phoneQuery = if (phoneNumber.isNotBlank()) "?phone_number=${java.net.URLEncoder.encode(phoneNumber, "UTF-8")}" else ""
            val url = URL("$BACKEND_BASE_URL/api/onboarding/config$phoneQuery")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Cache-Control", "no-cache")
            conn.connectTimeout = 5_000
            conn.readTimeout = 5_000
            val code = conn.responseCode
            if (code !in 200..299) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            val p = json.optJSONObject("payment") ?: return null
            val amount = if (p.has("amount") && !p.isNull("amount")) p.optDouble("amount") else null
            val destinationsJson = p.optJSONArray("destinations") ?: JSONArray()
            val destinations = parsePaymentDestinations(destinationsJson)
            PaymentConfig(
                amount = amount,
                currency = p.optString("currency", "CUP"),
                card = p.optString("card", "").takeIf { it.isNotBlank() },
                confirmationPhone = p.optString("confirmation_phone", "").takeIf { it.isNotBlank() },
                durationDays = p.optInt("duration_days", 30),
                priceType = p.optString("price_type", "initial"),
                automationEnabled = json.optBoolean("automation_enabled", false) && (json.optBoolean("configured", true)),
                automationMessage = json.optString("automation_message", "La automatización está temporalmente no disponible."),
                destinationId = p.optString("destination_id", destinations.firstOrNull()?.id.orEmpty()),
                destinations = destinations
            )
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun startPaymentWindow(destinationId: String = ""): Boolean {
        val activationId = prefs.getString(SyncService.KEY_ACTIVATION_ID, "").orEmpty()
        val secret = prefs.getString(SyncService.KEY_ACTIVATION_SECRET, "").orEmpty()
        if (activationId.isBlank() || secret.isBlank()) return false
        return try {
            val url = URL("https://parser-bot-9y8n.onrender.com/api/onboarding/start")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-Activation-Secret", secret)
            conn.doOutput = true
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val payload = JSONObject().apply { put("activation_id", activationId); if (destinationId.isNotBlank()) put("payment_destination_id", destinationId) }.toString()
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            if (code !in 200..299) return false
            val activation = JSONObject(body).optJSONObject("activation") ?: return false
            prefs.edit().apply {
                putString(SyncService.KEY_ACTIVATION_STATE, activation.optString("status", "WAITING_PAYMENT"))
                parseIsoDate(activation.optString("payment_started_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT, it) }
                parseIsoDate(activation.optString("payment_deadline_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT, it) }
                parseIsoDate(activation.optString("confirmation_deadline_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, it) }
                putLong(SyncService.KEY_ONBOARDING_LAST_SMS_ID, -1L)
            }.apply()
            SyncService.scheduleActivationWake(this@MainActivity, 15_000L)
            true
        } catch (_: Exception) { false }
    }

    private fun prepareActivationRetryState() {
        // Marca la sesión local como expirada para desbloquear un nuevo intento,
        // pero conserva activation_id + secret para que una activación que haya
        // quedado confirmada en el servidor pueda recuperarse al sincronizar.
        prefs.edit()
            .putString(SyncService.KEY_ACTIVATION_STATE, "EXPIRED")
            .apply()
        SyncService.cancelActivationWake(this@MainActivity)
    }

    private data class StoreSessionResult(
        val token: String? = null,
        val error: String? = null
    ) {
        val ok: Boolean get() = !token.isNullOrBlank()
    }

    private fun isStoreOnlySession(): Boolean =
        prefs.getBoolean(SyncService.KEY_STORE_ONLY_SESSION, false) &&
            prefs.getString(SyncService.KEY_STORE_TOKEN, "").orEmpty().isNotBlank()

    private fun startFreeStoreSession(phoneRaw: String, button: Button, status: TextView) {
        val existingStoreToken = prefs.getString(SyncService.KEY_STORE_TOKEN, "").orEmpty()
        if (existingStoreToken.isNotBlank()) {
            prefs.edit().apply {
                putBoolean(SyncService.KEY_STORE_ONLY_SESSION, true)
                putString(SyncService.KEY_LICENSE_STATE, "STORE_ONLY")
                putBoolean("activated", false)
                remove(SyncService.KEY_TOKEN)
                remove("client_role")
            }.commit()
            showDashboard()
            return
        }
        val phone = normalizeClientPhone(phoneRaw)
        if (!isValidPhone(phone)) {
            status.setTextColor(ERR)
            status.text = "Introduce un móvil cubano válido para abrir la tienda."
            return
        }
        if (!isDeviceOnline()) {
            status.setTextColor(ERR)
            status.text = "Necesitas conexión a Internet para crear la sesión gratuita."
            return
        }
        button.isEnabled = false
        button.text = "PREPARANDO TIENDA…"
        status.setTextColor(TEXT2)
        status.text = "Creando una sesión segura sin licencia…"
        prefs.edit().putString("phone_number", phone).apply()
        uiScope.launch {
            val result = withContext(Dispatchers.IO) { registerStoreOnlySession(phone) }
            if (result.ok) {
                // A store-only token must never be sent as a paid license token to
                // the personal SMS automation API. Keep the credentials separate.
                prefs.edit().apply {
                    putString(SyncService.KEY_STORE_TOKEN, result.token)
                    putBoolean(SyncService.KEY_STORE_ONLY_SESSION, true)
                    putString(SyncService.KEY_LICENSE_STATE, "STORE_ONLY")
                    putBoolean("activated", false)
                    remove(SyncService.KEY_TOKEN)
                    remove("client_role")
                }.commit()
                showDashboard()
                showSoToast("Tienda oficial abierta. No necesitas comprar una licencia.", Toast.LENGTH_LONG)
            } else {
                status.setTextColor(ERR)
                status.text = result.error ?: "No se pudo crear la sesión gratuita. Inténtalo de nuevo."
                button.isEnabled = true
                button.text = if (button.text.toString().contains("CONTINUAR GRATIS")) "🛍 CONTINUAR GRATIS A GAME MARKET" else "🛍  ENTRAR A GAME MARKET SIN LICENCIA"
            }
        }
    }

    private fun registerStoreOnlySession(phoneNumber: String): StoreSessionResult {
        return try {
            val deviceId = prefs.getString(SyncService.KEY_DEVICE_ID, "").orEmpty().ifBlank { ensureDeviceId() }
            var secret = prefs.getString(SyncService.KEY_STORE_SESSION_SECRET, "").orEmpty().trim().lowercase(Locale.ROOT)
            if (secret.isBlank()) {
                val random = ByteArray(32)
                java.security.SecureRandom().nextBytes(random)
                secret = random.joinToString("") { b -> "%02x".format(Locale.ROOT, b.toInt() and 0xff) }
                // Persist before the network request so retries use the same secret.
                if (!prefs.edit().putString(SyncService.KEY_STORE_SESSION_SECRET, secret).commit()) {
                    return StoreSessionResult(error = "No se pudo guardar la clave local de la sesión. Inténtalo otra vez.")
                }
            }
            val payload = JSONObject().apply {
                put("phone_number", phoneNumber)
                put("device_id", deviceId)
                put("store_secret", secret)
            }
            val response = backendRequest("/api/store-session/register", "POST", payload = payload)
            val json = runCatching { JSONObject(response.body) }.getOrNull()
            if (response.code !in 200..299) {
                val message = json?.optString("error", "").orEmpty().ifBlank {
                    when (response.code) {
                        0 -> "No se pudo conectar con el servidor."
                        409 -> "No se pudo crear la sesión de tienda; inténtalo nuevamente."
                        else -> "El servidor rechazó la sesión gratuita (HTTP ${response.code})."
                    }
                }
                return StoreSessionResult(error = message)
            }
            val token = json?.optString("store_token", "")?.takeIf { it.isNotBlank() }
            if (token == null) StoreSessionResult(error = "El servidor no devolvió el acceso a la tienda.")
            else StoreSessionResult(token = token)
        } catch (_: Exception) {
            StoreSessionResult(error = "No se pudo conectar con el servidor para abrir la tienda gratuita.")
        }
    }

    private data class OnboardingRegisterResult(
        val ok: Boolean,
        val existingActive: Boolean = false,
        val error: String? = null,
        val errorCode: String? = null
    )

    private suspend fun registerOnboarding(phoneNumber: String): OnboardingRegisterResult {
        return try {
            val url = URL("https://parser-bot-9y8n.onrender.com/api/onboarding/register")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val payload = JSONObject().apply {
                put("phone_number", phoneNumber)
                put("device_id", ensureDeviceId())
                put("app_version", BuildConfig.VERSION_NAME)
            }.toString()
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText().orEmpty()
            val json = runCatching { JSONObject(body) }.getOrNull()
            if (code !in 200..299 || json == null) {
                val errorCode = json?.optString("code", "")?.takeIf { it.isNotBlank() }
                val friendlyError = when {
                    errorCode == "DEVICE_MISMATCH" -> "⚠️ Este número ya tiene una licencia activa, pero está asociado a otro dispositivo. Por seguridad, el número por sí solo no permite recuperar la cuenta."
                    errorCode == "AUTOMATION_UNAVAILABLE" -> json?.optString("error", "La automatización no está disponible. No realices el pago.") ?: "La automatización no está disponible. No realices el pago."
                    else -> json?.optString("error", "❌ No se puede conectar con el servidor.")?.takeIf { it.isNotBlank() } ?: "❌ No se puede conectar con el servidor."
                }
                return OnboardingRegisterResult(false, error = friendlyError, errorCode = errorCode)
            }

            // El backend puede recuperar una licencia activa existente tras una reinstalación.
            if (json.optBoolean("existing_active", false)) {
                val client = json.optJSONObject("client") ?: return OnboardingRegisterResult(false, error = "❌ El servidor no devolvió el cliente activo")
                val token = client.optString("token", "").trim()
                if (token.isBlank()) return OnboardingRegisterResult(false, error = "❌ El servidor no devolvió el token del cliente activo")

                val recoveredDeviceId = client.optString("device_id", "").trim().ifBlank { ensureDeviceId() }
                prefs.edit().apply {
                    putString("phone_number", client.optString("phone_number", phoneNumber))
                    putString(SyncService.KEY_DEVICE_ID, recoveredDeviceId)
                    putString(SyncService.KEY_TOKEN, token)
                    putBoolean(SyncService.KEY_STORE_ONLY_SESSION, false)
                    putBoolean("activated", true)
                    putString(SyncService.KEY_LICENSE_STATE, "ACTIVE")
                    putLong(SyncService.KEY_LICENSE_ACTIVATED_AT, parseIsoDate(client.optString("created_at", "")) ?: System.currentTimeMillis())
                    parseIsoDate(client.optString("expires_at", ""))?.let { putLong(SyncService.KEY_LICENSE_EXPIRES_AT, it) }
                    putString("card1", client.optString("card1", ""))
                    putString("card2", client.optString("card2", ""))
                    putString("card3", client.optString("card3", ""))
                    putString("wallet", client.optString("wallet", ""))
                    remove(SyncService.KEY_ACTIVATION_ID)
                    remove(SyncService.KEY_ACTIVATION_SECRET)
                    remove(SyncService.KEY_ACTIVATION_STATE)
                    remove(SyncService.KEY_ACTIVATION_CREATED_AT)
                    remove(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT)
                    remove(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
                    remove(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
                    remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
                }.apply()
                SyncService.cancelActivationWake(this@MainActivity)
                return OnboardingRegisterResult(true, existingActive = true)
            }

            val activation = json.optJSONObject("activation") ?: return OnboardingRegisterResult(false, error = "❌ Respuesta de activación incompleta")
            val activationId = activation.optString("activation_id", "")
            val secret = activation.optString("activation_secret", "")
            if (activationId.isBlank() || secret.isBlank()) return OnboardingRegisterResult(false, error = "❌ Faltan las credenciales de activación")
            prefs.edit().apply {
                putString(SyncService.KEY_ACTIVATION_ID, activationId)
                putString(SyncService.KEY_ACTIVATION_SECRET, secret)
                putString(SyncService.KEY_ACTIVATION_STATE, activation.optString("status", "READY_TO_PAY"))
                putLong(SyncService.KEY_ACTIVATION_CREATED_AT, parseIsoDate(activation.optString("created_at", "")) ?: System.currentTimeMillis())
                activation.optString("payment_started_at", "").takeIf { it.isNotBlank() }?.let { v -> parseIsoDate(v)?.let { t -> putLong(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT, t) } }
                activation.optString("payment_deadline_at", "").takeIf { it.isNotBlank() }?.let { v -> parseIsoDate(v)?.let { t -> putLong(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT, t) } }
                activation.optString("confirmation_deadline_at", "").takeIf { it.isNotBlank() }?.let { v -> parseIsoDate(v)?.let { t -> putLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, t) } }
                remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
            }.apply()
            OnboardingRegisterResult(true)
        } catch (e: Exception) {
            OnboardingRegisterResult(false, error = "❌ No se puede conectar con el servidor.")
        }
    }

    private fun checkOnboardingStatus() {
        val activationId = prefs.getString(SyncService.KEY_ACTIVATION_ID, "").orEmpty()
        val secret = prefs.getString(SyncService.KEY_ACTIVATION_SECRET, "").orEmpty()
        if (activationId.isBlank() || secret.isBlank()) return

        uiScope.launch {
            val body = withContext(Dispatchers.IO) {
                try {
                    val encoded = java.net.URLEncoder.encode(activationId, "UTF-8")
                    val url = URL("https://parser-bot-9y8n.onrender.com/api/onboarding/status?activation_id=$encoded")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "GET"
                    conn.setRequestProperty("X-Activation-Secret", secret)
                    conn.connectTimeout = 5_000
                    conn.readTimeout = 5_000
                    val code = conn.responseCode
                    (if (code in 200..299) conn.inputStream else conn.errorStream)
                        ?.bufferedReader()?.readText().orEmpty()
                } catch (_: Exception) {
                    ""
                }
            }
            if (body.isBlank()) return@launch
            val json = runCatching { JSONObject(body) }.getOrNull() ?: return@launch
            val activation = json.optJSONObject("activation") ?: return@launch
            val state = activation.optString("status", "")
            prefs.edit().apply {
                if (state.isNotBlank()) putString(SyncService.KEY_ACTIVATION_STATE, state)
                parseIsoDate(activation.optString("payment_started_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT, it) }
                parseIsoDate(activation.optString("payment_deadline_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT, it) }
                parseIsoDate(activation.optString("confirmation_deadline_at", ""))?.let { putLong(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT, it) }
            }.apply()
            val token = activation.optString("token", "").takeIf { it.isNotBlank() }
            if (token != null && state.equals("ACTIVATED", true)) {
                val now = System.currentTimeMillis()
                val expiresAt = parseIsoDate(activation.optJSONObject("client")?.optString("expires_at", null))
                prefs.edit().apply {
                    putString(SyncService.KEY_TOKEN, token)
                    putBoolean(SyncService.KEY_STORE_ONLY_SESSION, false)
                    putString(SyncService.KEY_LICENSE_STATE, "ACTIVE")
                    putBoolean("activated", true)
                    putLong(SyncService.KEY_LICENSE_ACTIVATED_AT, now)
                    if (expiresAt != null) putLong(SyncService.KEY_LICENSE_EXPIRES_AT, expiresAt)
                    putString(SyncService.KEY_ACTIVATION_STATE, "ACTIVATED")
                    putString(SyncService.KEY_LAST_SYNC_STATUS, "LICENSE_ACTIVATED")
                    remove(SyncService.KEY_ACTIVATION_ID)
                    remove(SyncService.KEY_ACTIVATION_SECRET)
                    remove(SyncService.KEY_ACTIVATION_STATE)
                    remove(SyncService.KEY_ACTIVATION_CREATED_AT)
                    remove(SyncService.KEY_ACTIVATION_PAYMENT_STARTED_AT)
                    remove(SyncService.KEY_ACTIVATION_PAYMENT_DEADLINE_AT)
                    remove(SyncService.KEY_ACTIVATION_CONFIRMATION_DEADLINE_AT)
                    remove(SyncService.KEY_ONBOARDING_LAST_SMS_ID)
                }.apply()
                SyncService.cancelActivationWake(this@MainActivity)
                NotificationService.showLicenseActivatedNotificationOnce(this@MainActivity, token)

                ThemedAlertDialogBuilder(this@MainActivity)
                    .setTitle("✅ Pago detectado")
                    .setMessage("El pago fue identificado automáticamente. Tu token ya fue generado y activado en este dispositivo. Ahora solo falta vincular tus tarjetas.")
                    .setPositiveButton("CONTINUAR", null)
                    .setOnDismissListener { if (!isFinishing) showClientProfileSetup() }
                    .show()
            } else if (state.isNotBlank()) {
                prefs.edit().putString(SyncService.KEY_ACTIVATION_STATE, state).apply()
                if (state.equals("EXPIRED", true) && activationCountdownView != null && !isFinishing) {
                    handler.post { showActivation() }
                }
            }
        }
    }

    private fun showClientProfileSetup() {
        handler.removeCallbacks(activationTicker)
        activationCountdownView = null
        rootFrame.removeAllViews()
        val scroll = ScrollView(this).apply { setBackgroundColor(BG) }
        val layout = ll().apply {
            setPadding(dp(this@MainActivity,28), dp(this@MainActivity,60),
                dp(this@MainActivity,28), dp(this@MainActivity,48))
        }

        layout.addView(txt("SYNTHESISONE", 11f, RED, bold=true, ls=0.15f, bot=8))
        layout.addView(txt("Completa tu perfil", 26f, TEXT, bold=true, bot=6))
        layout.addView(txt("Tu pago ya fue confirmado y tu licencia ya está activa. Ahora vincula tus tarjetas para que SynthesisOne pueda identificar correctamente tus movimientos.", 14f, TEXT2, bot=22))
        layout.addView(gradientDivider())
        layout.addView(txt("Teléfono registrado: ${prefs.getString("phone_number", "")}", 12f, BLUE, bold=true, bot=18))

        layout.addView(lbl("TARJETAS VINCULADAS (hasta 3)"))
        layout.addView(txt("Solo guardamos los primeros 4 y últimos 4 dígitos. Vincula al menos una tarjeta.", 12f, TEXT2, bot=12))

        val savedCard1 = prefs.getString("card1", "").orEmpty().split("-")
        val savedCard2 = prefs.getString("card2", "").orEmpty().split("-")
        val savedCard3 = prefs.getString("card3", "").orEmpty().split("-")

        val c1a = inp("Tarjeta 1 — primeros 4", maxLen=4, numeric=true).apply { setText(savedCard1.getOrNull(0).orEmpty()) }
        val c1b = inp("Tarjeta 1 — últimos 4", maxLen=4, numeric=true).apply { setText(savedCard1.getOrNull(1).orEmpty()) }
        val c2a = inp("Tarjeta 2 — primeros 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard2.getOrNull(0).orEmpty()) }
        val c2b = inp("Tarjeta 2 — últimos 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard2.getOrNull(1).orEmpty()) }
        val c3a = inp("Tarjeta 3 — primeros 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard3.getOrNull(0).orEmpty()) }
        val c3b = inp("Tarjeta 3 — últimos 4 (opcional)", maxLen=4, numeric=true).apply { setText(savedCard3.getOrNull(1).orEmpty()) }
        layout.addView(row2(c1a, c1b)); layout.addView(row2(c2a, c2b)); layout.addView(row2(c3a, c3b))

        layout.addView(lbl("NÚMERO DE MONEDERO", top=24))
        layout.addView(txt("Opcional: número asociado a tu monedero MiTransfer.", 12f, TEXT2, bot=12))
        val walletIn = inp("Ej: 5359190241", maxLen=10, numeric=true).apply { setText(prefs.getString("wallet", "").orEmpty()) }

        layout.addView(walletIn)
        val statusMsg = txt("", 13f, ERR, bot=14)
        layout.addView(statusMsg)

        val saveBtn = btn("GUARDAR PERFIL Y CONTINUAR")
        layout.addView(saveBtn)

        saveBtn.setOnClickListener {
            val phone = prefs.getString("phone_number", "").orEmpty()
            val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
            val c1aV = c1a.text.toString().trim()
            val c1bV = c1b.text.toString().trim()
            if (!isValidPhone(phone)) { statusMsg.text = "⚠️ Falta el teléfono registrado"; return@setOnClickListener }
            if (token.isBlank()) { statusMsg.text = "⚠️ La licencia todavía no está disponible"; return@setOnClickListener }
            if (c1aV.length != 4 || c1bV.length != 4) { statusMsg.text = "⚠️ Vincula al menos una tarjeta (4+4 dígitos)"; return@setOnClickListener }

            val card1 = "$c1aV-$c1bV"
            val card2 = if (c2a.text.length==4 && c2b.text.length==4) "${c2a.text}-${c2b.text}" else ""
            val card3 = if (c3a.text.length==4 && c3b.text.length==4) "${c3a.text}-${c3b.text}" else ""
            val wallet = walletIn.text.toString().trim()

            saveBtn.isEnabled = false
            saveBtn.text = "GUARDANDO..."
            statusMsg.text = ""

            uiScope.launch {
                val result = withContext(Dispatchers.IO) { saveClientProfile(token, phone, card1, card2, card3, wallet) }
                if (result.ok) {
                    prefs.edit().apply {
                        putString("card1", card1)
                        if (card2.isNotBlank()) putString("card2", card2) else remove("card2")
                        if (card3.isNotBlank()) putString("card3", card3) else remove("card3")
                        if (wallet.isNotBlank()) putString("wallet", wallet) else remove("wallet")
                    }.apply()
                    requestPerms()
                    DailyReportReceiver.schedule(this@MainActivity)
                    NotificationService.updateDailyFlow(this@MainActivity)
                    showDashboard()
                } else {
                    statusMsg.text = result.error ?: "❌ No se pudo guardar el perfil"
                    saveBtn.isEnabled = true
                    saveBtn.text = "GUARDAR PERFIL Y CONTINUAR"
                }
            }
        }

        scroll.addView(layout); rootFrame.addView(scroll)
    }

    private data class ProfileSaveResult(val ok: Boolean, val error: String? = null)

    private fun saveClientProfile(
        token: String, phoneNumber: String, card1: String, card2: String, card3: String, wallet: String
    ): ProfileSaveResult {
        return try {
            val url = URL("https://parser-bot-9y8n.onrender.com/api/auth/profile")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "PUT"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val payload = JSONObject().apply {
                put("device_id", ensureDeviceId())
                put("phone_number", phoneNumber)
                put("card1", card1)
                put("card2", card2)
                put("card3", card3)
                put("wallet", wallet)
            }.toString()
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText().orEmpty()
            if (code in 200..299) {
                ProfileSaveResult(true)
            } else {
                ProfileSaveResult(false, "❌ No se pudo actualizar la información en el servidor.")
            }
        } catch (e: Exception) {
            ProfileSaveResult(false, "❌ No se puede conectar con el servidor.")
        }
    }

    private suspend fun verifyToken(
        token: String, phoneNumber: String,
        card1: String, card2: String, card3: String, wallet: String
    ): VerificationResult {
        return try {
            val url = URL("https://parser-bot-9y8n.onrender.com/api/auth/verify")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val payload = JSONObject().apply {
                put("device_id", ensureDeviceId())
                put("phone_number", phoneNumber)
                put("card1", card1)
                put("card2", card2)
                put("card3", card3)
                put("wallet", wallet)
            }.toString()
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(payload.toByteArray()) }
            val code = conn.responseCode
            val body = runCatching {
                (if (code in 200..299) conn.inputStream else conn.errorStream)
                    ?.bufferedReader()?.readText().orEmpty()
            }.getOrNull().orEmpty()

            if (code == 200) {
                val parsed = runCatching { JSONObject(body) }.getOrNull()
                val clientObj = parsed?.optJSONObject("client")
                val expiresAtMs = parseIsoDate(clientObj?.optString("expires_at", null))
                val licenseState = clientObj?.optString("license_status", null)
                    ?: parsed?.optString("status", null)
                VerificationResult(ok=true, rawBody=body, licenseState=licenseState, expiresAt=expiresAtMs)
            } else {
                when (code) {
                    403 -> {
                        // Verificar si es "REVOKED" o "USED"
                        val bodyLower = body.lowercase()
                        val state = if (bodyLower.contains("revocado") || bodyLower.contains("revoked")) {
                            "REVOKED"
                        } else {
                            "USED"
                        }
                        // Si es REVOKED, limpiar el estado local inmediatamente
                        if (state == "REVOKED") {
                            prefs.edit().putString(SyncService.KEY_LICENSE_STATE, "REVOKED").apply()
                        }
                        VerificationResult(ok=false, rawBody=body, licenseState=state)
                    }
                    404 -> {
                        // Cliente no encontrado → también revocar
                        prefs.edit().putString(SyncService.KEY_LICENSE_STATE, "REVOKED").apply()
                        VerificationResult(ok=false, rawBody=body, licenseState="REVOKED")
                    }
                    else -> VerificationResult(ok=false, rawBody=body, licenseState=null)
                }
            }

        } catch (e: Exception) {
            VerificationResult(ok=false, rawBody="", licenseState=null)
        }
    }
    private fun buildLicenseCard(): View {
        val snap = readLicenseSnapshot()
        val now = System.currentTimeMillis()
        val total = (snap.expiresAt - snap.activatedAt).coerceAtLeast(1L)
        val remain = (snap.expiresAt - now).coerceAtLeast(0L)
        val daysLeft = (remain / (24L * 60 * 60 * 1000)).toInt()
        val expired = snap.expiresAt > 0 && now >= snap.expiresAt
        val stateColor = when {
            expired || snap.state.equals("EXPIRED", true) || snap.state.equals("REVOKED", true) -> ERR
            snap.state.equals("TRIAL", true) -> BLUE
            else -> GREEN
        }
        val stateText = when {
            expired -> "EXPIRADA"
            snap.state.equals("TRIAL", true) -> "PRUEBA"
            snap.state.equals("REVOKED", true) -> "REVOCADA"
            else -> "ACTIVA"
        }
        val card = ll().apply {
            setPadding(dp(this@MainActivity,18), dp(this@MainActivity,17), dp(this@MainActivity,18), dp(this@MainActivity,17))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(SURFACE2, Color.parseColor("#171923"))).apply {
                cornerRadius = dp(this@MainActivity,18).toFloat()
            }
            elevation = dp(this@MainActivity,4).toFloat()
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                setMargins(0, dp(this@MainActivity,12), 0, dp(this@MainActivity,14))
            }
        }
        val top=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL}
        val left=ll().apply{layoutParams=LinearLayout.LayoutParams(0,ViewGroup.LayoutParams.WRAP_CONTENT,1f)}
        left.addView(txt("LICENCIA",9f,MUTED,bold=true,ls=0.11f,bot=4))
        left.addView(txt(stateText,15f,stateColor,bold=true))
        top.addView(left)
        top.addView(txt("${daysLeft.coerceAtLeast(0)} d",18f,TEXT,bold=true))
        card.addView(top)

        val track=FrameLayout(this).apply{
            layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(this@MainActivity,7)).apply{topMargin=dp(this@MainActivity,15);bottomMargin=dp(this@MainActivity,10)}
            background=roundedBackground(Color.parseColor("#2A2E38"),7,Color.TRANSPARENT,0)
            clipChildren=true
        }
        val ratio=if(snap.activatedAt>0 && snap.expiresAt>snap.activatedAt) ((now-snap.activatedAt).toFloat()/total).coerceIn(0f,1f) else 0f
        val fill=View(this).apply{
            layoutParams=FrameLayout.LayoutParams((dp(this@MainActivity,300)*ratio).toInt().coerceAtLeast(if(ratio>0f)dp(this@MainActivity,8) else 0),ViewGroup.LayoutParams.MATCH_PARENT)
            background=roundedBackground(stateColor,7,stateColor,0)
        }
        track.addView(fill)
        track.viewTreeObserver.addOnGlobalLayoutListener(object:android.view.ViewTreeObserver.OnGlobalLayoutListener{ override fun onGlobalLayout(){
            val lp=fill.layoutParams as FrameLayout.LayoutParams
            lp.width=(track.width*ratio).toInt()
            fill.layoutParams=lp
            track.viewTreeObserver.removeOnGlobalLayoutListener(this)
        }})
        card.addView(track)

        val meta=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL}
        val exp=if(snap.expiresAt>0) "Expira ${SimpleDateFormat("dd/MM/yyyy",Locale.getDefault()).format(Date(snap.expiresAt))}" else "Vencimiento no disponible"
        meta.addView(txt(exp,10.5f,TEXT2,bold=true))
        meta.addView(txt(" · ",10f,MUTED))
        val sync=when{snap.lastSyncAt<=0L->"sin sync";else->"sync ${SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(snap.lastSyncAt))}"}
        meta.addView(txt(sync,10f,MUTED))
        card.addView(meta)
        if (!snap.lastSyncError.isNullOrBlank()) card.addView(txt("${snap.lastSyncError}",10f,ERR,top=7))
        return card
    }

    private fun withContextSafeCount(): Int {
        return try {
            kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                AppDatabase.getInstance(this@MainActivity).smsDao().countPendingAll()
            }
        } catch (_: Exception) { 0 }
    }

    private fun readLicenseSnapshot(): LicenseSnapshot {
        val deviceId = prefs.getString(SyncService.KEY_DEVICE_ID, "") ?: ""
        val activatedAt = prefs.getLong(SyncService.KEY_LICENSE_ACTIVATED_AT, 0L)
        val expiresAt = prefs.getLong(SyncService.KEY_LICENSE_EXPIRES_AT, 0L)
        val state = prefs.getString(SyncService.KEY_LICENSE_STATE, "ACTIVE") ?: "ACTIVE"
        val lastSyncAt = prefs.getLong(SyncService.KEY_LAST_SYNC_AT, 0L)
        val lastSyncStatus = prefs.getString(SyncService.KEY_LAST_SYNC_STATUS, "PENDING") ?: "PENDING"
        val lastSyncError = prefs.getString(SyncService.KEY_LAST_SYNC_ERROR, null)
        return LicenseSnapshot(state, activatedAt, expiresAt, deviceId.ifBlank { ensureDeviceId() }, lastSyncAt, lastSyncStatus, lastSyncError)
    }

    private fun ensureLicenseDefaults() {
        if (!prefs.contains(SyncService.KEY_DEVICE_ID)) {
            prefs.edit().putString(SyncService.KEY_DEVICE_ID, ensureDeviceId()).apply()
        }
        if (!prefs.contains(SyncService.KEY_LICENSE_STATE)) {
            prefs.edit().putString(SyncService.KEY_LICENSE_STATE, "PENDING").apply()
        }
        if (!prefs.contains("activated")) {
            prefs.edit().putBoolean("activated", false).apply()
        }
    }

    private fun hasLocalSmsHistory(): Boolean = try {
        kotlinx.coroutines.runBlocking(Dispatchers.IO) {
            AppDatabase.getInstance(this@MainActivity).smsDao().getRecent(1).isNotEmpty()
        }
    } catch (_: Exception) { false }

    private fun isLicenseActive(): Boolean {
    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
    val activated = prefs.getBoolean("activated", false)
    val state = prefs.getString(SyncService.KEY_LICENSE_STATE, "ACTIVE") ?: "ACTIVE"
    val expiresAt = prefs.getLong(SyncService.KEY_LICENSE_EXPIRES_AT, 0L)
    
    if (token.isBlank() || !activated) return false
    if (state.equals("REVOKED", true)) return false
    if (state.equals("EXPIRED", true)) return false
    if (expiresAt > 0 && System.currentTimeMillis() >= expiresAt) return false
    
    return true
    }

    private fun checkLicenseStatus() {
        val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
        if (token.isBlank() || licenseStatusCheckInFlight) return
        licenseStatusCheckInFlight = true

        uiScope.launch {
          try {
            // outcome: "OK", "REVOKED", "USED", o "NETWORK_ERROR"
            val outcome = withContext(Dispatchers.IO) {
                try {
                    val url = URL("https://parser-bot-9y8n.onrender.com/api/auth/verify")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.doOutput = true
                    conn.connectTimeout = 5000
                    conn.readTimeout = 5000

                    val payload = JSONObject().apply {
                        put("device_id", ensureDeviceId())
                        put("phone_number", prefs.getString("phone_number", "").orEmpty())
                    }.toString()
                    conn.setRequestProperty("Authorization", "Bearer $token")
                    conn.outputStream.use { it.write(payload.toByteArray()) }
                    val code = conn.responseCode
                    val body = runCatching {
                        (if (code in 200..299) conn.inputStream else conn.errorStream)
                            ?.bufferedReader()?.readText().orEmpty()
                    }.getOrNull().orEmpty()

                    when (code) {
                        200  -> "OK"
                        403, 404 -> {
                            // Leer status del JSON del backend
                            val parsed = runCatching { JSONObject(body) }.getOrNull()
                            val status = parsed?.optString("status", "")?.uppercase().orEmpty()
                            // 403 USED = token en uso en otro dispositivo
                            // 403 REVOKED / 404 = eliminado, renovado o desactivado
                            if (status == "USED") "USED" else "REVOKED"
                        }
                        else -> "NETWORK_ERROR" // error de red → no actuar
                    }
                } catch (e: Exception) {
                    "NETWORK_ERROR" // sin conexión → mantener estado actual
                }
            }

            // Actuar DIRECTAMENTE según la respuesta — sin depender de prefs
            when (outcome) {
                "REVOKED" -> runOnUiThread {
                    prefs.edit()
                        .putString(SyncService.KEY_LICENSE_STATE, "REVOKED")
                        .putBoolean("activated", false)
                        .commit() // commit() síncrono, no apply()
                    showTokenRevoked(token)
                }
                "USED" -> runOnUiThread {
                    prefs.edit()
                        .putString(SyncService.KEY_LICENSE_STATE, "USED")
                        .putBoolean("activated", false)
                        .commit()
                    showTokenInUse(token)
                }
                // "OK" y "NETWORK_ERROR" → no hacer nada
            }
          } finally {
            licenseStatusCheckInFlight = false
          }
        }
    }

    private fun formatCountdown(ms: Long): String {
        val totalSec = (ms / 1000L).coerceAtLeast(0L)
        val min = totalSec / 60
        val sec = totalSec % 60
        return "%02d:%02d".format(Locale.US, min, sec)
    }

    private fun formatDateTime(ms: Long): String {
        if (ms <= 0L) return "—"
        return SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).format(Date(ms))
    }

    private fun ensureDeviceId(): String {
        val existing = prefs.getString(SyncService.KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val id = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            ?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString().replace("-", "")
        prefs.edit().putString(SyncService.KEY_DEVICE_ID, id).apply()
        return id
    }

    private fun requestPerms() {
        val missing = PERMISSIONS.filter { ContextCompat.checkSelfPermission(this,it)!=PackageManager.PERMISSION_GRANTED }
        if(missing.isNotEmpty()) ActivityCompat.requestPermissions(this,missing.toTypedArray(),100)
    }

    private fun installAppLockListener(toggle: Switch) {
        toggle.setOnCheckedChangeListener { button, checked ->
            val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            if (checked && !keyguard.isDeviceSecure) {
                prefs.edit().putBoolean(PREF_APP_LOCK, false).apply()
                button.setOnCheckedChangeListener(null)
                button.isChecked = false
                installAppLockListener(toggle)
                ThemedAlertDialogBuilder(this).setTitle("Bloqueo del teléfono requerido")
                    .setMessage("Configura primero un PIN, patrón o contraseña en los ajustes de Android.")
                    .setPositiveButton("Abrir ajustes") { _, _ -> runCatching { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) } }
                    .setNegativeButton("Cerrar", null).show()
            } else {
                prefs.edit().putBoolean(PREF_APP_LOCK, checked).apply()
                showSoToast(if (checked) "Bloqueo local activado" else "Bloqueo local desactivado", Toast.LENGTH_SHORT)
            }
        }
    }

    private fun enforceLocalAppLockIfNeeded() {
        if (appLockPromptRunning || !prefs.getBoolean(PREF_APP_LOCK, false)) return
        val backgroundAt = prefs.getLong(APP_LOCK_BACKGROUND_AT, 0L)
        if (backgroundAt <= 0L || System.currentTimeMillis() - backgroundAt < 30_000L) return
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (!keyguard.isDeviceSecure) {
            prefs.edit().putBoolean(PREF_APP_LOCK, false).remove(APP_LOCK_BACKGROUND_AT).apply()
            showSoToast("Configura un PIN/patrón de Android para usar el bloqueo local", Toast.LENGTH_LONG)
            return
        }
        val prompt = keyguard.createConfirmDeviceCredentialIntent("Desbloquear SynthesisOne", "Confirma tu identidad para ver datos financieros")
        if (prompt == null) {
            showSoToast("No se pudo abrir el bloqueo seguro de Android", Toast.LENGTH_LONG)
            return
        }
        appLockPromptRunning = true
        runCatching { startActivityForResult(prompt, REQUEST_APP_UNLOCK) }.onFailure {
            appLockPromptRunning = false
            android.util.Log.e("SynthesisOne_SECURITY", "No se pudo iniciar la autenticación local", it)
        }
    }

    @Deprecated("Deprecated in Android, kept compatible with this project target")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_APP_UPDATE_APK -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) handleSelectedUpdateApk(uri)
            }
            REQUEST_INSTALL_PERMISSION -> {
                awaitingInstallPermission = false
                tryInstallPendingUpdateIfAllowed()
            }
            REQUEST_PROFILE_PHOTO -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    val savedUri = persistImageUri(uri)
                    prefs.edit().putString(PREF_PROFILE_PHOTO_URI, savedUri).putBoolean(PREF_PROFILE_AVATAR_PENDING, true).apply()
                    profilePhotoPreview?.let { view -> runCatching { view.setImageURI(uri) }.onFailure { view.setImageResource(android.R.drawable.ic_menu_myplaces) } }
                    val token = prefs.getString(SyncService.KEY_TOKEN, "").orEmpty()
                    if (token.isNotBlank() && isDeviceOnline()) {
                        showSoToast("Subiendo foto privada a tu perfil…", Toast.LENGTH_SHORT)
                        uiScope.launch {
                            val response = withContext(Dispatchers.IO) { runCatching { backendRequest("/api/game-market/profile/avatar", "POST", token, imagePayloadFromUri(savedUri)) }.getOrNull() }
                            if (response != null && response.code in 200..299) {
                                val profile = runCatching { JSONObject(response.body).optJSONObject("profile") }.getOrNull()
                                prefs.edit().putString(PREF_PROFILE_AVATAR_URL, profile?.optString("avatar_url", "").orEmpty()).putBoolean(PREF_PROFILE_AVATAR_PENDING, false).apply()
                                showSoToast("Foto sincronizada de forma privada.", Toast.LENGTH_LONG)
                            } else showSoToast("Foto guardada localmente; se volverá a intentar al recuperar conexión.", Toast.LENGTH_LONG)
                        }
                    } else showSoToast("Foto guardada localmente; se sincronizará cuando haya conexión.", Toast.LENGTH_LONG)
                }
            }
            REQUEST_GAME_IMAGE -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    pendingGameEditorImageUri = persistImageUri(uri)
                    pendingGameEditorPreview?.let { view -> runCatching { view.setImageURI(uri) }.onFailure { view.setImageResource(android.R.drawable.ic_menu_gallery) } }
                    showSoToast("Miniatura seleccionada; pulsa Guardar en el editor", Toast.LENGTH_SHORT)
                }
            }
            REQUEST_RESELLER_ID_FRONT, REQUEST_RESELLER_ID_BACK, REQUEST_RESELLER_SELFIE -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    val saved = persistImageUri(uri)
                    val key = when (requestCode) {
                        REQUEST_RESELLER_ID_FRONT -> PREF_RESELLER_ID_FRONT_URI
                        REQUEST_RESELLER_ID_BACK -> PREF_RESELLER_ID_BACK_URI
                        else -> PREF_RESELLER_SELFIE_URI
                    }
                    prefs.edit().putString(key, saved).apply()
                    resellerPhotoPreviewViews[requestCode]?.apply {
                        runCatching { setImageURI(android.net.Uri.parse(saved)); clearColorFilter() }
                            .onFailure { setImageResource(android.R.drawable.ic_menu_camera); setColorFilter(TEXT2) }
                    }
                    resellerPhotoStatusViews[requestCode]?.apply {
                        text = "✓ IMAGEN AÑADIDA\nLISTA PARA ENVIAR"
                        setTextColor(GREEN)
                        background = pillBackground(Color.parseColor("#164136"), 18)
                    }
                    resellerPhotoCardViews[requestCode]?.background?.let { background ->
                        (background as? GradientDrawable)?.setStroke(dp(this@MainActivity, 1), GREEN)
                    }
                    resellerPhotoButtonViews[requestCode]?.apply { text = "CAMBIAR"; contentDescription = "Cambiar fotografía seleccionada" }
                    showSoToast("Imagen añadida a: ${when (requestCode) { REQUEST_RESELLER_ID_FRONT -> "carnet por delante"; REQUEST_RESELLER_ID_BACK -> "carnet por detrás"; else -> "foto con SO Reseller" }}. Se enviará al presentar la solicitud.", Toast.LENGTH_LONG)
                }
            }
            REQUEST_EXPORT_CSV -> {
                val uri = data?.data
                val content = pendingCsvContent
                pendingCsvContent = null
                if (resultCode == RESULT_OK && uri != null && content != null) {
                    try {
                        contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(content) }
                            ?: throw IllegalStateException("No se pudo abrir el archivo de destino")
                        showSoToast("CSV exportado correctamente", Toast.LENGTH_LONG)
                    } catch (error: Exception) {
                        showSoToast("Error exportando CSV: ${error.message}", Toast.LENGTH_LONG)
                    }
                }
            }
            REQUEST_APP_UNLOCK -> {
                appLockPromptRunning = false
                if (resultCode == RESULT_OK) {
                    prefs.edit().remove(APP_LOCK_BACKGROUND_AT).apply()
                } else {
                    // Evita un bucle de diálogos si el usuario cancela el desbloqueo.
                    prefs.edit().putLong(APP_LOCK_BACKGROUND_AT, System.currentTimeMillis()).apply()
                    showSoToast("La app sigue protegida; vuelve a entrar para desbloquearla", Toast.LENGTH_SHORT)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (awaitingInstallPermission) {
            awaitingInstallPermission = false
            tryInstallPendingUpdateIfAllowed()
        }
        handler.post(refreshRunnable)
        if (activationCountdownView != null) handler.post(activationTicker)
        if (supportScreenActive && supportPollRunnable != null) handler.postDelayed(supportPollRunnable!!, 1_000L)
        if (isLicenseActive()) {
            if (System.currentTimeMillis() - lastLicenseStatusCheckAt >= 60_000L) {
                lastLicenseStatusCheckAt = System.currentTimeMillis()
                checkLicenseStatus()
            }
        }
        enforceLocalAppLockIfNeeded()
    }
    override fun onPause() {
        if (!appLockPromptRunning) prefs.edit().putLong(APP_LOCK_BACKGROUND_AT, System.currentTimeMillis()).apply()
        super.onPause()
        handler.removeCallbacks(refreshRunnable); handler.removeCallbacks(activationTicker); supportPollRunnable?.let { handler.removeCallbacks(it) }
    }
    override fun onDestroy() { stopSupportPolling(); uiScope.cancel(); welcomeCountdownRunnable?.let { handler.removeCallbacks(it) }; handler.removeCallbacks(refreshRunnable); handler.removeCallbacks(activationTicker); super.onDestroy() }
}
