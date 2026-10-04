// ShieldAttest — bind Play Integrity token to SHA-256 of the still.
// requestHash = first 500 bytes of (photoSha256 + "|" + jobId) as documented by IntegrityTokenRequest.
// Web never issues this token.

// val nonce = sha256Hex + "|" + jobId
// val request = IntegrityTokenRequest.builder().setNonce(nonce).build()
// val token = integrityManager.requestIntegrityToken(request)
