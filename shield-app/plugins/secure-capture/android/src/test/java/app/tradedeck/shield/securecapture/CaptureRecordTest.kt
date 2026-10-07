package app.tradedeck.shield.securecapture

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class CaptureRecordTest {
    private val vectors: JSONObject by lazy { loadVectors() }

    @Test
    fun requiredRecordMatchesTheServerFixture() {
        val body = required()
        assertEquals(vectors.getString("canonicalRequired"), CaptureRecord.canonical(body))
        val message = CaptureRecord.signingMessage(body, vectors.getString("prevHash"))
        assertEquals(vectors.getString("recordHashRequired"), CaptureRecord.sha256(message))
        val text = message.toString(Charsets.UTF_8)
        assertTrue(text.startsWith(vectors.getString("canonicalRequired") + "|"))
    }

    @Test
    fun fullRecordAndSnapshotMatchTheServerFixture() {
        val snapshot = mapOf(
            "heading_hundredths" to 18450,
            "duration_ms" to 200,
            "accel_milli_g" to listOf(0, 0, 1000),
        )
        assertEquals(vectors.getString("snapshotBytes"), CaptureRecord.canonicalWhole(snapshot))
        assertEquals(vectors.getString("sensorHash"), CaptureRecord.sha256(CaptureRecord.canonicalWhole(snapshot).toByteArray()))
        val depth = mapOf("width" to 4, "height" to 4, "millimetres" to listOf(1000, 1001, 1002, 1003))
        assertEquals(vectors.getString("depthBytes"), CaptureRecord.canonicalWhole(depth))
        assertEquals(vectors.getString("depthHash"), CaptureRecord.sha256(CaptureRecord.canonicalWhole(depth).toByteArray()))
        val full = mapOf(
            "version" to 1,
            "checkpoint_id" to "café",
            "photo_sha256" to vectors.getString("photoSha256"),
            "ticket_id" to "ticket-1",
            "wall_time_ms" to 1_700_000_000_000L,
            "monotonic_ms" to 5000,
            "boot_id" to "BOOT-SESSION",
            "boot_count" to 4,
            "gnss_time_ms" to 1_700_000_000_500L,
            "location_simulated" to false,
            "sensor_hash" to vectors.getString("sensorHash"),
            "depth_hash" to vectors.getString("depthHash"),
            "depth_present" to true,
            "flags" to 15,
        )
        val canonical = CaptureRecord.canonical(full)
        assertEquals(vectors.getString("canonicalFull"), canonical)
        assertTrue(canonical.contains("\\u00e9"))
    }

    @Test
    fun chainTamperAndHeadCheck() {
        val prev = vectors.getString("prevHash")
        val first = CaptureRecord.seal(required(), prev)
        val second = CaptureRecord.seal(required(checkpoint = "cp-2", wall = 1_700_000_001_000L), first["record_hash"] as String)
        val intact = CaptureRecord.verifyChain(listOf(first, second), prev)
        assertEquals("INTACT", intact["verdict"])
        assertEquals(second["record_hash"], intact["head_hash"])

        val edited = HashMap(second)
        edited["wall_time_ms"] = 1_700_000_001_001L
        val tampered = CaptureRecord.verifyChain(listOf(first, edited), prev)
        assertEquals("TAMPERED", tampered["verdict"])
        assertEquals(1, tampered["broken_at_index"])

        val empty = CaptureRecord.verifyChain(emptyList(), prev)
        assertEquals("INTACT", empty["verdict"])
        assertEquals(prev, empty["head_hash"])

        val short = CaptureRecord.verifyChain(listOf(first), prev, second["record_hash"] as String)
        assertEquals("TAMPERED", short["verdict"])
        assertTrue((short["reason"] as String).contains("head does not match"))
    }

    @Test
    fun timeLabelsMatchTheServerRules() {
        val ticket = mapOf("wall_time_ms" to 1_700_000_000_000L, "monotonic_ms" to 10_000, "boot_count" to 7, "boot_id" to "boot-a")
        fun photo(slip: Long, boot: Int = 7, gnss: Long? = null): Map<String, Any?> {
            val map = hashMapOf<String, Any?>(
                "wall_time_ms" to 1_700_000_000_000L + 60_000L + slip,
                "monotonic_ms" to 70_000L,
                "boot_count" to boot,
                "boot_id" to "boot-a",
            )
            if (gnss != null) map["gnss_time_ms"] = gnss
            return map
        }
        assertEquals("CONSISTENT", TimeAudit.assess(ticket, photo(120_000))["verdict"])
        assertEquals(120_000L, TimeAudit.assess(ticket, photo(120_000))["monotonic_delta_ms"])
        assertEquals("DEVICE CLOCK MISMATCH", TimeAudit.assess(ticket, photo(120_001))["verdict"])
        assertEquals("CONSISTENT", TimeAudit.assess(ticket, photo(-120_000))["verdict"])
        assertEquals("DEVICE CLOCK MISMATCH", TimeAudit.assess(ticket, photo(-120_001))["verdict"])
        val reboot = TimeAudit.assess(ticket, photo(180_000, boot = 8))
        assertEquals("UNVERIFIED TIME", reboot["verdict"])
        assertNull(reboot["monotonic_delta_ms"])
        assertEquals(true, reboot["boot_changed"])
        val flaggedTicket = HashMap(ticket)
        flaggedTicket["flags"] = 15
        flaggedTicket["location_simulated"] = true
        val flaggedPhoto = HashMap(photo(0))
        flaggedPhoto["flags"] = 15
        flaggedPhoto["location_simulated"] = true
        assertEquals(
            TimeAudit.assess(ticket, photo(0))["verdict"],
            TimeAudit.assess(flaggedTicket, flaggedPhoto)["verdict"],
        )
        val backward = HashMap(photo(0))
        backward["monotonic_ms"] = 9_999L
        backward["wall_time_ms"] = 1_700_000_000_000L - 1
        val back = TimeAudit.assess(ticket, backward)
        assertEquals("UNVERIFIED TIME", back["verdict"])
        assertFalse((back["labels"] as List<*>).contains("DEVICE CLOCK MISMATCH"))
    }

    @Test
    fun genesisPayloadMatchesTheServerFixture() {
        val clock = mapOf("wall_time_ms" to 1_700_000_000_000L, "monotonic_ms" to 5000, "boot_count" to 4)
        assertEquals(vectors.getString("ticketClockBytes"), CaptureRecord.ticketClockBytes(clock))
        val payload = CaptureRecord.genesisPayload(vectors.getString("ticketHashHex"), clock)
        // The vector is the payload itself: SHA256(ticket_hash_raw || clock), not a second hash of those bytes.
        assertEquals(vectors.getString("genesisPayloadSha256"), hex(payload))
        val client = CaptureRecord.genesisClientData(vectors.getString("ticketHashHex"), clock)
        assertTrue(client.toString(Charsets.UTF_8).startsWith("shield-genesis-v1"))
    }

    @Test
    fun ecdsaOverTheSigningMessageRoundTripsAndRejectsATamperedByte() {
        val message = CaptureRecord.signingMessage(required(), vectors.getString("prevHash"))
        val keys = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(keys.private)
        signer.update(message)
        val der = signer.sign()
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(keys.public)
        verifier.update(message)
        assertTrue(verifier.verify(der))
        val tampered = message.copyOf()
        tampered[0] = (tampered[0].toInt() xor 0xff).toByte()
        val again = Signature.getInstance("SHA256withECDSA")
        again.initVerify(keys.public)
        again.update(tampered)
        assertFalse(again.verify(der))
    }

    @Test
    fun floatsAreRejected() {
        val floated = HashMap(required())
        floated["wall_time_ms"] = 1.5
        try {
            CaptureRecord.canonical(floated)
            throw AssertionError("expected a float rejection")
        } catch (err: IllegalArgumentException) {
            assertTrue(err.message!!.contains("float"))
        }
    }

    private fun hex(bytes: ByteArray): String {
        val out = StringBuilder(bytes.size * 2)
        for (b in bytes) out.append("%02x".format(b.toInt() and 0xff))
        return out.toString()
    }

    private fun required(checkpoint: String = "cp-1", wall: Long = 1_700_000_000_000L): Map<String, Any?> = mapOf(
        "version" to 1,
        "checkpoint_id" to checkpoint,
        "photo_sha256" to vectors.getString("photoSha256"),
        "ticket_id" to "ticket-1",
        "wall_time_ms" to wall,
        "monotonic_ms" to 5000,
        "boot_count" to 4,
        "flags" to 0,
    )

    private fun loadVectors(): JSONObject {
        val start = System.getProperty("user.dir") ?: throw IllegalStateException("user.dir is unset")
        var dir: File? = File(start)
        repeat(8) {
            val current = dir ?: return@repeat
            val direct = File(current, "test-vectors/capture-record-v1.json")
            if (direct.isFile) return JSONObject(direct.readText())
            val nested = File(current, "shield-app/test-vectors/capture-record-v1.json")
            if (nested.isFile) return JSONObject(nested.readText())
            dir = current.parentFile
        }
        throw IllegalStateException("capture-record-v1.json not found from ${System.getProperty("user.dir")}")
    }
}
