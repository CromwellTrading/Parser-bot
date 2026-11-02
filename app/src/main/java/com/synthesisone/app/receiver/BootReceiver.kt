package com.synthesisone.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.synthesisone.app.service.NotificationService
import com.synthesisone.app.service.SyncService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            Log.d("SynthesisOne_BOOT", "📱 Dispositivo reiniciado — arrancando servicios")
            NotificationService.restoreDailyFlow(context)
            runCatching { DailyReportReceiver.schedule(context) }
                .onFailure { Log.e("SynthesisOne_BOOT", "No se pudo programar el reporte diario", it) }
            runCatching { SyncService.syncNow(context) }
                .onFailure { Log.e("SynthesisOne_BOOT", "El servicio se iniciará al recibir el siguiente SMS o recuperar red", it) }
        }
    }
}
