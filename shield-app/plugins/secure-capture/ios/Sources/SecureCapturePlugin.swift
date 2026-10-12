import AVFoundation
import Capacitor
import CoreLocation
import CryptoKit
import Darwin
import Foundation
import UIKit

@objc(SecureCapturePlugin)
public class SecureCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureCapturePlugin"
    public let jsName = "SecureCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "warmCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureAndSeal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signGenesis", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enrollKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "adoptServerTicket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readOriginal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verifyLocal", returnType: CAPPluginReturnPromise),
    ]

    private let sealQueue = DispatchQueue(label: "app.tradedeck.shield.seal")
    private let sealLock = NSLock()
    private let location = LocationFix()

    @objc override public func load() {
        #if DEBUG
        CaptureRecord.assertFixtures()
        #endif
    }

    @objc func warmCamera(_ call: CAPPluginCall) {
        let facing: AVCaptureDevice.Position = call.getString("facing") == "front" ? .front : .back
        CameraEngine.shared.warm(facing)
        location.start()
        if let ticketId = call.getString("ticketId"), !ticketId.isEmpty {
            sealQueue.async {
                self.sealLock.lock()
                _ = try? self.ensureChainUnlocked(ticketId)
                self.sealLock.unlock()
            }
        }
        call.resolve()
    }

    @objc func captureAndSeal(_ call: CAPPluginCall) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .authorized {
            presentCapture(call)
            return
        }
        if status == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted { self.presentCapture(call) }
                    else { call.reject("camera-denied") }
                }
            }
            return
        }
        call.reject("camera-denied")
    }

    @objc func readClock(_ call: CAPPluginCall) {
        call.resolve(bridgeObject(clockMap()))
    }

    @objc func enrollKey(_ call: CAPPluginCall) {
        sealQueue.async {
            do {
                let challenge = self.base64(call.getString("challengeBase64"))
                let material = try EnclaveSigner.ensure(serverChallenge: challenge)
                // TODO(app-attest): DCAppAttestService.attestKey is an online enrollment step.
                // TODO(play-integrity): not applicable on iOS. The Android plugin owns that hook.
                let json: [String: Any] = [
                    "public_key_uncompressed_b64": material.publicUncompressedB64,
                    "key_id_sha256": material.keyIdSha256,
                    "key_security_level": material.securityLevel,
                    "attestation_chain_b64": NSNull(),
                    "attestation_challenge_source": material.challengeSource,
                    "play_integrity_token": NSNull(),
                    "app_attest_assertion_b64": NSNull(),
                ]
                self.finish(call, json)
            } catch {
                self.fail(call, "seal-failed")
            }
        }
    }

    @objc func resetKey(_ call: CAPPluginCall) {
        if Outbox.hasRecords() {
            call.reject("records-exist")
            return
        }
        EnclaveSigner.reset()
        call.resolve()
    }

    @objc func signGenesis(_ call: CAPPluginCall) {
        sealQueue.async {
            do {
                guard let ticketHash = call.getString("ticketHashHex"),
                      let clock = self.object(call, "ticketClock") else {
                    self.fail(call, "seal-failed")
                    return
                }
                let normalized = self.normalize(clock)
                _ = try CaptureRecord.ticketClockBytes(normalized)
                let material = try EnclaveSigner.ensure(serverChallenge: nil)
                let client = try CaptureRecord.genesisClientData(ticketHashHex: ticketHash, observation: normalized)
                let der = try EnclaveSigner.sign(client)
                // TODO(app-attest): generateAssertion(keyId, clientDataHash: SHA256(client)) is not called.
                let json: [String: Any] = [
                    "signature_der_b64": der.base64EncodedString(),
                    "signature_kind": "secure-enclave-p256",
                    "public_key_uncompressed_b64": material.publicUncompressedB64,
                    "key_id_sha256": material.keyIdSha256,
                    "client_data_sha256": CaptureRecord.sha256Hex(client),
                    "app_attest_assertion_b64": NSNull(),
                ]
                self.finish(call, json)
            } catch {
                self.fail(call, "seal-failed")
            }
        }
    }

    @objc func adoptServerTicket(_ call: CAPPluginCall) {
        sealQueue.async {
            do {
                guard let ticketId = call.getString("ticketId"),
                      let ticketHash = call.getString("ticketHash"),
                      let clock = self.object(call, "ticketClock") else {
                    self.fail(call, "seal-failed")
                    return
                }
                let normalized = self.normalize(clock)
                _ = try CaptureRecord.ticketClockBytes(normalized)
                self.sealLock.lock()
                defer { self.sealLock.unlock() }
                let existing = Outbox.chain(ticketId: ticketId)
                if !self.hashes(existing).isEmpty {
                    self.fail(call, "chain-already-started")
                    return
                }
                let chain: [String: Any] = [
                    "ticket_id": ticketId,
                    "ticket_origin": "server",
                    "anchor_hash": ticketHash,
                    "ticket_clock": normalized,
                    "records": [Any](),
                ]
                try Outbox.writeChain(ticketId: ticketId, chain: chain)
                DispatchQueue.main.async { call.resolve() }
            } catch {
                self.fail(call, "seal-failed")
            }
        }
    }

    @objc func listQueue(_ call: CAPPluginCall) {
        let wanted = call.getString("ticketId")
        var rows: [[String: Any]] = []
        for ticketId in Outbox.ticketIds() where wanted == nil || wanted == ticketId {
            for hash in hashes(Outbox.chain(ticketId: ticketId)) {
                guard let stored = Outbox.readRecord(recordHash: hash),
                      let record = stored["record"] as? [String: Any] else { continue }
                rows.append([
                    "record_hash": record["record_hash"] as? String ?? "",
                    "ticket_id": record["ticket_id"] as? String ?? "",
                    "photo_sha256": record["photo_sha256"] as? String ?? "",
                ])
            }
        }
        call.resolve(["records": rows])
    }

    @objc func exportQueue(_ call: CAPPluginCall) {
        let wanted = call.getString("ticketId")
        let packages = Outbox.ticketIds().compactMap { ticketId -> [String: Any]? in
            if let wanted, wanted != ticketId { return nil }
            return exportPackage(ticketId)
        }
        call.resolve(bridgeObject(["packages": packages]))
    }

    @objc func readOriginal(_ call: CAPPluginCall) {
        guard let hash = call.getString("recordHash"), let bytes = Outbox.readPhoto(recordHash: hash) else {
            call.reject("seal-failed")
            return
        }
        call.resolve([
            "photoBase64": bytes.base64EncodedString(),
            "mime": "image/jpeg",
        ])
    }

    @objc func verifyLocal(_ call: CAPPluginCall) {
        sealQueue.async {
            let wanted = call.getString("ticketId")
            let material = EnclaveSigner.current()
            let packages: [[String: Any]] = Outbox.ticketIds().compactMap { ticketId in
                if let wanted, wanted != ticketId { return nil }
                return self.verifyTicket(ticketId, material: material)
            }
            self.finish(call, ["packages": packages])
        }
    }

    private func presentCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("camera-failed")
                return
            }
            let facing: AVCaptureDevice.Position = call.getString("facing") == "front" ? .front : .back
            CameraEngine.shared.warm(facing)
            self.location.start()
            let view = CaptureViewController(location: self.location)
            view.onShot = { result in
                switch result {
                case .failure(let error):
                    let code = (error as? CaptureFailure)?.code ?? "camera-failed"
                    call.reject(code)
                case .success(let shot):
                    self.sealQueue.async { self.sealShot(call, shot) }
                }
            }
            host.present(view, animated: true)
        }
    }

    private func sealShot(_ call: CAPPluginCall, _ shot: Shot) {
        do {
            if shot.jpeg.isEmpty {
                fail(call, "empty-bytes")
                return
            }
            let photoHash = CaptureRecord.sha256Hex(shot.jpeg)
            let checkpointId = call.getString("checkpointId").flatMap { $0.isEmpty ? nil : $0 } ?? "unbound"
            let ticketId = call.getString("ticketId").flatMap { $0.isEmpty ? nil : $0 } ?? "device"
            let bundledVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            let appVersion = call.getString("appVersion") ?? bundledVersion ?? "0"
            let material = try EnclaveSigner.ensure(serverChallenge: nil)
            let photoClock = clockMap()
            let debugger = debuggerAttached()
            var flags: Int64 = 0
            if shot.screenCaptured { flags |= 1 }
            if debugger { flags |= 2 }
            if shot.simulated == true { flags |= 4 }

            var snapshot: [String: Any] = [:]
            if let location = shot.location {
                snapshot["lat_microdeg"] = micro(location.coordinate.latitude)
                snapshot["lng_microdeg"] = micro(location.coordinate.longitude)
                snapshot["accuracy_mm"] = Int64((location.horizontalAccuracy * 1000).rounded())
                if location.verticalAccuracy >= 0 {
                    snapshot["altitude_mm"] = Int64((location.altitude * 1000).rounded())
                }
                if location.course >= 0 {
                    snapshot["heading_hundredths"] = Int64((location.course * 100).rounded())
                }
                if location.speed >= 0 {
                    snapshot["speed_mm_s"] = Int64((location.speed * 1000).rounded())
                }
                snapshot["location_source"] = "CLLocation"
                if let api = shot.mockApi { snapshot["mock_api"] = api }
                if let simulated = shot.simulated { snapshot["location_simulated"] = simulated }
                // CLLocation.timestamp is the OS fix time, not a raw satellite clock.
                snapshot["gnss_time_source"] = "CLLocation.timestamp"
            }
            snapshot["app_version"] = appVersion
            snapshot["platform"] = "ios"
            snapshot["os_version"] = UIDevice.current.systemVersion
            snapshot["key_security_level"] = material.securityLevel
            snapshot["key_id_sha256"] = material.keyIdSha256
            snapshot["screen_captured"] = shot.screenCaptured
            snapshot["debugger"] = debugger
            snapshot["depth"] = "not_available"

            var record: [String: Any] = [
                "version": 1,
                "checkpoint_id": checkpointId,
                "photo_sha256": photoHash,
                "ticket_id": ticketId,
                "wall_time_ms": photoClock["wall_time_ms"] as? Int64 ?? wallMs(),
                "monotonic_ms": photoClock["monotonic_ms"] as? Int64 ?? monotonicMs(),
                "flags": flags,
                "depth_present": false,
                "sensor_hash": CaptureRecord.sha256Hex(Data((try CaptureRecord.canonicalWhole(snapshot)).utf8)),
            ]
            if let boot = photoClock["boot_id"] as? String, !boot.isEmpty { record["boot_id"] = boot }
            if let simulated = shot.simulated { record["location_simulated"] = simulated }
            if let location = shot.location {
                record["gnss_time_ms"] = Int64((location.timestamp.timeIntervalSince1970 * 1000).rounded())
            }

            sealLock.lock()
            defer { sealLock.unlock() }
            var chain = try ensureChainUnlocked(ticketId)
            var hashes = self.hashes(chain)
            let prev = hashes.last ?? (chain["anchor_hash"] as? String ?? "")
            let sealed = try CaptureRecord.seal(record, prevHash: prev)
            let message = try CaptureRecord.signingMessage(record, prevHash: prev)
            let der = try EnclaveSigner.sign(message)
            let recordHash = sealed["record_hash"] as? String ?? ""
            hashes.append(recordHash)
            chain["records"] = hashes
            let body: [String: Any] = [
                "schema": "tradedeck.shield.capture.v1",
                "record": sealed,
                "sensor_snapshot": snapshot,
                "signature_der_b64": der.base64EncodedString(),
                "signature_kind": "secure-enclave-p256",
                "public_key_uncompressed_b64": material.publicUncompressedB64,
                "key_id_sha256": material.keyIdSha256,
                "key_security_level": material.securityLevel,
                "attestation_chain_b64": NSNull(),
                "attestation_challenge_source": material.challengeSource,
                "app_attest_assertion_b64": NSNull(),
                "play_integrity_token": NSNull(),
                "ticket_origin": chain["ticket_origin"] as? String ?? "local",
                "anchor_hash": chain["anchor_hash"] as? String ?? "",
                "ticket_clock": chain["ticket_clock"] as? [String: Any] ?? [:],
                "mime": "image/jpeg",
            ]
            try Outbox.writeRecord(recordHash: recordHash, json: body, photo: shot.jpeg)
            try Outbox.writeChain(ticketId: ticketId, chain: chain)
            var envelope = body
            envelope["photoBase64"] = shot.jpeg.base64EncodedString()
            finish(call, envelope)
        } catch {
            fail(call, "seal-failed")
        }
    }

    private func ensureChainUnlocked(_ ticketId: String) throws -> [String: Any] {
        if let existing = Outbox.chain(ticketId: ticketId) { return existing }
        let clock = clockMap()
        let anchor = try CaptureRecord.localGenesisHash(ticketId: ticketId, observation: clock)
        let chain: [String: Any] = [
            "ticket_id": ticketId,
            "ticket_origin": "local",
            "anchor_hash": anchor,
            "ticket_clock": clock,
            "records": [Any](),
        ]
        try Outbox.writeChain(ticketId: ticketId, chain: chain)
        return chain
    }

    private func verifyTicket(_ ticketId: String, material: EnclaveSigner.Material?) -> [String: Any] {
        guard let chain = Outbox.chain(ticketId: ticketId) else {
            return ["ticket_id": ticketId, "chain_verdict": "TAMPERED", "chain_summary": "missing chain", "time_verdicts": [], "signatures": [], "photos": [], "device_key_match": false]
        }
        var maps: [[String: Any]] = []
        var signatures: [String] = []
        var photos: [String] = []
        var times: [String] = []
        let ticketClock = chain["ticket_clock"] as? [String: Any]
        var deviceMatch = material != nil
        for hash in hashes(chain) {
            guard let stored = Outbox.readRecord(recordHash: hash), let record = stored["record"] as? [String: Any] else {
                signatures.append("absent")
                photos.append("absent")
                times.append("UNVERIFIED TIME")
                continue
            }
            maps.append(record)
            let prev = record["prev_hash"] as? String ?? ""
            let sigB64 = stored["signature_der_b64"] as? String ?? ""
            let ok: Bool = {
                guard let material, let der = Data(base64Encoded: sigB64),
                      let point = Data(base64Encoded: material.publicUncompressedB64),
                      let key = try? P256.Signing.PublicKey(x963Representation: point),
                      let message = try? CaptureRecord.signingMessage(record, prevHash: prev) else { return false }
                return EnclaveSigner.verify(message: message, der: der, publicKey: key)
            }()
            signatures.append(sigB64.isEmpty ? "absent" : (ok ? "valid" : "invalid"))
            if let photo = Outbox.readPhoto(recordHash: record["record_hash"] as? String ?? hash) {
                photos.append(CaptureRecord.sha256Hex(photo) == (record["photo_sha256"] as? String) ? "match" : "mismatch")
            } else {
                photos.append("absent")
            }
            if let ticketClock, let verdict = try? TimeAudit.assess(ticketClock, record)["verdict"] as? String {
                times.append(verdict)
            } else {
                times.append("UNVERIFIED TIME")
            }
            if let material, (stored["public_key_uncompressed_b64"] as? String) != material.publicUncompressedB64 {
                deviceMatch = false
            }
        }
        let checked = CaptureRecord.verifyChain(maps, firstPrev: chain["anchor_hash"] as? String ?? "")
        let reason = checked["reason"] as? String
        return [
            "ticket_id": ticketId,
            "chain_verdict": checked["verdict"] as? String ?? "TAMPERED",
            "chain_summary": reason ?? "All \(maps.count) capture records reproduce their hashes and links.",
            "time_verdicts": times,
            "signatures": signatures,
            "photos": photos,
            "device_key_match": deviceMatch,
        ]
    }

    private func exportPackage(_ ticketId: String) -> [String: Any] {
        let chain = Outbox.chain(ticketId: ticketId) ?? [:]
        let records: [[String: Any]] = hashes(chain).compactMap { hash in
            guard var stored = Outbox.readRecord(recordHash: hash) else { return nil }
            stored.removeValue(forKey: "photoBase64")
            return stored
        }
        return [
            "schema": "tradedeck.shield.capture-export.v1",
            "ticket_id": ticketId,
            "ticket_origin": chain["ticket_origin"] as? String ?? "local",
            "anchor_hash": chain["anchor_hash"] as? String ?? "",
            "ticket_clock": chain["ticket_clock"] ?? NSNull(),
            "records": records,
        ]
    }

    private func hashes(_ chain: [String: Any]?) -> [String] {
        (chain?["records"] as? [Any])?.compactMap { $0 as? String } ?? []
    }

    private func clockMap() -> [String: Any] {
        var clock: [String: Any] = [
            "wall_time_ms": wallMs(),
            "monotonic_ms": monotonicMs(),
        ]
        if let boot = bootIdentifier(), !boot.isEmpty { clock["boot_id"] = boot }
        return clock
    }

    private func wallMs() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }

    /// mach_continuous_time converted to milliseconds with integer timebase math.
    private func monotonicMs() -> Int64 {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        let ticks = mach_continuous_time()
        let scale = UInt64(info.denom) * 1_000_000
        if scale == 0 { return 0 }
        let numer = UInt64(info.numer)
        let ms = ticks / scale * numer + (ticks % scale) * numer / scale
        return ms > UInt64(Int64.max) ? Int64.max : Int64(ms)
    }

    private func bootIdentifier() -> String? {
        var size = 0
        if sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) != 0 || size <= 1 { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        let rc = buffer.withUnsafeMutableBufferPointer { pointer -> Int32 in
            sysctlbyname("kern.bootsessionuuid", pointer.baseAddress, &size, nil, 0)
        }
        if rc != 0 { return nil }
        let text = String(cString: buffer).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private func debuggerAttached() -> Bool {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        let rc = mib.withUnsafeMutableBufferPointer { buffer -> Int32 in
            sysctl(buffer.baseAddress, UInt32(buffer.count), &info, &size, nil, 0)
        }
        return rc == 0 && (info.kp_proc.p_flag & P_TRACED) != 0
    }

    private func micro(_ degrees: CLLocationDegrees) -> Int64 {
        Int64((degrees * 1_000_000).rounded())
    }

    private func object(_ call: CAPPluginCall, _ key: String) -> [String: Any]? {
        call.getObject(key)
    }

    private func normalize(_ value: [String: Any]) -> [String: Any] {
        Outbox.fromJSON(value) as? [String: Any] ?? value
    }

    private func base64(_ text: String?) -> Data? {
        guard let text, !text.isEmpty else { return nil }
        return Data(base64Encoded: text)
    }

    private func bridgeObject(_ value: [String: Any]) -> [String: Any] {
        let ready = Outbox.jsonReady(value)
        guard let object = ready as? [String: Any],
              JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return value
        }
        return parsed
    }

    private func finish(_ call: CAPPluginCall, _ json: [String: Any]) {
        let payload = bridgeObject(json)
        DispatchQueue.main.async { call.resolve(payload) }
    }

    private func fail(_ call: CAPPluginCall, _ code: String) {
        DispatchQueue.main.async { call.reject(code) }
    }
}
