//
//  ZynthSecureStoreModule.swift
//  ZynthSecureStore
//
//  Native SecureStore implementation backed by Keychain
//

import Foundation
import LocalAuthentication
import Security
import ZynthKit

@objc(ZynthSecureStoreModule)
final class ZynthSecureStoreModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthSecureStore"

  var exportedMethods: [String] {
    return ["getItem", "setItem", "deleteItem", "isAvailable", "canUseBiometricAuthentication"]
  }

  var protectedMethods: [String] {
    return ["getItem", "setItem", "deleteItem"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  private func handle(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getItem":
      let key = try args.string("key")
      let options = parseOptions(args)
      let value = try getItem(forKey: key, options: options)
      return value ?? NSNull()
    case "setItem":
      let key = try args.string("key")
      let value = try args.string("value")
      let options = parseOptions(args)
      try setItem(value, forKey: key, options: options)
      return ["result": NSNull()]
    case "deleteItem":
      let key = try args.string("key")
      let options = parseOptions(args)
      try deleteItem(forKey: key, options: options)
      return ["result": NSNull()]
    case "isAvailable":
      return true
    case "canUseBiometricAuthentication":
      return canUseBiometricAuthentication()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func parseOptions(_ args: ZynthArgs) -> SecureStoreOptions {
    guard let optionsValue = try? args.dict("options") else {
      return SecureStoreOptions()
    }
    return SecureStoreOptions(from: optionsValue)
  }

  private func baseQuery(forKey key: String, options: SecureStoreOptions) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key,
      kSecAttrService as String: options.service,
    ]
    if let accessGroup = options.accessGroup {
      query[kSecAttrAccessGroup as String] = accessGroup
    }
    return query
  }

  private func setItem(_ value: String, forKey key: String, options: SecureStoreOptions) throws {
    var query = baseQuery(forKey: key, options: options)
    let data = value.data(using: .utf8) ?? Data()

    let attributes: [String: Any]
    if options.requireAuthentication {
      guard let accessControl = options.makeAccessControl() else {
        throw SecureStoreError.invalidAccessControl
      }
      attributes = [
        kSecValueData as String: data,
        kSecAttrAccessControl as String: accessControl,
      ]
    } else {
      attributes = [
        kSecValueData as String: data,
        kSecAttrAccessible as String: options.accessibleValue,
      ]
    }

    if options.requireAuthentication, let prompt = options.authenticationPrompt {
      query[kSecUseOperationPrompt as String] = prompt
    }

    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecSuccess {
      return
    }

    if updateStatus == errSecItemNotFound {
      query.merge(attributes) { _, new in new }
      let addStatus = SecItemAdd(query as CFDictionary, nil)
      if addStatus != errSecSuccess {
        throw SecureStoreError.fromStatus(addStatus)
      }
      return
    }

    throw SecureStoreError.fromStatus(updateStatus)
  }

  private func getItem(forKey key: String, options: SecureStoreOptions) throws -> String? {
    var query = baseQuery(forKey: key, options: options)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    if options.requireAuthentication, let prompt = options.authenticationPrompt {
      query[kSecUseOperationPrompt as String] = prompt
    }

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      return nil
    }
    if status != errSecSuccess {
      throw SecureStoreError.fromStatus(status)
    }
    guard let data = item as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private func deleteItem(forKey key: String, options: SecureStoreOptions) throws {
    let query = baseQuery(forKey: key, options: options)
    let status = SecItemDelete(query as CFDictionary)
    if status == errSecItemNotFound {
      return
    }
    if status != errSecSuccess {
      throw SecureStoreError.fromStatus(status)
    }
  }

  private func canUseBiometricAuthentication() -> Bool {
    let context = LAContext()
    var error: NSError?
    let canEvaluate = context.canEvaluatePolicy(
      .deviceOwnerAuthenticationWithBiometrics,
      error: &error
    )
    return canEvaluate
  }
}

private struct SecureStoreOptions {
  var accessGroup: String?
  var authenticationPrompt: String?
  var keychainAccessible: Int
  var keychainService: String?
  var requireAuthentication: Bool

  init() {
    accessGroup = nil
    authenticationPrompt = nil
    keychainAccessible = KeychainAccessibility.whenUnlocked.rawValue
    keychainService = nil
    requireAuthentication = false
  }

  init(from dict: [String: Any]) {
    accessGroup = dict["accessGroup"] as? String
    authenticationPrompt = dict["authenticationPrompt"] as? String
    keychainAccessible = dict["keychainAccessible"] as? Int ?? KeychainAccessibility.whenUnlocked.rawValue
    keychainService = dict["keychainService"] as? String
    requireAuthentication = dict["requireAuthentication"] as? Bool ?? false
    if requireAuthentication && (authenticationPrompt == nil || authenticationPrompt?.isEmpty == true) {
      authenticationPrompt = "Authenticate to access secure data."
    }
  }

  var service: String {
    if let custom = keychainService, !custom.isEmpty {
      return custom
    }
    return Bundle.main.bundleIdentifier ?? "dev.zynth.securestore"
  }

  var accessibleValue: CFString {
    return KeychainAccessibility(rawValue: keychainAccessible)?.cfValue
      ?? KeychainAccessibility.whenUnlocked.cfValue
  }

  func makeAccessControl() -> SecAccessControl? {
    var error: Unmanaged<CFError>?
    let flags: SecAccessControlCreateFlags = .biometryCurrentSet
    return SecAccessControlCreateWithFlags(nil, accessibleValue, flags, &error)
  }
}

private enum KeychainAccessibility: Int {
  case whenUnlocked = 0
  case afterFirstUnlock = 1
  case always = 2
  case whenPasscodeSetThisDeviceOnly = 3
  case whenUnlockedThisDeviceOnly = 4
  case afterFirstUnlockThisDeviceOnly = 5
  case alwaysThisDeviceOnly = 6

  var cfValue: CFString {
    switch self {
    case .whenUnlocked:
      return kSecAttrAccessibleWhenUnlocked
    case .afterFirstUnlock:
      return kSecAttrAccessibleAfterFirstUnlock
    case .always:
      return kSecAttrAccessibleAlways
    case .whenPasscodeSetThisDeviceOnly:
      return kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    case .whenUnlockedThisDeviceOnly:
      return kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    case .afterFirstUnlockThisDeviceOnly:
      return kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    case .alwaysThisDeviceOnly:
      return kSecAttrAccessibleAlwaysThisDeviceOnly
    }
  }
}

private enum SecureStoreError: LocalizedError {
  case status(OSStatus)
  case invalidAccessControl

  static func fromStatus(_ status: OSStatus) -> SecureStoreError {
    return .status(status)
  }

  var errorDescription: String? {
    switch self {
    case .status(let status):
      if let msg = SecCopyErrorMessageString(status, nil) as String? {
        return msg
      }
      return "Keychain error: \(status)"
    case .invalidAccessControl:
      return "Unable to create access control"
    }
  }
}
