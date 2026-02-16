import Foundation

public enum ZynthArgsError: LocalizedError {
  case missingKey(String)
  case invalidType(key: String, expected: String)
  case missingIndex(Int)

  public var errorDescription: String? {
    switch self {
    case .missingKey(let key):
      return "Missing required argument: \(key)"
    case .invalidType(let key, let expected):
      return "Invalid type for argument '\(key)': expected \(expected)"
    case .missingIndex(let index):
      return "Missing required argument at index \(index)"
    }
  }
}

public class ZynthArgs {
  private let args: Any?

  public init(_ args: Any?) {
    self.args = args
  }

  private func getDict() throws -> [String: Any] {
    if let dict = args as? [String: Any] {
      return dict
    }
    if let array = args as? [Any], array.count == 1, let dict = array[0] as? [String: Any] {
      return dict
    }
    throw ZynthArgsError.invalidType(key: "root", expected: "Dictionary")
  }

  public func string(_ key: String) throws -> String {
    let dict = try getDict()
    guard let val = dict[key] else {
      throw ZynthArgsError.missingKey(key)
    }
    if let result = val as? String {
      return result
    }
    if let result = val as? NSString {
      return result as String
    }
    throw ZynthArgsError.invalidType(key: key, expected: "String")
  }

  public func string(_ key: String, default: String) -> String {
    return (try? string(key)) ?? `default`
  }
  
  public func optionalString(_ key: String) -> String? {
    return try? string(key)
  }

  public func number(_ key: String) throws -> Double {
    let dict = try getDict()
    guard let val = dict[key] else {
      throw ZynthArgsError.missingKey(key)
    }
    if let result = val as? Double {
      return result
    }
    if let result = val as? NSNumber {
      return result.doubleValue
    }
    if let result = val as? Int {
      return Double(result)
    }
    throw ZynthArgsError.invalidType(key: key, expected: "Number")
  }

  public func number(_ key: String, default: Double) -> Double {
    return (try? number(key)) ?? `default`
  }

  public func int64(_ key: String) throws -> Int64 {
    let num = try number(key)
    return Int64(num)
  }

  public func bool(_ key: String) throws -> Bool {
    let dict = try getDict()
    guard let val = dict[key] else {
      throw ZynthArgsError.missingKey(key)
    }
    if let result = val as? Bool {
      return result
    }
    if let result = val as? NSNumber {
      return result.boolValue
    }
    throw ZynthArgsError.invalidType(key: key, expected: "Bool")
  }

  public func bool(_ key: String, default: Bool) -> Bool {
    return (try? bool(key)) ?? `default`
  }

  public func dict(_ key: String) throws -> [String: Any] {
    let dict = try getDict()
    guard let val = dict[key] else {
      throw ZynthArgsError.missingKey(key)
    }
    guard let result = val as? [String: Any] else {
      throw ZynthArgsError.invalidType(key: key, expected: "Dictionary")
    }
    return result
  }

  public func array(_ key: String) throws -> [Any] {
    let dict = try getDict()
    guard let val = dict[key] else {
      throw ZynthArgsError.missingKey(key)
    }
    guard let result = val as? [Any] else {
      throw ZynthArgsError.invalidType(key: key, expected: "Array")
    }
    return result
  }

  // Index-based accessors (if args is an array)
  public func getString(_ index: Int) throws -> String {
    guard let array = args as? [Any] else {
      throw ZynthArgsError.invalidType(key: "root", expected: "Array")
    }
    guard index < array.count else {
      throw ZynthArgsError.missingIndex(index)
    }
    let val = array[index]
    if let result = val as? String {
      return result
    }
    if let result = val as? NSString {
      return result as String
    }
    throw ZynthArgsError.invalidType(key: "[\(index)]", expected: "String")
  }

  public func getNumber(_ index: Int) throws -> Double {
    guard let array = args as? [Any] else {
      throw ZynthArgsError.invalidType(key: "root", expected: "Array")
    }
    guard index < array.count else {
      throw ZynthArgsError.missingIndex(index)
    }
    let val = array[index]
    if let result = val as? Double {
      return result
    }
    if let result = val as? NSNumber {
      return result.doubleValue
    }
    if let result = val as? Int {
      return Double(result)
    }
    throw ZynthArgsError.invalidType(key: "[\(index)]", expected: "Number")
  }

  public func getBool(_ index: Int) throws -> Bool {
    guard let array = args as? [Any] else {
      throw ZynthArgsError.invalidType(key: "root", expected: "Array")
    }
    guard index < array.count else {
      throw ZynthArgsError.missingIndex(index)
    }
    let val = array[index]
    if let result = val as? Bool {
      return result
    }
    if let result = val as? NSNumber {
      return result.boolValue
    }
    throw ZynthArgsError.invalidType(key: "[\(index)]", expected: "Bool")
  }

  public func asDict() throws -> [String: Any] {
    guard let dict = args as? [String: Any] else {
      throw ZynthArgsError.invalidType(key: "root", expected: "Dictionary")
    }
    return dict
  }

  public func asArray() throws -> [Any] {
    guard let array = args as? [Any] else {
      throw ZynthArgsError.invalidType(key: "root", expected: "Array")
    }
    return array
  }
}
