//
//  RuneAsyncStorageModule.swift
//  RuneAsyncStorage
//
//  Native AsyncStorage implementation backed by UserDefaults
//

import Foundation
import RuneKit

@objc(RuneAsyncStorageModule)
final class RuneAsyncStorageModule: NSObject, RuneModule, RuneSyncModule {
  let name: String = "RuneAsyncStorage"
  private let storage = RuneAsyncStorageStore()

  func call(method: String, args: Any?) throws -> Any? {
    return handle(method: method, args: args)
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    return handle(method: method, args: args)
  }

  private func handle(method: String, args: Any?) -> Any? {
    switch method {
    case "getItem":
      guard let key = getStringArg(args, key: "key") else {
        return errorResponse("invalid_argument", "key")
      }
      return storage.getItem(key) ?? NSNull()
    case "setItem":
      guard let key = getStringArg(args, key: "key"),
            let value = getStringArg(args, key: "value") else {
        return errorResponse("invalid_argument", "key/value")
      }
      storage.setItem(key, value: value)
      return nil
    case "removeItem":
      guard let key = getStringArg(args, key: "key") else {
        return errorResponse("invalid_argument", "key")
      }
      storage.removeItem(key)
      return nil
    case "mergeItem":
      guard let key = getStringArg(args, key: "key"),
            let value = getStringArg(args, key: "value") else {
        return errorResponse("invalid_argument", "key/value")
      }
      storage.mergeItem(key, value: value)
      return nil
    case "clear":
      storage.clear()
      return nil
    case "getAllKeys":
      return storage.getAllKeys()
    case "multiGet":
      guard let keys = getStringArrayArg(args, key: "keys") else {
        return errorResponse("invalid_argument", "keys")
      }
      return storage.multiGet(keys)
    case "multiSet":
      guard let pairs = getPairsArg(args, key: "pairs") else {
        return errorResponse("invalid_argument", "pairs")
      }
      storage.multiSet(pairs)
      return nil
    case "multiRemove":
      guard let keys = getStringArrayArg(args, key: "keys") else {
        return errorResponse("invalid_argument", "keys")
      }
      storage.multiRemove(keys)
      return nil
    case "multiMerge":
      guard let pairs = getPairsArg(args, key: "pairs") else {
        return errorResponse("invalid_argument", "pairs")
      }
      storage.multiMerge(pairs)
      return nil
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  private func unwrapArgs(_ args: Any?) -> Any? {
    if let array = args as? [Any], array.count == 1 {
      let value = array[0]
      return value is NSNull ? nil : value
    }
    return args
  }

  private func getDictArg(_ args: Any?) -> [String: Any]? {
    let unwrapped = unwrapArgs(args)
    if let dict = unwrapped as? [String: Any] {
      return dict
    }
    if let dict = unwrapped as? NSDictionary {
      return dict as? [String: Any]
    }
    return nil
  }

  private func getStringArg(_ args: Any?, key: String) -> String? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    return value as? String
  }

  private func getStringArrayArg(_ args: Any?, key: String) -> [String]? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    if let array = value as? [String] {
      return array
    }
    if let array = value as? [Any] {
      return array.compactMap { $0 as? String }
    }
    if let array = value as? NSArray {
      return array.compactMap { $0 as? String }
    }
    return nil
  }

  private func getPairsArg(_ args: Any?, key: String) -> [(String, String)]? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    return parsePairs(value)
  }

  private func parsePairs(_ value: Any?) -> [(String, String)]? {
    guard let entries = value as? [Any] ?? (value as? NSArray as? [Any]) else {
      return nil
    }
    var result: [(String, String)] = []
    for entry in entries {
      if let pair = parsePair(entry) {
        result.append(pair)
      }
    }
    return result
  }

  private func parsePair(_ value: Any?) -> (String, String)? {
    if let array = value as? [Any], array.count >= 2,
       let key = array[0] as? String,
       let val = array[1] as? String {
      return (key, val)
    }
    if let array = value as? NSArray, array.count >= 2,
       let key = array[0] as? String,
       let val = array[1] as? String {
      return (key, val)
    }
    if let dict = value as? [String: Any],
       let key = dict["key"] as? String,
       let val = dict["value"] as? String {
      return (key, val)
    }
    return nil
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}

final class RuneAsyncStorageStore {
  private let defaults: UserDefaults
  private let queue = DispatchQueue(label: "dev.rune.asyncstorage.queue", qos: .utility)
  private let prefix = "rune.asyncstorage."

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func getItem(_ key: String) -> String? {
    return queue.sync {
      defaults.string(forKey: prefixed(key))
    }
  }

  func setItem(_ key: String, value: String) {
    queue.sync {
      defaults.set(value, forKey: prefixed(key))
    }
  }

  func removeItem(_ key: String) {
    queue.sync {
      defaults.removeObject(forKey: prefixed(key))
    }
  }

  func mergeItem(_ key: String, value: String) {
    queue.sync {
      let existing = defaults.string(forKey: prefixed(key))
      let merged = mergeJson(existing: existing, update: value)
      defaults.set(merged, forKey: prefixed(key))
    }
  }

  func clear() {
    queue.sync {
      for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
        defaults.removeObject(forKey: key)
      }
    }
  }

  func getAllKeys() -> [String] {
    return queue.sync {
      defaults.dictionaryRepresentation().keys
        .filter { $0.hasPrefix(prefix) }
        .map { String($0.dropFirst(prefix.count)) }
    }
  }

  func multiGet(_ keys: [String]) -> [[Any]] {
    return queue.sync {
      keys.map { key in
        let value = defaults.string(forKey: prefixed(key))
        return [key, value ?? NSNull()]
      }
    }
  }

  func multiSet(_ pairs: [(String, String)]) {
    queue.sync {
      for (key, value) in pairs {
        defaults.set(value, forKey: prefixed(key))
      }
    }
  }

  func multiRemove(_ keys: [String]) {
    queue.sync {
      for key in keys {
        defaults.removeObject(forKey: prefixed(key))
      }
    }
  }

  func multiMerge(_ pairs: [(String, String)]) {
    queue.sync {
      for (key, value) in pairs {
        let existing = defaults.string(forKey: prefixed(key))
        let merged = mergeJson(existing: existing, update: value)
        defaults.set(merged, forKey: prefixed(key))
      }
    }
  }

  private func prefixed(_ key: String) -> String {
    return prefix + key
  }

  private func mergeJson(existing: String?, update: String) -> String {
    guard let updateData = update.data(using: .utf8),
          let updateObject = try? JSONSerialization.jsonObject(with: updateData, options: [])
    else {
      return update
    }

    guard let updateDict = updateObject as? [String: Any] else {
      return update
    }

    guard let existing = existing,
          let existingData = existing.data(using: .utf8),
          let existingObject = try? JSONSerialization.jsonObject(with: existingData, options: []),
          let existingDict = existingObject as? [String: Any]
    else {
      return update
    }

    let merged = deepMerge(base: existingDict, update: updateDict)
    guard let data = try? JSONSerialization.data(withJSONObject: merged, options: [])
    else {
      return update
    }
    return String(data: data, encoding: .utf8) ?? update
  }

  private func deepMerge(base: [String: Any], update: [String: Any]) -> [String: Any] {
    var result = base
    for (key, value) in update {
      if let baseDict = result[key] as? [String: Any],
         let updateDict = value as? [String: Any] {
        result[key] = deepMerge(base: baseDict, update: updateDict)
      } else {
        result[key] = value
      }
    }
    return result
  }
}
