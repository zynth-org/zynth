import Foundation
import ZynthKit

@objc(NetworkModule)
final class NetworkModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Network"

  var exportedMethods: [String] {
    return [
      "getNetworkState",
      "getIpAddress",
      "getMacAddress",
      "getCurrentWifi",
      "getLocalIdentity",
      "signChallenge",
      "verifyChallenge",
      "isAirplaneModeEnabled",
      "startDiscovery",
      "stopDiscovery",
      "isDiscoveryRunning",
      "getDiscoveredServices",
      "clearDiscoveredServices",
      "drainDiscoveryEvents",
      "startService",
      "stopService",
      "getAdvertisedService",
      "current"
    ]
  }

  private let host = NetworkHost()
  private let identityHost = NetworkIdentityHost()

  func initialize() {
    host.initialize()
  }

  func invalidate() {
    host.invalidate()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getNetworkState", "current":
      return ["result": host.getNetworkState()]
    case "getIpAddress":
      return ["result": host.getIpAddress() as Any? ?? NSNull()]
    case "getMacAddress":
      return ["result": host.getMacAddress() as Any? ?? NSNull()]
    case "getCurrentWifi":
      return ["result": host.getCurrentWifi() as Any? ?? NSNull()]
    case "getLocalIdentity":
      return ["result": try identityHost.getLocalIdentity()]
    case "signChallenge":
      let challengeBase64 = try args.string("challengeBase64")
      return ["result": try identityHost.signChallenge(challengeBase64: challengeBase64)]
    case "verifyChallenge":
      let publicKeyBase64 = try args.string("publicKeyBase64")
      let challengeBase64 = try args.string("challengeBase64")
      let signatureBase64 = try args.string("signatureBase64")
      return [
        "result": try identityHost.verifyChallenge(
          publicKeyBase64: publicKeyBase64,
          challengeBase64: challengeBase64,
          signatureBase64: signatureBase64
        ),
      ]
    case "isAirplaneModeEnabled":
      return ["result": host.isAirplaneModeEnabled() as Any? ?? NSNull()]
    case "startDiscovery":
      let config = parseDiscoveryConfig(args)
      try host.startDiscovery(config: config)
      return ["result": true]
    case "stopDiscovery":
      host.stopDiscovery()
      return ["result": true]
    case "isDiscoveryRunning":
      return ["result": host.isDiscoveryRunning()]
    case "getDiscoveredServices":
      return ["result": host.getDiscoveredServices().map { $0.toDictionary() }]
    case "clearDiscoveredServices":
      host.clearDiscoveredServices()
      return ["result": true]
    case "drainDiscoveryEvents":
      let maxEvents = Int(args.number("maxEvents", default: 100))
      return ["result": host.drainDiscoveryEvents(maxEvents: maxEvents).map { $0.toDictionary() }]
    case "startService":
      let options = try parseAdvertiseOptions(args)
      let info = try host.startService(options: options)
      return ["result": info.toDictionary()]
    case "stopService":
      host.stopService()
      return ["result": true]
    case "getAdvertisedService":
      let info = host.getAdvertisedService()?.toDictionary()
      return ["result": info as Any? ?? NSNull()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getNetworkState", "current":
      return host.getNetworkState()
    case "getIpAddress":
      return host.getIpAddress() ?? NSNull()
    case "getLocalIdentity":
      return try identityHost.getLocalIdentity()
    case "isDiscoveryRunning":
      return host.isDiscoveryRunning()
    case "getDiscoveredServices":
      return host.getDiscoveredServices().map { $0.toDictionary() }
    case "getAdvertisedService":
      return host.getAdvertisedService()?.toDictionary() ?? NSNull()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func parseDiscoveryConfig(_ args: ZynthArgs) -> DiscoveryConfig {
    let serviceType = normalizeServiceType(args.optionalString("serviceType"), fallback: "_zynth._tcp.")
    let domain = normalizeDomain(args.optionalString("domain"), fallback: "local.")
    let timeoutMs = max(500, Int(args.number("resolveTimeoutMs", default: 4000)))
    return DiscoveryConfig(serviceType: serviceType, domain: domain, resolveTimeoutMs: timeoutMs)
  }

  private func parseAdvertiseOptions(_ args: ZynthArgs) throws -> AdvertiseOptions {
    let serviceType = try args.string("serviceType")
    if serviceType.isEmpty {
      throw NSError(domain: "Network", code: 1, userInfo: [NSLocalizedDescriptionKey: "serviceType is required"])
    }
    let name = try args.string("name")
    if name.isEmpty {
      throw NSError(domain: "Network", code: 2, userInfo: [NSLocalizedDescriptionKey: "name is required"])
    }
    let port = try Int(args.number("port"))
    if port <= 0 || port > 65535 {
      throw NSError(domain: "Network", code: 3, userInfo: [NSLocalizedDescriptionKey: "port must be between 1 and 65535"])
    }

    let domain = normalizeDomain(args.optionalString("domain"), fallback: "local.")
    let txtRecord = getStringDictionary(from: try? args.dict("txtRecord"))

    return AdvertiseOptions(
      serviceType: normalizeServiceType(serviceType, fallback: "_zynth._tcp."),
      name: name,
      domain: domain,
      port: port,
      txtRecord: txtRecord
    )
  }

  private func getStringDictionary(from map: [String: Any]?) -> [String: String] {
    guard let map = map else { return [:] }
    var result: [String: String] = [:]
    for (entryKey, entryValue) in map {
      result[entryKey] = String(describing: entryValue)
    }
    return result
  }

  private func normalizeServiceType(_ value: String?, fallback: String) -> String {
    let candidate = (value ?? fallback).trimmingCharacters(in: .whitespacesAndNewlines)
    if candidate.isEmpty { return fallback }
    return candidate.hasSuffix(".") ? candidate : "\(candidate)."
  }

  private func normalizeDomain(_ value: String?, fallback: String) -> String {
    let candidate = (value ?? fallback).trimmingCharacters(in: .whitespacesAndNewlines)
    if candidate.isEmpty { return fallback }
    return candidate.hasSuffix(".") ? candidate : "\(candidate)."
  }
}
