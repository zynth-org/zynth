import Foundation

struct DiscoveryConfig {
  let serviceType: String
  let domain: String
  let resolveTimeoutMs: Int
}

struct AdvertiseOptions {
  let serviceType: String
  let name: String
  let domain: String
  let port: Int
  let txtRecord: [String: String]
}

struct AdvertisedServiceInfo {
  let serviceType: String
  let name: String
  let domain: String
  let port: Int
  let txtRecord: [String: String]

  func toDictionary() -> [String: Any] {
    return [
      "serviceType": serviceType,
      "name": name,
      "domain": domain,
      "port": port,
      "txtRecord": txtRecord,
    ]
  }
}

struct NetworkServiceInfo {
  let id: String
  let name: String
  let type: String
  let domain: String
  var hostName: String?
  var port: Int
  var addresses: [String]
  var txtRecord: [String: String]
  var lastSeenAt: Int64

  func toDictionary() -> [String: Any] {
    return [
      "id": id,
      "name": name,
      "type": type,
      "domain": domain,
      "hostName": hostName ?? NSNull(),
      "port": port,
      "addresses": addresses,
      "txtRecord": txtRecord,
      "lastSeenAt": lastSeenAt,
    ]
  }
}

struct DiscoveryEvent {
  let type: String
  let timestamp: Int64
  let service: NetworkServiceInfo

  func toDictionary() -> [String: Any] {
    return [
      "type": type,
      "timestamp": timestamp,
      "service": service.toDictionary(),
    ]
  }
}
