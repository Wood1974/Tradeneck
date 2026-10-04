// ShieldAttest — bind App Attest assertion to SHA-256 of the still.
// Wire through a Capacitor plugin named ShieldAttest.assert(hash).
//
// 1. DCAppAttestService.shared.generateKey()
// 2. attestKey(keyId, clientDataHash: sha256(challenge))
// 3. generateAssertion(keyId, clientDataHash: sha256(photoSha256 + jobId))
// 4. Return assertion + keyId. Server stores both. Web never issues this.

import DeviceCheck
import CryptoKit

enum ShieldAttest {
    static func assert(photoSha256Hex: String, jobId: String) async throws -> (keyId: String, assertion: Data) {
        let service = DCAppAttestService.shared
        guard service.isSupported else { throw DCError(.featureUnsupported) }
        let keyId = try await service.generateKey()
        let payload = Data((photoSha256Hex + "|" + jobId).utf8)
        let clientHash = Data(SHA256.hash(data: payload))
        let assertion = try await service.generateAssertion(keyId, clientDataHash: clientHash)
        return (keyId, assertion)
    }
}
