package app.tradedeck.shield.securecapture

/**
 * Time labels from Tradedeck-api `time_audit.py`. Flags never enter the decision.
 * 120000 ms agrees. 120001 ms is DEVICE CLOCK MISMATCH. A reboot is UNVERIFIED TIME.
 */
object TimeAudit {
    const val CLOCK_MISMATCH_LIMIT_MS = 120_000L
    const val CONSISTENT = "CONSISTENT"
    const val UNVERIFIED = "UNVERIFIED TIME"
    const val MISMATCH = "DEVICE CLOCK MISMATCH"

    fun assess(ticket: Map<String, Any?>, capture: Map<String, Any?>): Map<String, Any?> {
        val changed = bootChanged(ticket, capture)
        val ticketWall = optionalLong(ticket, "wall_time_ms")
        val captureWall = optionalLong(capture, "wall_time_ms")
        val ticketMono = optionalLong(ticket, "monotonic_ms", true)
        val captureMono = optionalLong(capture, "monotonic_ms", true)
        val gnss = gnss(capture, captureWall)

        var monotonicDelta: Long? = null
        var unverified: String? = null
        var mismatch: String? = null

        if (changed) {
            unverified = "The boot identity changed between the ticket and the photo, so the monotonic interval cannot be checked."
        } else if (ticketWall == null || captureWall == null || ticketMono == null || captureMono == null) {
            unverified = "A wall-clock or monotonic reading is missing, so the monotonic interval cannot be checked."
        } else {
            val elapsed = captureMono - ticketMono
            if (elapsed < 0) {
                unverified = "The monotonic clock moved backward between the ticket and the photo, so the monotonic interval cannot be checked."
            } else {
                monotonicDelta = kotlin.math.abs(captureWall - (ticketWall + elapsed))
                if (monotonicDelta > CLOCK_MISMATCH_LIMIT_MS) {
                    mismatch = "The wall clock differs from the ticket time plus monotonic elapsed by $monotonicDelta ms, which is more than $CLOCK_MISMATCH_LIMIT_MS ms."
                }
            }
        }

        var gnssNote: String? = null
        if (gnss.first == "mismatch") {
            val gnssReason = "GNSS time differs from the wall clock by ${gnss.second} ms, which is more than $CLOCK_MISMATCH_LIMIT_MS ms."
            mismatch = if (mismatch != null) "$mismatch $gnssReason" else gnssReason
        } else if (gnss.first == "absent") {
            gnssNote = if (unverified == null) {
                "No GNSS time was present; the time verdict stands on the monotonic clock."
            } else "No GNSS time was present."
        } else if (gnss.first == "uncompared") {
            gnssNote = "GNSS time was present, but the wall clock was not, so it was not compared."
        } else {
            gnssNote = "GNSS time is within $CLOCK_MISMATCH_LIMIT_MS ms of the wall clock."
        }

        val labels = mutableListOf<String>()
        if (unverified != null) labels.add(UNVERIFIED)
        if (mismatch != null) labels.add(MISMATCH)
        val verdict = when {
            MISMATCH in labels -> MISMATCH
            UNVERIFIED in labels -> UNVERIFIED
            else -> CONSISTENT
        }
        val parts = listOfNotNull(unverified, mismatch).toMutableList()
        if (verdict == CONSISTENT) {
            parts.add("The boot did not change, and the wall clock is within $CLOCK_MISMATCH_LIMIT_MS ms of the ticket time plus monotonic elapsed.")
        }
        if (gnssNote != null) parts.add(gnssNote)
        return mapOf(
            "verdict" to verdict,
            "labels" to labels,
            "boot_changed" to changed,
            "monotonic_delta_ms" to monotonicDelta,
            "gnss" to gnss.first,
            "gnss_delta_ms" to gnss.second,
            "detail" to parts.joinToString(" "),
        )
    }

    fun bootChanged(ticket: Map<String, Any?>, capture: Map<String, Any?>): Boolean {
        val ticketId = optionalText(ticket, "boot_id")
        val captureId = optionalText(capture, "boot_id")
        val ticketCount = optionalLong(ticket, "boot_count", true)
        val captureCount = optionalLong(capture, "boot_count", true)
        var saw = false
        if (ticketId != null || captureId != null) {
            saw = true
            if (ticketId == null || captureId == null || ticketId != captureId) return true
        }
        if (ticketCount != null || captureCount != null) {
            saw = true
            if (ticketCount == null || captureCount == null || ticketCount != captureCount) return true
        }
        return !saw
    }

    private fun gnss(capture: Map<String, Any?>, wall: Long?): Pair<String, Long?> {
        val time = optionalLong(capture, "gnss_time_ms") ?: return "absent" to null
        if (wall == null) return "uncompared" to null
        val delta = kotlin.math.abs(time - wall)
        return (if (delta > CLOCK_MISMATCH_LIMIT_MS) "mismatch" else "agrees") to delta
    }

    private fun optionalLong(obs: Map<String, Any?>, key: String, nonNegative: Boolean = false): Long? {
        if (!obs.containsKey(key) || obs[key] == null) return null
        val value = obs[key]
        if (value is Double || value is Float) {
            throw IllegalArgumentException("$key is a float; times and counts in this check are whole milliseconds")
        }
        if (value is Boolean) throw IllegalArgumentException("$key must be a whole number")
        val number = when (value) {
            is Long -> value
            is Int -> value.toLong()
            else -> throw IllegalArgumentException("$key must be a whole number")
        }
        if (kotlin.math.abs(number) > CaptureRecord.JS_SAFE_INT) {
            throw IllegalArgumentException("$key is outside the range a JSON number can carry exactly")
        }
        if (nonNegative && number < 0) throw IllegalArgumentException("$key cannot be negative")
        return number
    }

    private fun optionalText(obs: Map<String, Any?>, key: String): String? {
        if (!obs.containsKey(key) || obs[key] == null) return null
        val value = obs[key]
        if (value !is String || value.isEmpty()) throw IllegalArgumentException("$key must be a non-empty string when it is present")
        return value
    }
}
