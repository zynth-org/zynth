package dev.zynth.network

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.X509EncodedKeySpec

class NetworkIdentityManager {
    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "zynth.network.identity.v1"
        private const val IDENTITY_ALGORITHM = "ECDSA_P256_SHA256"
        private const val MIN_CHALLENGE_BYTES = 16
        private const val MAX_CHALLENGE_BYTES = 4096
    }

    fun getLocalIdentity(): JSONObject {
        val keyPair = ensureIdentityKeyPair()
        val publicKeyBytes = encodePublicKeyX963(keyPair.public)
        return JSONObject()
            .put("algorithm", IDENTITY_ALGORITHM)
            .put("keyId", KEY_ALIAS)
            .put("publicKeyBase64", Base64.encodeToString(publicKeyBytes, Base64.NO_WRAP))
            .put("fingerprintSha256", sha256Hex(publicKeyBytes))
    }

    fun signChallenge(challengeBase64: String): JSONObject {
        val challenge = decodeChallenge(challengeBase64)
        val keyPair = ensureIdentityKeyPair()
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(keyPair.private)
            update(challenge)
            sign()
        }
        val identity = getLocalIdentity()
        return JSONObject(identity.toString())
            .put("challengeBase64", Base64.encodeToString(challenge, Base64.NO_WRAP))
            .put("signatureBase64", Base64.encodeToString(signature, Base64.NO_WRAP))
            .put("signedAt", System.currentTimeMillis())
    }

    fun verifyChallenge(
        publicKeyBase64: String,
        challengeBase64: String,
        signatureBase64: String,
    ): Boolean {
        val challenge = decodeChallenge(challengeBase64)
        val signatureBytes = decodeBase64(signatureBase64, "signatureBase64")
        val publicKey = decodePublicKey(publicKeyBase64)

        return Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(challenge)
            verify(signatureBytes)
        }
    }

    private fun decodePublicKey(publicKeyBase64: String): PublicKey {
        val encoded = decodeBase64(publicKeyBase64, "publicKeyBase64")
        if (isX963(encoded)) {
            return decodePublicKeyX963(encoded)
        }
        val keySpec = X509EncodedKeySpec(encoded)
        return KeyFactory.getInstance("EC").generatePublic(keySpec)
    }

    private fun decodePublicKeyX963(raw: ByteArray): PublicKey {
        if (raw.size != 65 || raw[0] != 0x04.toByte()) {
            throw IllegalArgumentException("publicKeyBase64 is not a valid P-256 X9.63 key")
        }
        val x = BigInteger(1, raw.copyOfRange(1, 33))
        val y = BigInteger(1, raw.copyOfRange(33, 65))
        val spec = ECPublicKeySpec(ECPoint(x, y), p256Params())
        return KeyFactory.getInstance("EC").generatePublic(spec)
    }

    private fun decodeChallenge(challengeBase64: String): ByteArray {
        val challenge = decodeBase64(challengeBase64, "challengeBase64")
        if (challenge.size < MIN_CHALLENGE_BYTES) {
            throw IllegalArgumentException("challengeBase64 must decode to at least 16 bytes")
        }
        if (challenge.size > MAX_CHALLENGE_BYTES) {
            throw IllegalArgumentException("challengeBase64 must decode to at most 4096 bytes")
        }
        return challenge
    }

    private fun decodeBase64(value: String, field: String): ByteArray {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
            throw IllegalArgumentException("$field is required")
        }
        return try {
            Base64.decode(trimmed, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            throw IllegalArgumentException("$field must be valid base64")
        }
    }

    private fun ensureIdentityKeyPair(): KeyPair {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey
        if (privateKey != null && publicKey != null) {
            return KeyPair(publicKey, privateKey)
        }

        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            KEYSTORE_PROVIDER,
        )

        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build()

        generator.initialize(spec)
        return generator.generateKeyPair()
    }

    private fun encodePublicKeyX963(publicKey: PublicKey): ByteArray {
        val ecPublic = publicKey as? ECPublicKey
            ?: throw IllegalStateException("Identity key is not an EC key")
        val x = toFixed32(ecPublic.w.affineX)
        val y = toFixed32(ecPublic.w.affineY)
        return ByteArray(65).also { output ->
            output[0] = 0x04
            System.arraycopy(x, 0, output, 1, 32)
            System.arraycopy(y, 0, output, 33, 32)
        }
    }

    private fun toFixed32(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        if (bytes.size == 32) {
            return bytes
        }
        if (bytes.size == 33 && bytes[0] == 0.toByte()) {
            return bytes.copyOfRange(1, 33)
        }
        if (bytes.size < 32) {
            return ByteArray(32 - bytes.size) + bytes
        }
        throw IllegalArgumentException("EC coordinate does not fit 32 bytes")
    }

    private fun isX963(value: ByteArray): Boolean {
        return value.size == 65 && value[0] == 0x04.toByte()
    }

    private fun p256Params(): ECParameterSpec {
        val parameters = AlgorithmParameters.getInstance("EC")
        parameters.init(ECGenParameterSpec("secp256r1"))
        return parameters.getParameterSpec(ECParameterSpec::class.java)
    }

    private fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        val builder = StringBuilder(digest.size * 2)
        for (byte in digest) {
            val value = byte.toInt() and 0xff
            if (value < 16) {
                builder.append('0')
            }
            builder.append(value.toString(16))
        }
        return builder.toString()
    }
}
