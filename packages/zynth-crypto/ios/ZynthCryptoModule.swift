import CommonCrypto
import CryptoKit
import Foundation
import Security
import ZynthKit

@objc(ZynthCryptoModule)
final class ZynthCryptoModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthCrypto"

  var exportedMethods: [String] {
    [
      "getRandomBase64",
      "randomUUID",
      "digestBase64",
      "hmacBase64",
      "hkdfDeriveBitsBase64",
      "pbkdf2DeriveBitsBase64",
      "aesGcmEncryptBase64",
      "aesGcmDecryptBase64",
    ]
  }

  var protectedMethods: [String] {
    exportedMethods
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  private func handle(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getRandomBase64":
      let size = Int(try args.number("size"))
      return ["result": try randomBytesBase64(size: size)]
    case "randomUUID":
      return ["result": UUID().uuidString.lowercased()]
    case "digestBase64":
      let algorithm = try args.string("algorithm")
      let dataBase64 = try args.string("dataBase64")
      return ["result": try digestBase64(algorithm: algorithm, dataBase64: dataBase64)]
    case "hmacBase64":
      let algorithm = try args.string("algorithm")
      let keyBase64 = try args.string("keyBase64")
      let dataBase64 = try args.string("dataBase64")
      return ["result": try hmacBase64(algorithm: algorithm, keyBase64: keyBase64, dataBase64: dataBase64)]
    case "hkdfDeriveBitsBase64":
      let algorithm = try args.string("algorithm")
      let keyBase64 = try args.string("keyBase64")
      let saltBase64 = try args.string("saltBase64")
      let infoBase64 = try args.string("infoBase64")
      let lengthBytes = Int(try args.number("lengthBytes"))
      return [
        "result": try hkdfDeriveBitsBase64(
          algorithm: algorithm,
          keyBase64: keyBase64,
          saltBase64: saltBase64,
          infoBase64: infoBase64,
          lengthBytes: lengthBytes
        )
      ]
    case "pbkdf2DeriveBitsBase64":
      let algorithm = try args.string("algorithm")
      let keyBase64 = try args.string("keyBase64")
      let saltBase64 = try args.string("saltBase64")
      let iterations = Int(try args.number("iterations"))
      let lengthBytes = Int(try args.number("lengthBytes"))
      return [
        "result": try pbkdf2DeriveBitsBase64(
          algorithm: algorithm,
          keyBase64: keyBase64,
          saltBase64: saltBase64,
          iterations: iterations,
          lengthBytes: lengthBytes
        )
      ]
    case "aesGcmEncryptBase64":
      return ["result": try aesGcmBase64(args: args, encrypt: true)]
    case "aesGcmDecryptBase64":
      return ["result": try aesGcmBase64(args: args, encrypt: false)]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func randomBytesBase64(size: Int) throws -> String {
    guard size >= 0 else {
      throw moduleError(code: 1, message: "size must be >= 0")
    }
    guard size <= 65_536 else {
      throw moduleError(code: 2, message: "size exceeds 65536 bytes")
    }
    if size == 0 {
      return ""
    }

    var bytes = [UInt8](repeating: 0, count: size)
    let status = SecRandomCopyBytes(kSecRandomDefault, size, &bytes)
    guard status == errSecSuccess else {
      throw moduleError(code: Int(status), message: "secure random generation failed")
    }
    return Data(bytes).base64EncodedString()
  }

  private func digestBase64(algorithm: String, dataBase64: String) throws -> String {
    let data = try decodeBase64(dataBase64, code: 3, message: "Invalid base64 input")
    guard data.count <= 16 * 1024 * 1024 else {
      throw moduleError(code: 4, message: "digest input exceeds maximum size")
    }

    let normalized = normalizeDigestName(algorithm)
    let digest: Data
    switch normalized {
    case "SHA-1":
      digest = Data(Insecure.SHA1.hash(data: data))
    case "SHA-256":
      digest = Data(SHA256.hash(data: data))
    case "SHA-384":
      digest = Data(SHA384.hash(data: data))
    case "SHA-512":
      digest = Data(SHA512.hash(data: data))
    default:
      throw moduleError(code: 5, message: "Unsupported digest algorithm")
    }

    return digest.base64EncodedString()
  }

  private func hmacBase64(algorithm: String, keyBase64: String, dataBase64: String) throws -> String {
    let keyData = try decodeBase64(keyBase64, code: 10, message: "Invalid key base64")
    let data = try decodeBase64(dataBase64, code: 11, message: "Invalid data base64")
    let normalized = normalizeDigestName(algorithm)

    let key = SymmetricKey(data: keyData)
    let macData: Data

    switch normalized {
    case "SHA-1":
      macData = Data(HMAC<Insecure.SHA1>.authenticationCode(for: data, using: key))
    case "SHA-256":
      macData = Data(HMAC<SHA256>.authenticationCode(for: data, using: key))
    case "SHA-384":
      macData = Data(HMAC<SHA384>.authenticationCode(for: data, using: key))
    case "SHA-512":
      macData = Data(HMAC<SHA512>.authenticationCode(for: data, using: key))
    default:
      throw moduleError(code: 12, message: "Unsupported HMAC algorithm")
    }

    return macData.base64EncodedString()
  }

  private func hkdfDeriveBitsBase64(
    algorithm: String,
    keyBase64: String,
    saltBase64: String,
    infoBase64: String,
    lengthBytes: Int
  ) throws -> String {
    guard lengthBytes > 0 else {
      throw moduleError(code: 13, message: "lengthBytes must be > 0")
    }
    guard lengthBytes <= 8192 else {
      throw moduleError(code: 14, message: "lengthBytes exceeds 8192")
    }

    let keyData = try decodeBase64(keyBase64, code: 15, message: "Invalid key base64")
    let saltData = try decodeBase64(saltBase64, code: 16, message: "Invalid salt base64")
    let infoData = try decodeBase64(infoBase64, code: 17, message: "Invalid info base64")

    let normalized = normalizeDigestName(algorithm)
    let inputKey = SymmetricKey(data: keyData)

    let derived: SymmetricKey
    switch normalized {
    case "SHA-1":
      derived = HKDF<Insecure.SHA1>.deriveKey(
        inputKeyMaterial: inputKey,
        salt: saltData,
        info: infoData,
        outputByteCount: lengthBytes
      )
    case "SHA-256":
      derived = HKDF<SHA256>.deriveKey(
        inputKeyMaterial: inputKey,
        salt: saltData,
        info: infoData,
        outputByteCount: lengthBytes
      )
    case "SHA-384":
      derived = HKDF<SHA384>.deriveKey(
        inputKeyMaterial: inputKey,
        salt: saltData,
        info: infoData,
        outputByteCount: lengthBytes
      )
    case "SHA-512":
      derived = HKDF<SHA512>.deriveKey(
        inputKeyMaterial: inputKey,
        salt: saltData,
        info: infoData,
        outputByteCount: lengthBytes
      )
    default:
      throw moduleError(code: 18, message: "Unsupported HKDF algorithm")
    }

    let bytes = derived.withUnsafeBytes { Data($0) }
    return bytes.base64EncodedString()
  }

  private func pbkdf2DeriveBitsBase64(
    algorithm: String,
    keyBase64: String,
    saltBase64: String,
    iterations: Int,
    lengthBytes: Int
  ) throws -> String {
    guard iterations > 0 else {
      throw moduleError(code: 19, message: "iterations must be > 0")
    }
    guard lengthBytes > 0 else {
      throw moduleError(code: 20, message: "lengthBytes must be > 0")
    }
    guard lengthBytes <= 8192 else {
      throw moduleError(code: 21, message: "lengthBytes exceeds 8192")
    }

    let keyData = try decodeBase64(keyBase64, code: 22, message: "Invalid key base64")
    let saltData = try decodeBase64(saltBase64, code: 23, message: "Invalid salt base64")

    let normalized = normalizeDigestName(algorithm)
    let prf: CCPseudoRandomAlgorithm
    switch normalized {
    case "SHA-1":
      prf = CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1)
    case "SHA-256":
      prf = CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256)
    case "SHA-384":
      prf = CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA384)
    case "SHA-512":
      prf = CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA512)
    default:
      throw moduleError(code: 24, message: "Unsupported PBKDF2 algorithm")
    }

    var output = [UInt8](repeating: 0, count: lengthBytes)
    let status = keyData.withUnsafeBytes { keyPtr in
      saltData.withUnsafeBytes { saltPtr in
        CCKeyDerivationPBKDF(
          CCPBKDFAlgorithm(kCCPBKDF2),
          keyPtr.bindMemory(to: Int8.self).baseAddress,
          keyData.count,
          saltPtr.bindMemory(to: UInt8.self).baseAddress,
          saltData.count,
          prf,
          UInt32(iterations),
          &output,
          lengthBytes
        )
      }
    }

    guard status == kCCSuccess else {
      throw moduleError(code: 25, message: "PBKDF2 derivation failed")
    }

    return Data(output).base64EncodedString()
  }

  private func aesGcmBase64(args: ZynthArgs, encrypt: Bool) throws -> String {
    let keyData = try decodeBase64(args.string("keyBase64"), code: 26, message: "Invalid key base64")
    let ivData = try decodeBase64(args.string("ivBase64"), code: 27, message: "Invalid iv base64")
    let additionalData = try decodeBase64(
      args.string("additionalDataBase64", default: ""),
      code: 28,
      message: "Invalid additionalData base64"
    )
    let data = try decodeBase64(args.string("dataBase64"), code: 29, message: "Invalid data base64")
    let tagLengthBits = Int(try args.number("tagLengthBits"))

    guard tagLengthBits == 128 else {
      throw moduleError(code: 30, message: "AES-GCM supports tagLength 128 bits only")
    }
    guard ivData.count >= 12 && ivData.count <= 16 else {
      throw moduleError(code: 31, message: "AES-GCM iv length must be between 12 and 16 bytes")
    }

    let keyBitLength = keyData.count * 8
    guard keyBitLength == 128 || keyBitLength == 192 || keyBitLength == 256 else {
      throw moduleError(code: 32, message: "AES-GCM key length must be 128, 192, or 256 bits")
    }

    let key = SymmetricKey(data: keyData)
    let nonce = try AES.GCM.Nonce(data: ivData)

    if encrypt {
      let sealed = try AES.GCM.seal(data, using: key, nonce: nonce, authenticating: additionalData)
      guard let combined = sealed.combined else {
        throw moduleError(code: 33, message: "AES-GCM encryption failed")
      }
      return combined.base64EncodedString()
    }

    let box = try AES.GCM.SealedBox(combined: data)
    let decrypted = try AES.GCM.open(box, using: key, authenticating: additionalData)
    return decrypted.base64EncodedString()
  }

  private func decodeBase64(_ value: String, code: Int, message: String) throws -> Data {
    if value.isEmpty {
      return Data()
    }
    guard let decoded = Data(base64Encoded: value) else {
      throw moduleError(code: code, message: message)
    }
    return decoded
  }

  private func normalizeDigestName(_ algorithm: String) -> String {
    algorithm.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
  }

  private func moduleError(code: Int, message: String) -> NSError {
    NSError(domain: "ZynthCrypto", code: code, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
