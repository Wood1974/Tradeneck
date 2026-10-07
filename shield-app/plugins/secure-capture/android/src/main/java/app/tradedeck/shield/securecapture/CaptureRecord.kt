package app.tradedeck.shield.securecapture

import java.security.MessageDigest

/**
 * Byte rules for one capture record. Matches Tradedeck-api `capture_record.py`:
 * whole numbers only, sorted keys, tight separators, non-ASCII as `\uXXXX`,
 * null omitted, and `record_hash = SHA256(canonical || "|" || prev_hash)`.
 * No Android types, so the JVM unit tests can run this without a device.
 */
object CaptureRecord {
    const val VERSION = 1
    const val JS_SAFE_INT = 9007199254740991L
    const val GENESIS_CHALLENGE = "shield-genesis-v1"
    private const val MAX_TEXT = 512
    private val SHA256_HEX = Regex("^[0-9a-f]{64}$")

    val RECORD_FIELDS = listOf(
        "version", "checkpoint_id", "photo_sha256", "ticket_id", "wall_time_ms",
        "monotonic_ms", "boot_id", "boot_count", "gnss_time_ms", "location_simulated",
        "sensor_hash", "depth_hash", "depth_present", "flags",
    )
    private val REQUIRED = setOf(
        "version", "checkpoint_id", "photo_sha256", "ticket_id",
        "wall_time_ms", "monotonic_ms", "flags",
    )
    private val INT_FIELDS = setOf(
        "version", "wall_time_ms", "monotonic_ms", "boot_count", "gnss_time_ms", "flags",
    )
    private val NON_NEGATIVE = setOf("version", "monotonic_ms", "boot_count", "flags")
    private val BOOL_FIELDS = setOf("location_simulated", "depth_present")
    private val HEX_FIELDS = setOf("photo_sha256", "sensor_hash", "depth_hash")
    private val TEXT_FIELDS = setOf("checkpoint_id", "ticket_id", "boot_id")

    fun sha256(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        val out = StringBuilder(digest.size * 2)
        for (b in digest) out.append("%02x".format(b.toInt() and 0xff))
        return out.toString()
    }

    fun canonical(record: Map<String, Any?>): String {
        checkShape(record)
        val out = linkedMapOf<String, Any?>()
        for (key in RECORD_FIELDS) {
            if (!record.containsKey(key) || record[key] == null) continue
            out[key] = field(key, record[key])
        }
        return canonicalJson(out)
    }

    fun canonicalWhole(payload: Map<String, Any?>): String {
        val walked = dropNulls(walkWhole(payload, "payload")) as Map<*, *>
        @Suppress("UNCHECKED_CAST")
        return canonicalJson(walked as Map<String, Any?>)
    }

    fun signingMessage(record: Map<String, Any?>, prevHash: String): ByteArray {
        val body = canonical(record).toByteArray(Charsets.UTF_8)
        val prev = prevHash.toByteArray(Charsets.UTF_8)
        val msg = ByteArray(body.size + 1 + prev.size)
        System.arraycopy(body, 0, msg, 0, body.size)
        msg[body.size] = '|'.code.toByte()
        System.arraycopy(prev, 0, msg, body.size + 1, prev.size)
        return msg
    }

    fun link(record: Map<String, Any?>, prevHash: String): String = sha256(signingMessage(record, prevHash))

    fun seal(record: Map<String, Any?>, prevHash: String): Map<String, Any?> {
        if (!SHA256_HEX.matches(prevHash)) {
            throw IllegalArgumentException("prev_hash must be a 64-character lowercase hex SHA-256")
        }
        val digest = link(record, prevHash)
        val sealed = HashMap(record)
        sealed.keys.toList().forEach { key ->
            if (key in RECORD_FIELDS && sealed[key] == null) sealed.remove(key)
        }
        sealed["prev_hash"] = prevHash
        sealed["record_hash"] = digest
        return sealed
    }

