package com.synthesisone.app.receiver

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.core.app.NotificationCompat
import com.synthesisone.app.R
import com.synthesisone.app.data.AppDatabase
import com.synthesisone.app.service.NotificationService
import com.synthesisone.app.utils.SmsParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Calendar

class DailyReportReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        CoroutineScope(Dispatchers.IO).launch {
            NotificationService.createChannels(context)

            val db = AppDatabase.getInstance(context)
            val allSms = db.smsDao().getRecent(500)

            val startOfDay = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis

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
                val p = SmsParser.parse(sms.body)
                val amount = p.amount ?: return@forEach
                val isMobile = p.category == "SALDO_MOVIL" || p.network == "CUBACEL"
                when (p.direction) {
                    "RECIBIDO" -> {
                        countIn++
                        if (isMobile) { mobileIn += amount; mobileCountIn++ }
                        else { totalIn += amount; transferIn += amount; transferCountIn++ }
                    }
                    "ENVIADO" -> {
                        countOut++
                        if (isMobile) { mobileOut += amount; mobileCountOut++ }
                        else { totalOut += amount; transferOut += amount; transferCountOut++ }
                    }
                }
            }

            val balance = totalIn - totalOut
            val emoji = if (balance >= 0) "📈" else "📉"
            val balanceText = if (balance >= 0) "+ %.2f CUP".format(balance) else "- %.2f CUP".format(Math.abs(balance))

            val notif = NotificationCompat.Builder(context, "synthesisone_flow")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setLargeIcon(BitmapFactory.decodeResource(context.resources, R.mipmap.ic_launcher))
                .setContentTitle("$emoji Resumen del día")
                .setContentText("Transferencias y saldo móvil separados")
                .setStyle(
                    NotificationCompat.BigTextStyle().bigText(
                        "Balance neto: $balanceText\n" +
                            "Transferencias: + ${"%.2f".format(transferIn)} CUP ($transferCountIn)\n" +
                            "Transferencias salientes: - ${"%.2f".format(transferOut)} CUP ($transferCountOut)\n" +
                            "Saldo móvil: + ${"%.2f".format(mobileIn)} unidades ($mobileCountIn)\n" +
                            "Saldo móvil saliente: - ${"%.2f".format(mobileOut)} unidades ($mobileCountOut)"
                    )
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setColor(if (balance >= 0) Color.parseColor("#00C853") else Color.parseColor("#FF1744"))
                .build()

            val nm = context.getSystemService(android.app.NotificationManager::class.java)
            nm.notify(2001, notif)
        }
    }

    companion object {
        fun schedule(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, DailyReportReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 23)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
            }

            alarmManager.setRepeating(
                AlarmManager.RTC_WAKEUP,
                cal.timeInMillis,
                AlarmManager.INTERVAL_DAY,
                pi
            )
        }
    }
}
