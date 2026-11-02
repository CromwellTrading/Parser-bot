package com.synthesisone.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import com.synthesisone.app.service.SyncService

class NetworkReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (isOnline(context)) {
            Log.d("SynthesisOne_NET", "🌐 Conexión detectada — reintentando pendientes")
            runCatching { SyncService.syncNow(context) }
                .onFailure { Log.e("SynthesisOne_NET", "No se pudo iniciar el servicio de sincronización", it) }
        }
    }

    private fun isOnline(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}
