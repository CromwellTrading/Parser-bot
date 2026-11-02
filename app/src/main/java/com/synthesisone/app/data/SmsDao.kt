package com.synthesisone.app.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface SmsDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insert(sms: SmsEntity): Long

    @Query("SELECT * FROM sms_logs ORDER BY receivedAt DESC LIMIT :limit")
    fun getRecent(limit: Int): List<SmsEntity>

    @Query("SELECT * FROM sms_logs WHERE status = 'QUEUED' ORDER BY receivedAt ASC")
    fun getPending(): List<SmsEntity>

    @Query("SELECT * FROM sms_logs WHERE receivedAt >= :from AND receivedAt < :to ORDER BY receivedAt DESC")
    fun getRange(from: Long, to: Long): List<SmsEntity>

    @Query("SELECT * FROM sms_logs WHERE status = 'ERROR' ORDER BY receivedAt ASC")
    fun getFailed(): List<SmsEntity>

    @Query("SELECT COUNT(*) FROM sms_logs WHERE status IN ('QUEUED', 'ERROR')")
    fun countPendingAll(): Int

    @Query("UPDATE sms_logs SET status = 'QUEUED', lastError = NULL WHERE id = :id")
    fun markQueued(id: Long)

    @Query("UPDATE sms_logs SET status = 'SENT', sentAt = :sentAt, lastError = NULL WHERE id = :id")
    fun markSent(id: Long, sentAt: Long)

    @Query("UPDATE sms_logs SET status = 'ERROR', lastError = :error, attempts = attempts + 1 WHERE id = :id")
    fun markError(id: Long, error: String?)

    @Query("DELETE FROM sms_logs WHERE receivedAt < :cutoff")
    fun clearOld(cutoff: Long)
}
