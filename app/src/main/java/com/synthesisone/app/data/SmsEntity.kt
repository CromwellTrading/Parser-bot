package com.synthesisone.app.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Index

@Entity(tableName = "sms_logs", indices = [Index(value = ["dedupeKey"], unique = true)])
data class SmsEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    val sender: String,
    val body: String,
    val receivedAt: Long,

    val status: String = "QUEUED",
    val attempts: Int = 0,
    val lastError: String? = null,
    val sentAt: Long? = null,

    val direction: String? = null,
    val type: String? = null,
    val network: String? = null,
    val category: String? = null,
    val amount: Double? = null,
    val currency: String? = null,
    val senderPhone: String? = null,
    val receiverPhone: String? = null,
    val receiverAccount: String? = null,
    val transactionId: String? = null,
    val balanceAfter: Double? = null,
    val transactionAt: Long? = null,
    val note: String? = null,

    // Stable hash of sender + received timestamp + body prevents duplicate broadcasts.
    val dedupeKey: String? = null
) {
    val timestamp: Long
        get() = receivedAt
}
