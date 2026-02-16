import Foundation
import ZynthKit

@objc(NetworkModule)
final class NetworkModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Network"

  private let host = NetworkHost()

  func initialize() {
    host.initialize()
  }

  func invalidate() {
    host.invalidate()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getNetworkState":
      return host.getNetworkState()
    case "getIpAddress":
      return host.getIpAddress() ?? NSNull()
    case "getMacAddress":
      return host.getMacAddress() ?? NSNull()
    case "getCurrentWifi":
      return host.getCurrentWifi() ?? NSNull()
    case "isAirplaneModeEnabled":
      return host.isAirplaneModeEnabled() ?? NSNull()
    case "startDiscovery":
      let config = parseDiscoveryConfig(args)
      do {
        try host.startDiscovery(config: config)
        return nil
      } catch {
        return errorResponse("start_discovery_failed", error.localizedDescription)
      }
    case "stopDiscovery":
      host.stopDiscovery()
      return nil
    case "isDiscoveryRunning":
      return host.isDiscoveryRunning()
    case "getDiscoveredServices":
      return host.getDiscoveredServices().map { $0.toDictionary() }
    case "clearDiscoveredServices":
      host.clearDiscoveredServices()
      return nil
    case "drainDiscoveryEvents":
      let maxEvents = Int(args.number("maxEvents", default: 100))
      return host.drainDiscoveryEvents(maxEvents: maxEvents).map { $0.toDictionary() }
    case "startService":
      do {
        let options = try parseAdvertiseOptions(args)
        let info = try host.startService(options: options)
        return info.toDictionary()
      } catch {
        return errorResponse("start_service_failed", error.localizedDescription)
      }
    case "stopService":
      host.stopService()
      return nil
    case "getAdvertisedService":
      return host.getAdvertisedService()?.toDictionary() ?? NSNull()
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getNetworkState":
      return host.getNetworkState()
    case "getIpAddress":
      return host.getIpAddress() ?? NSNull()
    case "isDiscoveryRunning":
      return host.isDiscoveryRunning()
    case "getDiscoveredServices":
      return host.getDiscoveredServices().map { $0.toDictionary() }
    case "getAdvertisedService":
      return host.getAdvertisedService()?.toDictionary() ?? NSNull()
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
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

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
