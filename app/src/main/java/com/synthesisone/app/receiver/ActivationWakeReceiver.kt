package com.synthesisone.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.synthesisone.app.service.SyncService

class ActivationWakeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        SyncService.syncNow(context)
        SyncService.scheduleActivationWake(context, 60_000L)
    }
}
