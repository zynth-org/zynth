import Foundation

final class RuneEnvModule: RuneModule, RuneSyncModule {
  let name: String = "Env"

  func call(method: String, argsJSON: String) -> String {
    switch method {
    case "constants":
      return jsonString(from: ["result": constantsPayload()])
    default:
      return jsonString(from: ["error": "unknown_method", "method": method])
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    guard method == "constants" else {
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
    return constantsPayload()
  }

  private func constantsPayload() -> [String: Any] {
    [
      "platform": "ios",
      "runtime": "hermes",
      "timestamp": Date().timeIntervalSince1970
    ]
  }

  private func jsonString(from object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object) else {
      return "{}"
    }
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}