    fun verifyChain(records: List<Map<String, Any?>>, firstPrev: String, expectHead: String? = null): Map<String, Any?> {
        var expectedPrev = firstPrev
        var brokenAt: Int? = null
        var reason: String? = null
        for ((index, record) in records.withIndex()) {
            val storedHash = record["record_hash"] as? String
            val storedPrev = record["prev_hash"]
            if (storedHash.isNullOrEmpty()) {
                brokenAt = index
                reason = "record carries no hash (never linked, or the hash was stripped)"
                break
            }
            if (storedPrev != expectedPrev) {
                brokenAt = index
                reason = "link broken: this record does not name the hash of the record before it"
                break
            }
            try {
                val recomputed = link(record, storedPrev as String)
                if (recomputed != storedHash) {
                    brokenAt = index
                    reason = "bytes do not reproduce the hash: a signed field was edited after the record was hashed"
                    break
                }
            } catch (err: IllegalArgumentException) {
                brokenAt = index
                reason = "bytes do not reproduce the hash (${err.message})"
                break
            }
            expectedPrev = storedHash
        }
        var intact = brokenAt == null
        if (intact && expectHead != null && expectedPrev != expectHead) {
            intact = false
            reason = "head does not match the head the holder was given; the chain was extended, shortened, or rewritten"
        }
        return mapOf(
            "verdict" to if (intact) "INTACT" else "TAMPERED",
            "intact" to intact,
            "broken_at_index" to brokenAt,
            "reason" to reason,
            "head_hash" to expectedPrev,
            "verified" to if (brokenAt == null) records.size else brokenAt,
        )
    }

    fun ticketClockBytes(observation: Map<String, Any?>): String {
        val clock = linkedMapOf<String, Any?>()
        if (observation["boot_count"] != null) clock["boot_count"] = whole(observation["boot_count"], "boot_count", true)
        val bootId = observation["boot_id"]
        if (bootId is String && bootId.isNotEmpty()) clock["boot_id"] = bootId
        else if (bootId != null && bootId !is String) {
            throw IllegalArgumentException("boot_id must be a non-empty string when it is present")
        }
        if (observation["wall_time_ms"] == null || observation["monotonic_ms"] == null) {
            throw IllegalArgumentException("ticket_clock needs wall_time_ms and monotonic_ms")
        }
        clock["monotonic_ms"] = whole(observation["monotonic_ms"], "monotonic_ms", true)
        clock["wall_time_ms"] = whole(observation["wall_time_ms"], "wall_time_ms", false)
        if (clock["boot_id"] == null && clock["boot_count"] == null) {
            throw IllegalArgumentException("ticket_clock needs a boot_id or a boot_count")
        }
        TimeAudit.assess(clock, clock)
        return canonicalJson(clock)
    }

    fun genesisPayload(ticketHashHex: String, observation: Map<String, Any?>): ByteArray {
        if (!SHA256_HEX.matches(ticketHashHex)) {
            throw IllegalArgumentException("ticket hash must be a 64-character lowercase hex SHA-256")
        }
        val clock = ticketClockBytes(observation).toByteArray(Charsets.UTF_8)
        val raw = ByteArray(32 + clock.size)
        for (i in 0 until 32) raw[i] = ticketHashHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        System.arraycopy(clock, 0, raw, 32, clock.size)
        return MessageDigest.getInstance("SHA-256").digest(raw)
    }

    fun genesisClientData(ticketHashHex: String, observation: Map<String, Any?>): ByteArray {
        val payload = genesisPayload(ticketHashHex, observation)
        val prefix = GENESIS_CHALLENGE.toByteArray(Charsets.UTF_8)
        val out = ByteArray(prefix.size + payload.size)
        System.arraycopy(prefix, 0, out, 0, prefix.size)
        System.arraycopy(payload, 0, out, prefix.size, payload.size)
        return out
    }

    fun localGenesisHash(ticketId: String, observation: Map<String, Any?>): String {
        val clock = ticketClockBytes(observation)
        val text = "tradedeck.shield.local-genesis.v1\n$clock\n$ticketId"
        return sha256(text.toByteArray(Charsets.UTF_8))
    }

