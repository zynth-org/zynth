import Foundation

final class ZynthEnvModule: ZynthModule, ZynthSyncModule {
  let name: String = "Env"

  func call(method: String, args: Any?) throws -> Any? {
    #if DEBUG
      print("[ZynthEnvModule] call method=\(method) payloadType=\(type(of: args))")
    #endif
    switch method {
    case "constants":
      return ["result": constantsPayload()]
    case "echoData":
      return handleEchoData(args: args)
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    guard method == "constants" else {
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
    return constantsPayload()
  }

  private func constantsPayload() -> [String: Any] {
    [
      "platform": "ios",
      "runtime": "hermes",
      "timestamp": Date().timeIntervalSince1970,
    ]
  }

  private func handleEchoData(args: Any?) -> Any {
    guard let payloadDict = args as? [String: Any] else {
      #if DEBUG
        print("[ZynthEnvModule] echoData invalid args type=\(String(describing: type(of: args)))")
      #endif
      return ["error": "invalid_arguments"]
    }

    guard let payload = payloadDict["payload"] else {
      #if DEBUG
        print("[ZynthEnvModule] echoData missing payload key. keys=\(Array(payloadDict.keys))")
      #endif
      return ["error": "missing_payload"]
    }

    let data: Data
    if let payloadData = payload as? Data {
      #if DEBUG
        print("[ZynthEnvModule] echoData payload bridged as Data length=\(payloadData.count)")
      #endif
      data = payloadData
    } else if let numbers = payload as? [NSNumber] {
      #if DEBUG
        print("[ZynthEnvModule] echoData payload bridged as [NSNumber] count=\(numbers.count)")
      #endif
      data = Data(numbers.map { UInt8(truncating: $0) })
    } else if let bytes = payload as? [UInt8] {
      #if DEBUG
        print("[ZynthEnvModule] echoData payload bridged as [UInt8] count=\(bytes.count)")
      #endif
      data = Data(bytes)
    } else {
      #if DEBUG
        print(
          "[ZynthEnvModule] echoData unsupported payload type=\(String(describing: type(of: payload)))"
        )
      #endif
      return [
        "error": "unsupported_payload_type",
        "type": String(describing: type(of: payload)),
      ]
    }

    let checksum = fnv1a32Hex(data: data)

    #if DEBUG
      print("[ZynthEnvModule] echoData received bytes=\(data.count) checksum=\(checksum)")
    #endif

    return [
      "result": [
        "byteLength": data.count,
        "checksum": checksum,
        "echo": data,
      ]
    ]
  }

  private func fnv1a32Hex(data: Data) -> String {
    var hash: UInt32 = 0x811C_9DC5
    for byte in data {
      hash ^= UInt32(byte)
      hash = hash &* 16_777_619
    }
    return String(format: "%08x", hash)
  }
}
