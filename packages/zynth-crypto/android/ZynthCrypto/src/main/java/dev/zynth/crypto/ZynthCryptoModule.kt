package dev.zynth.crypto

import android.util.Base64
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.ceil

class ZynthCryptoModule : ZynthModule, ZynthSyncModule {
  override val name: String = "ZynthCrypto"

  override val exportedMethods: List<String> = listOf(
    "getRandomBase64",
    "randomUUID",
    "digestBase64",
    "hmacBase64",
    "hkdfDeriveBitsBase64",
    "pbkdf2DeriveBitsBase64",
    "aesGcmEncryptBase64",
    "aesGcmDecryptBase64",
  )

  override val protectedMethods: List<String> = exportedMethods

  private val secureRandom = SecureRandom()

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return resultResponse(callSync(method, args))
  }

  override fun callSync(method: String, args: ZynthArgs): Any? {
    return when (method) {
      "getRandomBase64" -> randomBytesBase64(args.getInt("size"))
      "randomUUID" -> UUID.randomUUID().toString()
      "digestBase64" -> digestBase64(args.getString("algorithm"), args.getString("dataBase64"))
      "hmacBase64" -> hmacBase64(
        args.getString("algorithm"),
        args.getString("keyBase64"),
        args.getString("dataBase64")
      )
      "hkdfDeriveBitsBase64" -> hkdfDeriveBitsBase64(
        args.getString("algorithm"),
        args.getString("keyBase64"),
        args.getString("saltBase64"),
        args.getString("infoBase64"),
        args.getInt("lengthBytes")
      )
      "pbkdf2DeriveBitsBase64" -> pbkdf2DeriveBitsBase64(
        args.getString("algorithm"),
        args.getString("keyBase64"),
        args.getString("saltBase64"),
        args.getInt("iterations"),
        args.getInt("lengthBytes")
      )
      "aesGcmEncryptBase64" -> aesGcmBase64(args, encrypt = true)
      "aesGcmDecryptBase64" -> aesGcmBase64(args, encrypt = false)
      else -> throw IllegalArgumentException("Unsupported method: $method")
    }
  }

  private fun randomBytesBase64(size: Int): String {
    require(size >= 0) { "size must be >= 0" }
    require(size <= 65_536) { "size exceeds 65536 bytes" }
    if (size == 0) {
      return ""
    }

    val bytes = ByteArray(size)
    secureRandom.nextBytes(bytes)
    return toBase64(bytes)
  }

  private fun digestBase64(algorithm: String, dataBase64: String): String {
    val input = fromBase64(dataBase64)
    require(input.size <= 16 * 1024 * 1024) { "digest input exceeds maximum size" }

    val digestAlgorithm = normalizeDigestAlgorithm(algorithm)
    val digest = MessageDigest.getInstance(digestAlgorithm).digest(input)
    return toBase64(digest)
  }

  private fun hmacBase64(algorithm: String, keyBase64: String, dataBase64: String): String {
    val key = fromBase64(keyBase64)
    val data = fromBase64(dataBase64)
    val mac = Mac.getInstance(toHmacAlgorithm(algorithm))
    mac.init(SecretKeySpec(key, "RAW"))
    return toBase64(mac.doFinal(data))
  }

  private fun hkdfDeriveBitsBase64(
    algorithm: String,
    keyBase64: String,
    saltBase64: String,
    infoBase64: String,
    lengthBytes: Int
  ): String {
    require(lengthBytes > 0) { "lengthBytes must be > 0" }
    require(lengthBytes <= 8192) { "lengthBytes exceeds 8192" }

    val ikm = fromBase64(keyBase64)
    val salt = fromBase64(saltBase64)
    val info = fromBase64(infoBase64)

    val hmacAlgo = toHmacAlgorithm(algorithm)
    val hashLength = digestLength(normalizeDigestAlgorithm(algorithm))
    val prk = hmac(hmacAlgo, if (salt.isNotEmpty()) salt else ByteArray(hashLength), ikm)

    val blocks = ceil(lengthBytes.toDouble() / hashLength.toDouble()).toInt()
    require(blocks <= 255) { "requested HKDF output too large" }

    var previous = ByteArray(0)
    val output = ByteArray(lengthBytes)
    var offset = 0

    for (index in 1..blocks) {
      val context = ByteArray(previous.size + info.size + 1)
      System.arraycopy(previous, 0, context, 0, previous.size)
      System.arraycopy(info, 0, context, previous.size, info.size)
      context[context.lastIndex] = index.toByte()

      previous = hmac(hmacAlgo, prk, context)
      val copyLength = minOf(previous.size, lengthBytes - offset)
      System.arraycopy(previous, 0, output, offset, copyLength)
      offset += copyLength
    }

    return toBase64(output)
  }

  private fun pbkdf2DeriveBitsBase64(
    algorithm: String,
    keyBase64: String,
    saltBase64: String,
    iterations: Int,
    lengthBytes: Int
  ): String {
    require(iterations > 0) { "iterations must be > 0" }
    require(lengthBytes > 0) { "lengthBytes must be > 0" }
    require(lengthBytes <= 8192) { "lengthBytes exceeds 8192" }

    val password = fromBase64(keyBase64)
    val salt = fromBase64(saltBase64)
    val hmacAlgo = toHmacAlgorithm(algorithm)
    val hashLen = digestLength(normalizeDigestAlgorithm(algorithm))

    val blocks = ceil(lengthBytes.toDouble() / hashLen.toDouble()).toInt()
    val output = ByteArray(lengthBytes)
    var outputOffset = 0

    for (block in 1..blocks) {
      val saltBlock = ByteArray(salt.size + 4)
      System.arraycopy(salt, 0, saltBlock, 0, salt.size)
      saltBlock[salt.size] = ((block ushr 24) and 0xff).toByte()
      saltBlock[salt.size + 1] = ((block ushr 16) and 0xff).toByte()
      saltBlock[salt.size + 2] = ((block ushr 8) and 0xff).toByte()
      saltBlock[salt.size + 3] = (block and 0xff).toByte()

      var u = hmac(hmacAlgo, password, saltBlock)
      val t = u.copyOf()

      for (round in 2..iterations) {
        u = hmac(hmacAlgo, password, u)
        for (index in t.indices) {
          t[index] = (t[index].toInt() xor u[index].toInt()).toByte()
        }
      }

      val copyLength = minOf(t.size, lengthBytes - outputOffset)
      System.arraycopy(t, 0, output, outputOffset, copyLength)
      outputOffset += copyLength
    }

    return toBase64(output)
  }

  private fun aesGcmBase64(args: ZynthArgs, encrypt: Boolean): String {
    val key = fromBase64(args.getString("keyBase64"))
    val iv = fromBase64(args.getString("ivBase64"))
    val additionalData = fromBase64(args.getString("additionalDataBase64", ""))
    val data = fromBase64(args.getString("dataBase64"))
    val tagLengthBits = args.getInt("tagLengthBits")

    require(tagLengthBits == 128) { "AES-GCM supports tagLength 128 bits only" }
    require(iv.size in 12..16) { "AES-GCM iv length must be between 12 and 16 bytes" }

    val keyBits = key.size * 8
    require(keyBits == 128 || keyBits == 192 || keyBits == 256) {
      "AES-GCM key length must be 128, 192, or 256 bits"
    }

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val keySpec = SecretKeySpec(key, "AES")
    val gcmSpec = GCMParameterSpec(tagLengthBits, iv)

    if (encrypt) {
      cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
    } else {
      cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
    }

    if (additionalData.isNotEmpty()) {
      cipher.updateAAD(additionalData)
    }

    val output = cipher.doFinal(data)
    return toBase64(output)
  }

  private fun normalizeDigestAlgorithm(algorithm: String): String {
    return when (algorithm.trim().uppercase(Locale.ROOT)) {
      "SHA-1" -> "SHA-1"
      "SHA-256" -> "SHA-256"
      "SHA-384" -> "SHA-384"
      "SHA-512" -> "SHA-512"
      else -> throw IllegalArgumentException("Unsupported digest algorithm")
    }
  }

  private fun digestLength(algorithm: String): Int {
    return when (algorithm) {
      "SHA-1" -> 20
      "SHA-256" -> 32
      "SHA-384" -> 48
      "SHA-512" -> 64
      else -> throw IllegalArgumentException("Unsupported digest algorithm")
    }
  }

  private fun toHmacAlgorithm(algorithm: String): String {
    return when (normalizeDigestAlgorithm(algorithm)) {
      "SHA-1" -> "HmacSHA1"
      "SHA-256" -> "HmacSHA256"
      "SHA-384" -> "HmacSHA384"
      "SHA-512" -> "HmacSHA512"
      else -> throw IllegalArgumentException("Unsupported HMAC algorithm")
    }
  }

  private fun hmac(algorithm: String, key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance(algorithm)
    mac.init(SecretKeySpec(key, "RAW"))
    return mac.doFinal(data)
  }

  private fun toBase64(data: ByteArray): String {
    return Base64.encodeToString(data, Base64.NO_WRAP)
  }

  private fun fromBase64(data: String): ByteArray {
    if (data.isEmpty()) {
      return ByteArray(0)
    }
    return try {
      Base64.decode(data, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("Invalid base64 input")
    }
  }

  private fun resultResponse(result: Any?): JSONObject {
    return JSONObject().apply {
      put("result", result ?: JSONObject.NULL)
    }
  }
}
