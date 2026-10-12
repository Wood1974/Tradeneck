package app.tradedeck.shield.securecapture

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import android.util.Base64
import java.security.spec.ECGenParameterSpec

/**
 * EC P-256 key that stays inside Android Keystore. StrongBox when the device
 * has it, otherwise the TEE. The level actually reported by KeyInfo is what
 * the record stores. The private key is never exported.
 *
 * TODO(play-integrity): at enrollment and at sync, request a Play Integrity
 * standard token whose requestHash is the enrollment or batch hash. Do not
 * call the Integrity API from the offline seal path. This class does not.
 */
class KeystoreSigner(context: Context) {
    data class Material(
        val publicUncompressedB64: String,
        val keyIdSha256: String,
        val securityLevel: String,
        val attestationChainB64: String?,
        val challengeSource: String,
    )

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun current(): Material? {
        val ks = store()
        if (!ks.containsAlias(ALIAS)) return null
        return describe(prefs.getString(SOURCE, "local") ?: "local")
    }

    fun ensure(serverChallenge: ByteArray?): Material {
        val ks = store()
        if (ks.containsAlias(ALIAS)) return describe(prefs.getString(SOURCE, "local") ?: "local")
        val challenge = serverChallenge ?: java.security.SecureRandom().let { rng ->
            ByteArray(32).also { rng.nextBytes(it) }
        }
        val source = if (serverChallenge != null) "server" else "local"
        generate(challenge)
        prefs.edit().putString(SOURCE, source).apply()
        return describe(source)
    }

    fun sign(message: ByteArray): ByteArray {
        val key = store().getKey(ALIAS, null) as PrivateKey
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(key)
        signature.update(message)
        return signature.sign()
    }

    fun verify(message: ByteArray, der: ByteArray): Boolean {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initVerify(store().getCertificate(ALIAS).publicKey)
        signature.update(message)
        return signature.verify(der)
    }

    fun reset() {
        val ks = store()
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
        prefs.edit().remove(SOURCE).apply()
    }

    private fun generate(challenge: ByteArray) {
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                generateOnce(challenge, strongBox = true)
                return
            } catch (_: Exception) {
                val ks = store()
                if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
            }
        }
        generateOnce(challenge, strongBox = false)
    }

    private fun generateOnce(challenge: ByteArray, strongBox: Boolean) {
        val builder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .setUserAuthenticationRequired(false)
        if (strongBox && Build.VERSION.SDK_INT >= 28) builder.setIsStrongBoxBacked(true)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(builder.build())
        generator.generateKeyPair()
    }

    private fun describe(source: String): Material {
        val ks = store()
        val cert = ks.getCertificate(ALIAS)
        val publicKey = cert.publicKey as ECPublicKey
        val point = uncompressed(publicKey)
        val chain = ks.getCertificateChain(ALIAS)
            ?.joinToString(",") { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }
        return Material(
            publicUncompressedB64 = Base64.encodeToString(point, Base64.NO_WRAP),
            keyIdSha256 = CaptureRecord.sha256(point),
            securityLevel = securityLevel(),
            attestationChainB64 = chain,
            challengeSource = source,
        )
    }

    @Suppress("DEPRECATION")
    private fun securityLevel(): String {
        val privateKey = store().getKey(ALIAS, null) as PrivateKey
        val factory = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore")
        val info = factory.getKeySpec(privateKey, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) {
            return when (info.securityLevel) {
                KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
                KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TEE"
                KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
                else -> if (info.isInsideSecureHardware) "TEE" else "software"
            }
        }
        @Suppress("DEPRECATION")
        return if (info.isInsideSecureHardware) "TEE" else "software"
    }

    private fun uncompressed(key: ECPublicKey): ByteArray {
        val out = ByteArray(65)
        out[0] = 0x04
        val x = fixed32(key.w.affineX.toByteArray())
        val y = fixed32(key.w.affineY.toByteArray())
        System.arraycopy(x, 0, out, 1, 32)
        System.arraycopy(y, 0, out, 33, 32)
        return out
    }

    private fun fixed32(raw: ByteArray): ByteArray {
        val out = ByteArray(32)
        val src = if (raw.size > 32) raw.copyOfRange(raw.size - 32, raw.size) else raw
        System.arraycopy(src, 0, out, 32 - src.size, src.size)
        return out
    }

    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    companion object {
        private const val ALIAS = "shield.securecapture.p256"
        private const val PREFS = "shield.securecapture"
        private const val SOURCE = "challenge_source"
    }
}
