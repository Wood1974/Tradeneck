package app.tradedeck.shield.securecapture

import android.Manifest
import android.os.Build
import android.os.Debug
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

@CapacitorPlugin(
    name = "SecureCapture",
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION],
            alias = "location",
        ),
    ],
)
class SecureCapturePlugin : Plugin() {
    private val io = Executors.newSingleThreadExecutor()
    private val sealLock = Any()
    private lateinit var outbox: Outbox
    private lateinit var signer: KeystoreSigner

    override fun load() {
        outbox = Outbox(context)
        signer = KeystoreSigner(context)
    }

    @PluginMethod
    fun warmCamera(call: PluginCall) {
        io.execute {
            try {
                val ticketId = call.getString("ticketId")
                if (!ticketId.isNullOrBlank()) ensureChain(ticketId)
                androidx.camera.lifecycle.ProcessCameraProvider.getInstance(context)
                call.resolve()
            } catch (err: Exception) {
                call.reject("camera-failed")
            }
        }
    }

    @PluginMethod
    fun captureAndSeal(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "onCameraPermission")
            return
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLocationThenCapture")
            return
        }
        beginCapture(call)
    }

    @PermissionCallback
    fun onCameraPermission(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            call.reject("camera-denied")
            return
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLocationThenCapture")
            return
        }
        beginCapture(call)
    }

    @PermissionCallback
    fun onLocationThenCapture(call: PluginCall) {
        beginCapture(call)
    }

    private fun beginCapture(call: PluginCall) {
        val activity = activity
        if (activity == null) {
            call.reject("camera-failed")
            return
        }
        val facing = if (call.getString("facing") == "front") "front" else "back"
        CameraCapture.open(activity, facing) { result ->
            result.fold(
                onSuccess = { shot -> io.execute { sealShot(call, shot) } },
                onFailure = { err ->
                    val code = (err as? CameraCapture.CaptureException)?.code ?: "camera-failed"
                    call.reject(code)
                },
            )
        }
    }

    @PluginMethod
    fun readClock(call: PluginCall) {
        call.resolve(JSObject(JSONObject(clockMap() as Map<*, *>).toString()))
    }

    @PluginMethod
    fun enrollKey(call: PluginCall) {
        io.execute {
            try {
                val challenge = call.getString("challengeBase64")?.let { Base64.decode(it, Base64.NO_WRAP) }
                val material = signer.ensure(challenge)
                val json = JSONObject()
                json.put("public_key_uncompressed_b64", material.publicUncompressedB64)
                json.put("key_id_sha256", material.keyIdSha256)
                json.put("key_security_level", material.securityLevel)
                json.put("attestation_chain_b64", material.attestationChainB64 ?: JSONObject.NULL)
                json.put("attestation_challenge_source", material.challengeSource)
                // TODO(play-integrity): request a standard token bound to this enrollment. Not called here.
                json.put("play_integrity_token", JSONObject.NULL)
                json.put("app_attest_assertion_b64", JSONObject.NULL)
                call.resolve(JSObject(json.toString()))
            } catch (err: Exception) {
                call.reject("seal-failed")
            }
        }
    }

    @PluginMethod
    fun resetKey(call: PluginCall) {
        if (outbox.hasRecords()) {
            call.reject("records-exist")
            return
        }
        signer.reset()
        call.resolve()
    }

    @PluginMethod
    fun signGenesis(call: PluginCall) {
        io.execute {
            try {
                val ticketHash = call.getString("ticketHashHex") ?: throw IllegalArgumentException("ticket hash")
                val clock = jsonObjectToMap(call.getObject("ticketClock") ?: throw IllegalArgumentException("clock"))
                CaptureRecord.ticketClockBytes(clock)
                val material = signer.ensure(null)
                val client = CaptureRecord.genesisClientData(ticketHash, clock)
                val der = signer.sign(client)
                val json = JSONObject()
                json.put("signature_der_b64", Base64.encodeToString(der, Base64.NO_WRAP))
                json.put("signature_kind", "keystore-sha256-ecdsa")
                json.put("public_key_uncompressed_b64", material.publicUncompressedB64)
                json.put("key_id_sha256", material.keyIdSha256)
                json.put("client_data_sha256", CaptureRecord.sha256(client))
                // TODO(app-attest): not applicable on Android. Play Integrity stays a sync-time TODO.
                json.put("app_attest_assertion_b64", JSONObject.NULL)
                call.resolve(JSObject(json.toString()))
            } catch (err: Exception) {
                call.reject("seal-failed")
            }
        }
    }

    @PluginMethod
    fun adoptServerTicket(call: PluginCall) {
        io.execute {
            try {
                val ticketId = call.getString("ticketId") ?: throw IllegalArgumentException("ticket")
                val ticketHash = call.getString("ticketHash") ?: throw IllegalArgumentException("hash")
                val clock = jsonObjectToMap(call.getObject("ticketClock") ?: throw IllegalArgumentException("clock"))
                CaptureRecord.ticketClockBytes(clock)
                synchronized(sealLock) {
                    val existing = outbox.chain(ticketId)
                    val count = existing?.optJSONArray("records")?.length() ?: 0
                    if (count > 0) throw IllegalArgumentException("chain-already-started")
                    val chain = JSONObject()
                    chain.put("ticket_id", ticketId)
                    chain.put("ticket_origin", "server")
                    chain.put("anchor_hash", ticketHash)
                    chain.put("ticket_clock", JSONObject(clock as Map<*, *>))
                    chain.put("records", JSONArray())
                    outbox.writeChain(ticketId, chain)
                }
                call.resolve()
            } catch (err: IllegalArgumentException) {
                call.reject(if (err.message == "chain-already-started") "chain-already-started" else "seal-failed")
            } catch (err: Exception) {
                call.reject("seal-failed")
            }
        }
    }

    @PluginMethod
    fun listQueue(call: PluginCall) {
        val wanted = call.getString("ticketId")
        val rows = JSONArray()
        for (ticketId in outbox.ticketIds()) {
            if (wanted != null && ticketId != wanted) continue
            val chain = outbox.chain(ticketId) ?: continue
            val hashes = chain.optJSONArray("records") ?: JSONArray()
            for (i in 0 until hashes.length()) {
                val record = outbox.readRecord(hashes.getString(i)) ?: continue
                val body = record.getJSONObject("record")
                rows.put(JSONObject()
                    .put("record_hash", body.getString("record_hash"))
                    .put("ticket_id", body.getString("ticket_id"))
                    .put("photo_sha256", body.getString("photo_sha256")))
            }
        }
        call.resolve(JSObject(JSONObject().put("records", rows).toString()))
    }

    @PluginMethod
    fun exportQueue(call: PluginCall) {
        val wanted = call.getString("ticketId")
        val packages = JSONArray()
        for (ticketId in outbox.ticketIds()) {
            if (wanted != null && ticketId != wanted) continue
            packages.put(exportPackage(ticketId))
        }
        call.resolve(JSObject(JSONObject().put("packages", packages).toString()))
    }

    @PluginMethod
    fun readOriginal(call: PluginCall) {
        val hash = call.getString("recordHash") ?: return call.reject("seal-failed")
        val bytes = outbox.readPhoto(hash) ?: return call.reject("seal-failed")
        val json = JSONObject()
        json.put("photoBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        json.put("mime", "image/jpeg")
        call.resolve(JSObject(json.toString()))
    }

    @PluginMethod
    fun verifyLocal(call: PluginCall) {
        io.execute {
            try {
                val wanted = call.getString("ticketId")
                val packages = JSONArray()
                val material = signer.current()
                for (ticketId in outbox.ticketIds()) {
                    if (wanted != null && ticketId != wanted) continue
                    packages.put(verifyTicket(ticketId, material))
                }
                call.resolve(JSObject(JSONObject().put("packages", packages).toString()))
            } catch (err: Exception) {
                call.reject("seal-failed")
            }
        }
    }

    private fun sealShot(call: PluginCall, shot: CameraCapture.Shot) {
        try {
            val photoHash = CaptureRecord.sha256(shot.jpeg)
            if (shot.jpeg.isEmpty()) {
                call.reject("empty-bytes")
                return
            }
            val checkpointId = call.getString("checkpointId")?.takeIf { it.isNotBlank() } ?: "unbound"
            val ticketId = call.getString("ticketId")?.takeIf { it.isNotBlank() } ?: "device"
            val appVersion = call.getString("appVersion") ?: nativeVersion()
            val material = signer.ensure(null)
            val photoClock = clockMap()
            val debugger = Debug.isDebuggerConnected()
            val root = Build.TAGS?.contains("test-keys") == true
            val simulated = shot.location?.let { CameraCapture.isMock(it) }
            var flags = 0
            if (shot.screenCaptured) flags = flags or 1
            if (debugger) flags = flags or 2
            if (simulated == true) flags = flags or 4
            if (root) flags = flags or 8

            val snapshot = linkedMapOf<String, Any?>()
            val location = shot.location
            if (location != null) {
                snapshot["lat_microdeg"] = Math.round(location.latitude * 1_000_000.0).toInt()
                snapshot["lng_microdeg"] = Math.round(location.longitude * 1_000_000.0).toInt()
                if (location.hasAccuracy()) snapshot["accuracy_mm"] = Math.round(location.accuracy.toDouble() * 1000.0).toInt()
                if (location.hasAltitude()) snapshot["altitude_mm"] = Math.round(location.altitude * 1000.0).toInt()
                if (location.hasBearing()) snapshot["heading_hundredths"] = Math.round(location.bearing.toDouble() * 100.0).toInt()
                if (location.hasSpeed()) snapshot["speed_mm_s"] = Math.round(location.speed.toDouble() * 1000.0).toInt()
                snapshot["location_source"] = location.provider ?: "unknown"
                if (shot.mockApi != null) snapshot["mock_api"] = shot.mockApi
                if (simulated != null) snapshot["location_simulated"] = simulated
                // Location.getTime() is the OS fix time. Network providers may stamp the device clock.
                snapshot["gnss_time_source"] = "Location.getTime"
            }
            snapshot["app_version"] = appVersion
            snapshot["platform"] = "android"
            snapshot["os_version"] = Build.VERSION.RELEASE ?: ""
            snapshot["key_security_level"] = material.securityLevel
            snapshot["key_id_sha256"] = material.keyIdSha256
            snapshot["screen_captured"] = shot.screenCaptured
            snapshot["debugger"] = debugger
            snapshot["root_traces"] = root
            snapshot["depth"] = "not_available"

            val record = linkedMapOf<String, Any?>(
                "version" to 1,
                "checkpoint_id" to checkpointId,
                "photo_sha256" to photoHash,
                "ticket_id" to ticketId,
                "wall_time_ms" to (photoClock["wall_time_ms"] as Long),
                "monotonic_ms" to (photoClock["monotonic_ms"] as Long),
                "flags" to flags,
                "depth_present" to false,
                "sensor_hash" to CaptureRecord.sha256(CaptureRecord.canonicalWhole(snapshot).toByteArray(Charsets.UTF_8)),
            )
            val boot = photoClock["boot_count"] as? Int
            if (boot != null && boot >= 0) record["boot_count"] = boot
            if (simulated != null) record["location_simulated"] = simulated
            if (location != null && location.time > 0L) record["gnss_time_ms"] = location.time

            val envelope = synchronized(sealLock) {
                val chain = ensureChain(ticketId)
                val hashes = chain.getJSONArray("records")
                val prev = if (hashes.length() == 0) chain.getString("anchor_hash") else hashes.getString(hashes.length() - 1)
                val sealed = CaptureRecord.seal(record, prev)
                val message = CaptureRecord.signingMessage(record, prev)
                val der = signer.sign(message)
                val recordHash = sealed["record_hash"] as String
                hashes.put(recordHash)
                val body = JSONObject()
                body.put("schema", "tradedeck.shield.capture.v1")
                body.put("record", JSONObject(sealed as Map<*, *>))
                body.put("sensor_snapshot", JSONObject(snapshot as Map<*, *>))
                body.put("signature_der_b64", Base64.encodeToString(der, Base64.NO_WRAP))
                body.put("signature_kind", "keystore-sha256-ecdsa")
                body.put("public_key_uncompressed_b64", material.publicUncompressedB64)
                body.put("key_id_sha256", material.keyIdSha256)
                body.put("key_security_level", material.securityLevel)
                body.put("attestation_chain_b64", material.attestationChainB64 ?: JSONObject.NULL)
                body.put("attestation_challenge_source", material.challengeSource)
                body.put("app_attest_assertion_b64", JSONObject.NULL)
                body.put("play_integrity_token", JSONObject.NULL)
                body.put("ticket_origin", chain.getString("ticket_origin"))
                body.put("anchor_hash", chain.getString("anchor_hash"))
                body.put("ticket_clock", chain.getJSONObject("ticket_clock"))
                body.put("mime", "image/jpeg")
                outbox.writeRecord(recordHash, body, shot.jpeg)
                outbox.writeChain(ticketId, chain)
                body
            }
            envelope.put("photoBase64", Base64.encodeToString(shot.jpeg, Base64.NO_WRAP))
            call.resolve(JSObject(envelope.toString()))
        } catch (err: Exception) {
            call.reject("seal-failed")
        }
    }

    private fun ensureChain(ticketId: String): JSONObject {
        synchronized(sealLock) {
            val existing = outbox.chain(ticketId)
            if (existing != null) return existing
            val clock = clockMap()
            val anchor = CaptureRecord.localGenesisHash(ticketId, clock)
            val chain = JSONObject()
            chain.put("ticket_id", ticketId)
            chain.put("ticket_origin", "local")
            chain.put("anchor_hash", anchor)
            chain.put("ticket_clock", JSONObject(clock as Map<*, *>))
            chain.put("records", JSONArray())
            outbox.writeChain(ticketId, chain)
            return chain
        }
    }

    private fun clockMap(): Map<String, Any?> {
        val clock = linkedMapOf<String, Any?>(
            "wall_time_ms" to System.currentTimeMillis(),
            "monotonic_ms" to SystemClock.elapsedRealtime(),
        )
        val boot = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
        if (boot >= 0) clock["boot_count"] = boot
        return clock
    }

    private fun nativeVersion(): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
    } catch (_: Exception) {
        "0"
    }

    private fun exportPackage(ticketId: String): JSONObject {
        val chain = outbox.chain(ticketId) ?: JSONObject()
        val records = JSONArray()
        val hashes = chain.optJSONArray("records") ?: JSONArray()
        for (i in 0 until hashes.length()) {
            val stored = outbox.readRecord(hashes.getString(i)) ?: continue
            stored.remove("photoBase64")
            records.put(stored)
        }
        return JSONObject()
            .put("schema", "tradedeck.shield.capture-export.v1")
            .put("ticket_id", ticketId)
            .put("ticket_origin", chain.optString("ticket_origin", "local"))
            .put("anchor_hash", chain.optString("anchor_hash"))
            .put("ticket_clock", chain.optJSONObject("ticket_clock") ?: JSONObject.NULL)
            .put("records", records)
    }

    private fun verifyTicket(ticketId: String, material: KeystoreSigner.Material?): JSONObject {
        val chain = outbox.chain(ticketId) ?: return JSONObject().put("ticket_id", ticketId).put("chain_verdict", "TAMPERED")
        val hashes = chain.optJSONArray("records") ?: JSONArray()
        val maps = ArrayList<Map<String, Any?>>()
        val signatures = JSONArray()
        val photos = JSONArray()
        val times = JSONArray()
        val ticketClock = chain.optJSONObject("ticket_clock")?.let { jsonObjectToMap(it) }
        var deviceMatch = material != null
        for (i in 0 until hashes.length()) {
            val stored = outbox.readRecord(hashes.getString(i))
            if (stored == null) {
                signatures.put("absent")
                photos.put("absent")
                times.put("UNVERIFIED TIME")
                continue
            }
            val record = jsonObjectToMap(stored.getJSONObject("record"))
            maps.add(record)
            val prev = record["prev_hash"] as String
            val message = CaptureRecord.signingMessage(record, prev)
            val sigB64 = stored.optString("signature_der_b64")
            val ok = try {
                material != null && signer.verify(message, Base64.decode(sigB64, Base64.NO_WRAP))
            } catch (_: Exception) {
                false
            }
            signatures.put(if (sigB64.isBlank()) "absent" else if (ok) "valid" else "invalid")
            val photo = outbox.readPhoto(record["record_hash"] as String)
            photos.put(when {
                photo == null -> "absent"
                CaptureRecord.sha256(photo) == record["photo_sha256"] -> "match"
                else -> "mismatch"
            })
            val label = if (ticketClock != null) TimeAudit.assess(ticketClock, record)["verdict"] as String else "UNVERIFIED TIME"
            times.put(label)
            if (material != null && stored.optString("public_key_uncompressed_b64") != material.publicUncompressedB64) {
                deviceMatch = false
            }
        }
        val checked = CaptureRecord.verifyChain(maps, chain.getString("anchor_hash"))
        return JSONObject()
            .put("ticket_id", ticketId)
            .put("chain_verdict", checked["verdict"])
            .put("chain_summary", checked["reason"] ?: "All ${maps.size} capture records reproduce their hashes and links.")
            .put("time_verdicts", times)
            .put("signatures", signatures)
            .put("photos", photos)
            .put("device_key_match", deviceMatch)
    }

    private fun jsonObjectToMap(obj: com.getcapacitor.JSObject): Map<String, Any?> = Outbox.jsonToMap(JSONObject(obj.toString()))

    private fun jsonObjectToMap(obj: JSONObject): Map<String, Any?> = Outbox.jsonToMap(obj)
}
