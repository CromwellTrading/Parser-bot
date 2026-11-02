package com.synthesisone.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.synthesisone.app.service.SyncService

/** Restart entry point used after the task is swiped away. Android still controls force-stop behavior. */
class ServiceRestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = context.getSharedPreferences(SyncService.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean("monitoring_enabled", true)) {
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, SyncService::class.java))
            }.onFailure { Log.e("SynthesisOne_RESTART", "No se pudo restaurar el servicio", it) }
        }
    }
}
