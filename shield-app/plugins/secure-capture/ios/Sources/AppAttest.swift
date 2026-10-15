import CryptoKit
import DeviceCheck
import Foundation

/// Apple App Attest, kept apart from the Secure Enclave signing key in EnclaveSigner.
///
/// Two steps, and only the first needs the network:
///  1. Enrollment (online, once, at sign-on). Make an App Attest key and have Apple vouch for it with `attestKey`.
///     The Shield server checks that proof (POST /shield/attest). Only after it accepts does the phone call
///     `confirm`, and only a confirmed key is used afterwards.
///  2. Per photo (offline). `generateAssertion` over the photo's record hash, with the confirmed key.
///
/// Nothing here says a photo is attested. An assertion proves nothing until a server checks it against the key it
/// enrolled, and no server step that does so exists yet. The app labels it accordingly.
enum AppAttest {
    struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ text: String) { description = text }
    }

    private static let confirmedKey = "shield.appattest.confirmed.keyid"
    private static let enrollSeconds = 30.0
    private static let assertSeconds = 10.0

    /// Carries a result out of Apple's completion handler. A class, because the handler may run on any thread.
    private final class Box<T>: @unchecked Sendable {
        var value: T?
        var error: Error?
    }

    static var isSupported: Bool { DCAppAttestService.shared.isSupported }

    /// The key id the server accepted, or nil when this phone is not enrolled.
    static func confirmedKeyId() -> String? {
        guard let id = UserDefaults.standard.string(forKey: confirmedKey), !id.isEmpty else { return nil }
        return id
    }

    static func confirm(keyId: String) {
        UserDefaults.standard.set(keyId, forKey: confirmedKey)
    }

    /// A new key and Apple's proof for it. Apple lets a key be attested once, so every call makes a new key: a
    /// failed attempt (for example one the server rejected) starts from scratch instead of reusing a spent key.
    static func enroll(nonce: String) throws -> (keyId: String, attestation: Data) {
        guard isSupported else { throw Failure("this device does not support App Attest") }
        let keyId = try generateKey()
        // The server's check: nonce = SHA256(authData || SHA256(challenge)), with the challenge being the nonce text.
        let clientDataHash = Data(SHA256.hash(data: Data(nonce.utf8)))
        return (keyId, try attestKey(keyId, clientDataHash: clientDataHash))
    }

    /// Apple's signed statement about one record hash, made with the confirmed key. Works offline.
    /// The client data hash is the record's own 32-byte SHA-256, so the assertion covers the photo hash, the chain
    /// position and everything else in the signed record. Returns nil when the phone is not enrolled.
    static func assertion(recordHashHex: String) throws -> (keyId: String, assertion: Data)? {
        guard let keyId = confirmedKeyId() else { return nil }
        guard let hash = bytes(fromHex: recordHashHex), hash.count == 32 else { throw Failure("the record hash is not 32 bytes") }
        return (keyId, try generateAssertion(keyId, clientDataHash: hash))
    }

    /// A short reason for the screen. Apple's own error text is long and says little.
    static func describe(_ error: Error) -> String {
        if let failure = error as? Failure { return failure.description }
        if let dc = error as? DCError {
            if dc.code == .featureUnsupported { return "App Attest is not available for this app or device" }
            if dc.code == .serverUnavailable { return "Apple's App Attest service could not be reached; check the connection and try again" }
            if dc.code == .invalidKey { return "the App Attest key is not valid" }
            if dc.code == .invalidInput { return "App Attest rejected its input" }
            return "App Attest failed (unknown system failure)"
        }
        return String(describing: error)
    }

    private static func generateKey() throws -> String {
        let done = DispatchSemaphore(value: 0)
        let box = Box<String>()
        DCAppAttestService.shared.generateKey { keyId, error in
            box.value = keyId
            box.error = error
            done.signal()
        }
        try wait(done, "creating the App Attest key", seconds: enrollSeconds)
        if let error = box.error { throw error }
        guard let keyId = box.value, !keyId.isEmpty else { throw Failure("Apple returned no key") }
        return keyId
    }

    private static func attestKey(_ keyId: String, clientDataHash: Data) throws -> Data {
        let done = DispatchSemaphore(value: 0)
        let box = Box<Data>()
        DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
            box.value = attestation
            box.error = error
            done.signal()
        }
        try wait(done, "Apple's attestation", seconds: enrollSeconds)
        if let error = box.error { throw error }
        guard let attestation = box.value, !attestation.isEmpty else { throw Failure("Apple returned no attestation") }
        return attestation
    }

    private static func generateAssertion(_ keyId: String, clientDataHash: Data) throws -> Data {
        let done = DispatchSemaphore(value: 0)
        let box = Box<Data>()
        DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
            box.value = assertion
            box.error = error
            done.signal()
        }
        try wait(done, "the App Attest assertion", seconds: assertSeconds)
        if let error = box.error { throw error }
        guard let assertion = box.value, !assertion.isEmpty else { throw Failure("Apple returned no assertion") }
        return assertion
    }

    private static func wait(_ done: DispatchSemaphore, _ what: String, seconds: Double) throws {
        if done.wait(timeout: .now() + seconds) == .timedOut {
            throw Failure("\(what) did not answer within \(Int(seconds)) seconds")
        }
    }

    private static func bytes(fromHex text: String) -> Data? {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0 else { return nil }
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case 48...57: return c - 48
            case 97...102: return c - 87
            case 65...70: return c - 55
            default: return nil
            }
        }
        var out = Data(capacity: chars.count / 2)
        var index = 0
        while index < chars.count {
            guard let high = nibble(chars[index]), let low = nibble(chars[index + 1]) else { return nil }
            out.append(high << 4 | low)
            index += 2
        }
        return out
    }
}
