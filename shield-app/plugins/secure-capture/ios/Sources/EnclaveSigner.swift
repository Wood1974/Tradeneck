import CryptoKit
import Foundation
import Security

/// P-256 key that stays in the Secure Enclave when the device has one.
/// The simulator and a few older devices do not. Those fall back to a software
/// P-256 key in the Keychain, and the record says `software` so a server can refuse it.
/// The private key is never exported. App Attest is a later enrollment step.
///
/// TODO(app-attest): at enrollment call DCAppAttestService.attestKey, and per record
/// call generateAssertion(keyId, clientDataHash: SHA256(clientData)) or the raw
/// 32-byte record hash, once the server names which clientDataHash it expects.
/// attestKey needs the network, so the offline seal path must not call it.
/// This type does not call DCAppAttestService.
enum EnclaveSigner {
    struct Material {
        let publicUncompressedB64: String
        let keyIdSha256: String
        let securityLevel: String
        let challengeSource: String
    }

    private static let service = "app.tradedeck.shield"
    private static let account = "shield.securecapture.p256"
    private static let kindKey = "shield.securecapture.keykind"
    private static let sourceKey = "shield.securecapture.challenge_source"

    private enum Held {
        case enclave(SecureEnclave.P256.Signing.PrivateKey)
        case software(P256.Signing.PrivateKey)

        var publicKey: P256.Signing.PublicKey {
            switch self {
            case .enclave(let key): return key.publicKey
            case .software(let key): return key.publicKey
            }
        }

        var level: String {
            switch self {
            case .enclave: return "SecureEnclave"
            case .software: return "software"
            }
        }

        func sign(_ message: Data) throws -> Data {
            switch self {
            case .enclave(let key): return try key.signature(for: message).derRepresentation
            case .software(let key): return try key.signature(for: message).derRepresentation
            }
        }
    }

    static func current() -> Material? {
        guard let held = load() else { return nil }
        return describe(held, source: UserDefaults.standard.string(forKey: sourceKey) ?? "local")
    }

    /// Creates the key once. A later server challenge does not rotate a key that already exists.
    static func ensure(serverChallenge: Data?) throws -> Material {
        if let held = load() {
            return describe(held, source: UserDefaults.standard.string(forKey: sourceKey) ?? "local")
        }
        let source = serverChallenge == nil ? "local" : "server"
        let held = try create()
        UserDefaults.standard.set(source, forKey: sourceKey)
        return describe(held, source: source)
    }

    static func sign(_ message: Data) throws -> Data {
        guard let held = load() else {
            throw CaptureRecord.ContractError("signing key is missing")
        }
        return try held.sign(message)
    }

    static func verify(message: Data, der: Data, publicKey: P256.Signing.PublicKey) -> Bool {
        guard let signature = try? P256.Signing.ECDSASignature(derRepresentation: der) else { return false }
        return publicKey.isValidSignature(signature, for: message)
    }

    static func reset() {
        deleteKey()
        UserDefaults.standard.removeObject(forKey: sourceKey)
        UserDefaults.standard.removeObject(forKey: kindKey)
    }

    private static func create() throws -> Held {
        if let key = try? SecureEnclave.P256.Signing.PrivateKey() {
            try store(key.dataRepresentation, kind: "SecureEnclave")
            return .enclave(key)
        }
        let key = P256.Signing.PrivateKey()
        try store(key.dataRepresentation, kind: "software")
        return .software(key)
    }

    private static func load() -> Held? {
        guard let data = readKey() else { return nil }
        let kind = UserDefaults.standard.string(forKey: kindKey)
        if kind == "software" {
            guard let key = try? P256.Signing.PrivateKey(dataRepresentation: data) else { return nil }
            return .software(key)
        }
        if let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data) {
            return .enclave(key)
        }
        return nil
    }

    private static func describe(_ held: Held, source: String) -> Material {
        let point = held.publicKey.x963Representation
        return Material(
            publicUncompressedB64: point.base64EncodedString(),
            keyIdSha256: CaptureRecord.sha256Hex(point),
            securityLevel: held.level,
            challengeSource: source
        )
    }

    private static func store(_ data: Data, kind: String) throws {
        deleteKey()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw CaptureRecord.ContractError("keychain rejected the signing key (\(status))")
        }
        UserDefaults.standard.set(kind, forKey: kindKey)
    }

    private static func readKey() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }

    private static func deleteKey() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
