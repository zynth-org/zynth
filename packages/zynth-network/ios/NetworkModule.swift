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

  func call(method: String, args: Any?) throws -> Any? {
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
      let maxEvents = getIntArg(args, key: "maxEvents") ?? 100
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

  func callSync(method: String, args: Any?) throws -> Any? {
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

  private func parseDiscoveryConfig(_ args: Any?) -> DiscoveryConfig {
    let serviceType = normalizeServiceType(getStringArg(args, key: "serviceType"), fallback: "_zynth._tcp.")
    let domain = normalizeDomain(getStringArg(args, key: "domain"), fallback: "local.")
    let timeoutMs = max(500, getIntArg(args, key: "resolveTimeoutMs") ?? 4000)
    return DiscoveryConfig(serviceType: serviceType, domain: domain, resolveTimeoutMs: timeoutMs)
  }

  private func parseAdvertiseOptions(_ args: Any?) throws -> AdvertiseOptions {
    guard let serviceType = getStringArg(args, key: "serviceType"), !serviceType.isEmpty else {
      throw NSError(domain: "Network", code: 1, userInfo: [NSLocalizedDescriptionKey: "serviceType is required"])
    }
    guard let name = getStringArg(args, key: "name"), !name.isEmpty else {
      throw NSError(domain: "Network", code: 2, userInfo: [NSLocalizedDescriptionKey: "name is required"])
    }
    let port = getIntArg(args, key: "port") ?? 0
    if port <= 0 || port > 65535 {
      throw NSError(domain: "Network", code: 3, userInfo: [NSLocalizedDescriptionKey: "port must be between 1 and 65535"])
    }

    let domain = normalizeDomain(getStringArg(args, key: "domain"), fallback: "local.")
    let txtRecord = getStringDictionaryArg(args, key: "txtRecord")

    return AdvertiseOptions(
      serviceType: normalizeServiceType(serviceType, fallback: "_zynth._tcp."),
      name: name,
      domain: domain,
      port: port,
      txtRecord: txtRecord
    )
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
    guard let value = dict[key] else { return nil }
    if let string = value as? String {
      return string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return nil
  }

  private func getIntArg(_ args: Any?, key: String) -> Int? {
    guard let dict = getDictArg(args) else { return nil }
    guard let value = dict[key] else { return nil }
    if let number = value as? NSNumber {
      return number.intValue
    }
    if let string = value as? String {
      return Int(string)
    }
    return nil
  }

  private func getStringDictionaryArg(_ args: Any?, key: String) -> [String: String] {
    guard let dict = getDictArg(args) else { return [:] }
    guard let raw = dict[key] else { return [:] }

    if let map = raw as? [String: String] {
      return map
    }

    if let map = raw as? [String: Any] {
      var result: [String: String] = [:]
      for (entryKey, entryValue) in map {
        result[entryKey] = String(describing: entryValue)
      }
      return result
    }

    return [:]
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
