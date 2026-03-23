import CryptoKit
import Foundation
import Security

final class NetworkIdentityHost {
  private static let keyTag = "dev.zynth.network.identity.v1"
  private static let keyAlgorithm = "ECDSA_P256_SHA256"
  private static let minChallengeBytes = 16
  private static let maxChallengeBytes = 4096

  func getLocalIdentity() throws -> [String: Any] {
    let privateKey = try ensurePrivateKey()
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw NSError(
        domain: "Network",
        code: 1001,
        userInfo: [NSLocalizedDescriptionKey: "Failed to read local public key"]
      )
    }

    var publicError: Unmanaged<CFError>?
    guard let publicData = SecKeyCopyExternalRepresentation(publicKey, &publicError) as Data? else {
      throw (publicError?.takeRetainedValue() as Error?) ?? NSError(
        domain: "Network",
        code: 1002,
        userInfo: [NSLocalizedDescriptionKey: "Failed to export local public key"]
      )
    }

    return [
      "algorithm": Self.keyAlgorithm,
      "keyId": Self.keyTag,
      "publicKeyBase64": publicData.base64EncodedString(),
      "fingerprintSha256": sha256Hex(publicData),
    ]
  }

  func signChallenge(challengeBase64: String) throws -> [String: Any] {
    let challenge = try decodeChallenge(challengeBase64)
    let privateKey = try ensurePrivateKey()

    var signError: Unmanaged<CFError>?
    guard
      let signatureData = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureMessageX962SHA256,
        challenge as CFData,
        &signError
      ) as Data?
    else {
      throw (signError?.takeRetainedValue() as Error?) ?? NSError(
        domain: "Network",
        code: 1003,
        userInfo: [NSLocalizedDescriptionKey: "Failed to sign challenge"]
      )
    }

    var payload = try getLocalIdentity()
    payload["challengeBase64"] = challenge.base64EncodedString()
    payload["signatureBase64"] = signatureData.base64EncodedString()
    payload["signedAt"] = Int64(Date().timeIntervalSince1970 * 1000.0)
    return payload
  }

  func verifyChallenge(
    publicKeyBase64: String,
    challengeBase64: String,
    signatureBase64: String
  ) throws -> Bool {
    let challenge = try decodeChallenge(challengeBase64)
    let signature = try decodeBase64(signatureBase64, field: "signatureBase64")
    let publicKey = try decodePublicKey(publicKeyBase64)

    var verifyError: Unmanaged<CFError>?
    let verified = SecKeyVerifySignature(
      publicKey,
      .ecdsaSignatureMessageX962SHA256,
      challenge as CFData,
      signature as CFData,
      &verifyError
    )
    if let error = verifyError?.takeRetainedValue() {
      throw error as Error
    }
    return verified
  }

  private func decodePublicKey(_ value: String) throws -> SecKey {
    let keyData = try decodeBase64(value, field: "publicKeyBase64")
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
      kSecAttrKeySizeInBits as String: 256,
    ]

    var keyError: Unmanaged<CFError>?
    guard let key = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, &keyError) else {
      throw (keyError?.takeRetainedValue() as Error?) ?? NSError(
        domain: "Network",
        code: 1004,
        userInfo: [NSLocalizedDescriptionKey: "Invalid publicKeyBase64"]
      )
    }

    return key
  }

  private func decodeChallenge(_ value: String) throws -> Data {
    let challenge = try decodeBase64(value, field: "challengeBase64")
    if challenge.count < Self.minChallengeBytes {
      throw NSError(
        domain: "Network",
        code: 1005,
        userInfo: [NSLocalizedDescriptionKey: "challengeBase64 must decode to at least 16 bytes"]
      )
    }
    if challenge.count > Self.maxChallengeBytes {
      throw NSError(
        domain: "Network",
        code: 1006,
        userInfo: [NSLocalizedDescriptionKey: "challengeBase64 must decode to at most 4096 bytes"]
      )
    }
    return challenge
  }

  private func decodeBase64(_ value: String, field: String) throws -> Data {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      throw NSError(
        domain: "Network",
        code: 1007,
        userInfo: [NSLocalizedDescriptionKey: "\(field) is required"]
      )
    }
    guard let decoded = Data(base64Encoded: trimmed) else {
      throw NSError(
        domain: "Network",
        code: 1008,
        userInfo: [NSLocalizedDescriptionKey: "\(field) must be valid base64"]
      )
    }
    return decoded
  }

  private func ensurePrivateKey() throws -> SecKey {
    let tagData = Self.keyTag.data(using: .utf8) ?? Data()
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tagData,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let keyRef = item {
      guard CFGetTypeID(keyRef) == SecKeyGetTypeID() else {
        throw NSError(
          domain: "Network",
          code: 1010,
          userInfo: [NSLocalizedDescriptionKey: "Keychain returned unexpected key type"]
        )
      }
      return unsafeBitCast(keyRef, to: SecKey.self)
    }

    if status != errSecItemNotFound {
      throw NSError(
        domain: "Network",
        code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Failed to load identity key from Keychain"]
      )
    }

    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tagData,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      ],
    ]

    var generateError: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &generateError) else {
      throw (generateError?.takeRetainedValue() as Error?) ?? NSError(
        domain: "Network",
        code: 1009,
        userInfo: [NSLocalizedDescriptionKey: "Failed to generate identity key"]
      )
    }

    return key
  }

  private func sha256Hex(_ data: Data) -> String {
    let digest = SHA256.hash(data: data)
    let digestBytes = Array(digest)
    var output = ""
    output.reserveCapacity(digestBytes.count * 2)
    for byte in digestBytes {
      output.append(String(format: "%02x", byte))
    }
    return output
  }
}