    fun canonicalJson(value: Any?): String = when (value) {
        null -> "null"
        is Boolean -> if (value) "true" else "false"
        is Int -> value.toString()
        is Long -> {
            if (kotlin.math.abs(value) > JS_SAFE_INT) throw IllegalArgumentException("canonical JSON rejected an unsafe integer")
            value.toString()
        }
        is String -> escape(value)
        is List<*> -> value.joinToString(prefix = "[", postfix = "]", separator = ",") { canonicalJson(it) }
        is Map<*, *> -> {
            val keys = value.keys.map { it as String }.sorted()
            keys.joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
                escape(key) + ":" + canonicalJson(value[key])
            }
        }
        else -> throw IllegalArgumentException("canonical JSON cannot render ${value.javaClass.simpleName}")
    }

    private fun escape(value: String): String {
        val out = StringBuilder(value.length + 2)
        out.append('"')
        var i = 0
        while (i < value.length) {
            val cp = value.codePointAt(i)
            when {
                cp == '"'.code -> out.append("\\\"")
                cp == '\\'.code -> out.append("\\\\")
                cp == '\b'.code -> out.append("\\b")
                cp == '\u000C'.code -> out.append("\\f")
                cp == '\n'.code -> out.append("\\n")
                cp == '\r'.code -> out.append("\\r")
                cp == '\t'.code -> out.append("\\t")
                cp < 0x20 || cp > 0x7e -> {
                    if (cp > 0xffff) {
                        val v = cp - 0x10000
                        val hi = 0xD800 + (v shr 10)
                        val lo = 0xDC00 + (v and 0x3FF)
                        out.append("\\u%04x".format(hi))
                        out.append("\\u%04x".format(lo))
                    } else out.append("\\u%04x".format(cp))
                }
                else -> out.appendCodePoint(cp)
            }
            i += Character.charCount(cp)
        }
        out.append('"')
        return out.toString()
    }

    private fun checkShape(record: Map<String, Any?>) {
        if (asLong(record["version"]) != VERSION.toLong()) {
            throw IllegalArgumentException("unsupported capture record version ${record["version"]}; this contract is version $VERSION")
        }
        for (key in REQUIRED) {
            if (!record.containsKey(key) || record[key] == null) {
                throw IllegalArgumentException("capture record is missing $key")
            }
        }
        val present = record["depth_present"]
        val digest = record["depth_hash"]
        if (present == true && digest == null) throw IllegalArgumentException("depth_present is true but depth_hash is missing")
        if (digest != null && present != true) throw IllegalArgumentException("depth_hash is set but depth_present is not true")
    }

    private fun field(key: String, value: Any?): Any? = when {
        key in BOOL_FIELDS -> {
            if (value !is Boolean) throw IllegalArgumentException("$key must be a JSON boolean, not ${value?.javaClass?.simpleName}")
            value
        }
        key in HEX_FIELDS -> shaHex(value, key)
        key in INT_FIELDS -> whole(value, key, key in NON_NEGATIVE)
        key in TEXT_FIELDS -> text(value, key)
        else -> throw IllegalArgumentException("unknown capture-record field $key")
    }

    private fun whole(value: Any?, key: String, nonNegative: Boolean): Long {
        if (value is Double || value is Float) {
            throw IllegalArgumentException("$key is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)")
        }
        if (value is Boolean) throw IllegalArgumentException("$key must be a whole number")
        val number = asLong(value) ?: throw IllegalArgumentException("$key must be a whole number")
        if (kotlin.math.abs(number) > JS_SAFE_INT) {
            throw IllegalArgumentException("$key is outside the range a JSON number can carry exactly")
        }
        if (nonNegative && number < 0) throw IllegalArgumentException("$key cannot be negative")
        return number
    }

    private fun asLong(value: Any?): Long? = when (value) {
        is Long -> value
        is Int -> value.toLong()
        is Short -> value.toLong()
        else -> null
    }

    private fun text(value: Any?, key: String): String {
        if (value !is String) throw IllegalArgumentException("$key must be a string")
        if (value.isEmpty()) throw IllegalArgumentException("$key must not be empty")
        if (value.length > MAX_TEXT) throw IllegalArgumentException("$key is longer than $MAX_TEXT characters")
        return value
    }

    private fun shaHex(value: Any?, key: String): String {
        val t = text(value, key)
        if (!SHA256_HEX.matches(t)) throw IllegalArgumentException("$key must be a 64-character lowercase hex SHA-256")
        return t
    }

    private fun walkWhole(value: Any?, key: String): Any? {
        if (value is Double || value is Float) {
            throw IllegalArgumentException("$key is a float; the capture record only signs whole numbers (microdegrees, hundredths of a degree, milliseconds, counts)")
        }
        if (value == null || value is String) {
            if (value is String && value.length > MAX_TEXT) {
                throw IllegalArgumentException("$key is longer than $MAX_TEXT characters")
            }
            return value
        }
        if (value is Boolean) return value
        asLong(value)?.let { return whole(value, key, false) }
        if (value is List<*>) return value.map { walkWhole(it, key) }
        if (value is Map<*, *>) {
            val out = linkedMapOf<String, Any?>()
            for ((k, v) in value) {
                if (k !is String) throw IllegalArgumentException("$key has a non-string key")
                out[k] = walkWhole(v, k)
            }
            return out
        }
        throw IllegalArgumentException("$key has type ${value.javaClass.simpleName}, which the capture record cannot sign")
    }

    private fun dropNulls(value: Any?): Any? = when (value) {
        is Map<*, *> -> value.entries
            .filter { it.value != null }
            .associate { (it.key as String) to dropNulls(it.value) }
        is List<*> -> value.map { dropNulls(it) }
        else -> value
    }
}
