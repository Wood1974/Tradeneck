// NOT COMPILED. The live Android capture path is plugins/secure-capture (Keystore).
// Play Integrity is a TODO on that plugin (enrollment and sync only) and is not called here.
// ShieldAttest — bind Play Integrity token to SHA-256 of the still.
// requestHash = first 500 bytes of (photoSha256 + "|" + jobId) as documented by IntegrityTokenRequest.
// Web never issues this token.

// val nonce = sha256Hex + "|" + jobId
// val request = IntegrityTokenRequest.builder().setNonce(nonce).build()
// val token = integrityManager.requestIntegrityToken(request)
