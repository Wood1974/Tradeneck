package app.tradedeck.shield.securecapture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * App-private outbox. Originals and records are written atomically and there
 * is no delete. Android file-based encryption covers filesDir. Backup is off
 * on the application manifest.
 */
class Outbox(context: Context) {
    private val root = File(context.applicationContext.filesDir, "shield-outbox").apply { mkdirs() }
    private val chains = File(root, "chains").apply { mkdirs() }
    private val records = File(root, "records").apply { mkdirs() }
    private val photos = File(root, "photos").apply { mkdirs() }

    fun hasRecords(): Boolean = records.listFiles()?.any { it.extension == "json" } == true

    fun chain(ticketId: String): JSONObject? {
        val file = File(chains, safe(ticketId) + ".json")
        if (!file.isFile) return null
        return JSONObject(file.readText())
    }

    fun writeChain(ticketId: String, chain: JSONObject) {
        atomic(File(chains, safe(ticketId) + ".json"), chain.toString().toByteArray())
    }

    fun writeRecord(recordHash: String, json: JSONObject, photo: ByteArray) {
        atomic(File(photos, "$recordHash.jpg"), photo)
        atomic(File(records, "$recordHash.json"), json.toString().toByteArray())
    }

    fun readRecord(recordHash: String): JSONObject? {
        val file = File(records, "$recordHash.json")
        if (!file.isFile) return null
        return JSONObject(file.readText())
    }

    fun readPhoto(recordHash: String): ByteArray? {
        val file = File(photos, "$recordHash.jpg")
        if (!file.isFile) return null
        return file.readBytes()
    }

    /** Real ticket ids from the chain files. Filenames are hashes so a ticket id cannot escape the directory. */
    fun ticketIds(): List<String> =
        chains.listFiles()?.filter { it.extension == "json" }?.mapNotNull { file ->
            try {
                JSONObject(file.readText()).optString("ticket_id").takeIf { it.isNotEmpty() }
            } catch (_: Exception) {
                null
            }
        } ?: emptyList()

    private fun atomic(dest: File, bytes: ByteArray) {
        val tmp = File(dest.parentFile, dest.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(dest)) {
            dest.writeBytes(bytes)
            tmp.delete()
        }
    }

    private fun safe(ticketId: String): String = CaptureRecord.sha256(ticketId.toByteArray(Charsets.UTF_8))

    companion object {
        fun jsonToMap(obj: JSONObject): Map<String, Any?> {
            val out = HashMap<String, Any?>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                out[key] = unwrap(obj.get(key))
            }
            return out
        }

        fun unwrap(value: Any?): Any? = when (value) {
            null, JSONObject.NULL -> null
            is JSONObject -> jsonToMap(value)
            is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
            else -> value
        }
    }
}
