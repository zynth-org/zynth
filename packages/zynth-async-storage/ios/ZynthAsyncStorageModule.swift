//
//  ZynthAsyncStorageModule.swift
//  ZynthAsyncStorage
//
//  Native AsyncStorage implementation backed by UserDefaults
//

import Foundation
import ZynthKit

@objc(ZynthAsyncStorageModule)
final class ZynthAsyncStorageModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthAsyncStorage"
  private let storage = ZynthAsyncStorageStore()

  var exportedMethods: [String] {
    return [
      "getItem", "setItem", "removeItem", "mergeItem", "clear",
      "getAllKeys", "multiGet", "multiSet", "multiRemove", "multiMerge"
    ]
  }

  var protectedMethods: [String] {
    return ["setItem", "removeItem", "mergeItem", "clear", "multiSet", "multiRemove", "multiMerge"]
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
      return ["result": storage.getItem(key) as Any? ?? NSNull()]
    case "setItem":
      let key = try args.string("key")
      let value = try args.string("value")
      storage.setItem(key, value: value)
      return ["result": true]
    case "removeItem":
      let key = try args.string("key")
      storage.removeItem(key)
      return ["result": true]
    case "mergeItem":
      let key = try args.string("key")
      let value = try args.string("value")
      storage.mergeItem(key, value: value)
      return ["result": true]
    case "clear":
      storage.clear()
      return ["result": true]
    case "getAllKeys":
      return ["result": storage.getAllKeys()]
    case "multiGet":
      let keys = try args.array("keys").compactMap { $0 as? String }
      return ["result": storage.multiGet(keys)]
    case "multiSet":
      let pairs = parsePairs(try args.array("pairs"))
      storage.multiSet(pairs)
      return ["result": true]
    case "multiRemove":
      let keys = try args.array("keys").compactMap { $0 as? String }
      storage.multiRemove(keys)
      return ["result": true]
    case "multiMerge":
      let pairs = parsePairs(try args.array("pairs"))
      storage.multiMerge(pairs)
      return ["result": true]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func parsePairs(_ value: [Any]) -> [(String, String)] {
    var result: [(String, String)] = []
    for entry in value {
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
    if let dict = value as? [String: Any],
       let key = dict["key"] as? String,
       let val = dict["value"] as? String {
      return (key, val)
    }
    return nil
  }
}

final class ZynthAsyncStorageStore {
  private let defaults: UserDefaults
  private let queue = DispatchQueue(label: "dev.zynth.asyncstorage.queue", qos: .utility)
  private let prefix = "zynth.asyncstorage."

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
