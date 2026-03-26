import Darwin
import Foundation
import Network

private let NET_SERVICE_ERROR_CODE_KEY = "NSNetServicesErrorCode"
private let NET_SERVICE_SECURITY_ERROR_CODE = -72008

final class NetworkHost: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private let monitor = NWPathMonitor()
  private let monitorQueue = DispatchQueue(label: "dev.zynth.network.path")
  private let stateLock = NSLock()
  private var latestPath: NWPath?

  private var discoveryBrowser: NetServiceBrowser?
  private var discoveryConfig = DiscoveryConfig(serviceType: "_zynth._tcp.", domain: "local.", resolveTimeoutMs: 4000)
  private var discoveryRunning = false
  private var discoveredServices: [String: NetworkServiceInfo] = [:]
  private var discoveredNetServices: [String: NetService] = [:]
  private var discoveryEvents: [DiscoveryEvent] = []

  private var advertisedService: NetService?
  private var advertisedInfo: AdvertisedServiceInfo?
  private var localNetworkAccessStatus: LocalNetworkAccessStatus = .unknown
  private var localNetworkProbe: LocalNetworkPermissionProbe?

  private func setLocalNetworkAccessStatus(_ status: LocalNetworkAccessStatus, reason: String) {
    if localNetworkAccessStatus != status {
      NSLog("[ZynthNetworkHost] localNetworkAccessStatus %@ -> %@ (%@)", localNetworkAccessStatus.rawValue, status.rawValue, reason)
    } else {
      NSLog("[ZynthNetworkHost] localNetworkAccessStatus stays %@ (%@)", status.rawValue, reason)
    }
    localNetworkAccessStatus = status
  }

  func initialize() {
    monitor.pathUpdateHandler = { [weak self] path in
      self?.stateLock.lock()
      self?.latestPath = path
      self?.stateLock.unlock()
    }
    monitor.start(queue: monitorQueue)
  }

  func invalidate() {
    monitor.cancel()
    onMainSync {
      self.stopDiscoveryInternal(clearServices: true)
      self.stopServiceInternal()
    }
  }

  func getNetworkState() -> [String: Any] {
    let path = currentPath()
    let type = networkType(from: path)

    return [
      "type": type,
      "isConnected": path.status == .satisfied,
      "isInternetReachable": path.status == .satisfied,
      "isExpensive": path.isExpensive,
    ]
  }

  func getIpAddress() -> String? {
    let addresses = interfaceAddresses()

    if let wifi = addresses["en0"], let preferred = preferredAddress(from: wifi) {
      return preferred
    }

    for preferred in ["pdp_ip0", "en1", "en2", "en3"] {
      if let candidates = addresses[preferred], let address = preferredAddress(from: candidates) {
        return address
      }
    }

    for (_, candidates) in addresses {
      if let address = preferredAddress(from: candidates) {
        return address
      }
    }

    return nil
  }

  func getMacAddress() -> String? {
    return nil
  }

  func getCurrentWifi() -> [String: Any]? {
    let path = currentPath()
    guard path.status == .satisfied && path.usesInterfaceType(.wifi) else {
      return nil
    }

    let ipAddress = preferredAddress(from: interfaceAddresses()["en0"] ?? [])

    return [
      "ssid": NSNull(),
      "bssid": NSNull(),
      "ipAddress": ipAddress ?? NSNull(),
    ]
  }

  func isAirplaneModeEnabled() -> Bool? {
    return nil
  }

  func startDiscovery(config: DiscoveryConfig) throws {
    onMainSync {
      self.discoveryConfig = config
      self.stopDiscoveryInternal(clearServices: false)

      let browser = NetServiceBrowser()
      browser.delegate = self
      self.discoveryBrowser = browser
      self.discoveryRunning = true
      browser.searchForServices(ofType: config.serviceType, inDomain: config.domain)
    }
  }

  func stopDiscovery() {
    onMainSync {
      self.stopDiscoveryInternal(clearServices: false)
    }
  }

  func isDiscoveryRunning() -> Bool {
    return onMainSync {
      self.discoveryRunning
    }
  }

  func getDiscoveredServices() -> [NetworkServiceInfo] {
    return onMainSync {
      self.discoveredServices.values.sorted { lhs, rhs in
        if lhs.name == rhs.name {
          return lhs.type < rhs.type
        }
        return lhs.name < rhs.name
      }
    }
  }

  func clearDiscoveredServices() {
    onMainSync {
      self.discoveredServices.removeAll()
      self.discoveryEvents.removeAll()
      self.discoveredNetServices.removeAll()
    }
  }

  func drainDiscoveryEvents(maxEvents: Int) -> [DiscoveryEvent] {
    return onMainSync {
      let limit = max(1, maxEvents)
      let count = min(limit, self.discoveryEvents.count)
      if count == 0 {
        return []
      }
      let drained = Array(self.discoveryEvents.prefix(count))
      self.discoveryEvents.removeFirst(count)
      return drained
    }
  }

  func startService(options: AdvertiseOptions) throws -> AdvertisedServiceInfo {
    return onMainSync {
      self.stopServiceInternal()

      let info = AdvertisedServiceInfo(
        serviceType: options.serviceType,
        name: options.name,
        domain: options.domain,
        port: options.port,
        txtRecord: options.txtRecord
      )

      let service = NetService(
        domain: options.domain,
        type: options.serviceType,
        name: options.name,
        port: Int32(options.port)
      )
      service.delegate = self

      if !options.txtRecord.isEmpty {
        var txtRecordData: [String: Data] = [:]
        for (key, value) in options.txtRecord {
          let sanitizedKey = self.sanitizeTxtKey(key)
          let sanitizedValue = self.sanitizeTxtValue(value)
          if sanitizedKey.isEmpty || sanitizedValue.isEmpty {
            continue
          }
          txtRecordData[sanitizedKey] = sanitizedValue.data(using: .utf8)
        }
        if !txtRecordData.isEmpty {
          service.setTXTRecord(NetService.data(fromTXTRecord: txtRecordData))
        }
      }

      self.advertisedService = service
      self.advertisedInfo = info
      service.publish()

      return info
    }
  }

  func stopService() {
    onMainSync {
      self.stopServiceInternal()
    }
  }

  func getAdvertisedService() -> AdvertisedServiceInfo? {
    return onMainSync {
      self.advertisedInfo
    }
  }

  func getLocalNetworkAccessStatus() -> LocalNetworkAccessStatus {
    if #unavailable(iOS 14.0) {
      return .unavailable
    }
    return onMainSync {
      self.localNetworkAccessStatus
    }
  }

  func requestLocalNetworkAccess(timeoutMs: Int = 2500) -> LocalNetworkAccessStatus {
    if #unavailable(iOS 14.0) {
      return .unavailable
    }

    let sanitizedTimeoutMs = max(1000, min(8000, timeoutMs))
    let current = getLocalNetworkAccessStatus()
    if current == .granted || current == .unavailable {
      return current
    }

    if Thread.isMainThread {
      startLocalNetworkProbe(timeoutMs: sanitizedTimeoutMs)
      return getLocalNetworkAccessStatus()
    }

    let semaphore = DispatchSemaphore(value: 0)
    onMainSync {
      self.startLocalNetworkProbe(timeoutMs: sanitizedTimeoutMs) {
        semaphore.signal()
      }
    }
    _ = semaphore.wait(timeout: .now() + .milliseconds(sanitizedTimeoutMs + 300))
    return getLocalNetworkAccessStatus()
  }

  private func currentPath() -> NWPath {
    stateLock.lock()
    let path = latestPath ?? monitor.currentPath
    stateLock.unlock()
    return path
  }

  private func networkType(from path: NWPath) -> String {
    guard path.status == .satisfied else {
      return "none"
    }

    if path.usesInterfaceType(.wifi) { return "wifi" }
    if path.usesInterfaceType(.cellular) { return "cellular" }
    if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }
    if path.usesInterfaceType(.other) { return "other" }

    return "unknown"
  }

  private func interfaceAddresses() -> [String: [String]] {
    var map: [String: [String]] = [:]
    var pointer: UnsafeMutablePointer<ifaddrs>?

    guard getifaddrs(&pointer) == 0, let first = pointer else {
      return map
    }

    defer { freeifaddrs(pointer) }

    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let current = cursor {
      let interface = current.pointee
      cursor = interface.ifa_next

      guard let address = interface.ifa_addr else { continue }
      let family = Int32(address.pointee.sa_family)
      guard family == AF_INET || family == AF_INET6 else { continue }

      let flags = Int32(interface.ifa_flags)
      let isUp = (flags & IFF_UP) == IFF_UP
      let isLoopback = (flags & IFF_LOOPBACK) == IFF_LOOPBACK
      if !isUp || isLoopback { continue }

      guard let nameC = interface.ifa_name else { continue }
      let name = String(cString: nameC)

      var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let result = getnameinfo(
        address,
        socklen_t(address.pointee.sa_len),
        &hostBuffer,
        socklen_t(hostBuffer.count),
        nil,
        0,
        NI_NUMERICHOST
      )
      if result != 0 { continue }

      let host = String(cString: hostBuffer)
      if host.isEmpty { continue }

      map[name, default: []].append(host)
    }

    return map
  }

  private func stopDiscoveryInternal(clearServices: Bool) {
    discoveryBrowser?.stop()
    discoveryBrowser?.delegate = nil
    discoveryBrowser = nil
    discoveryRunning = false

    for (_, service) in discoveredNetServices {
      service.delegate = nil
      service.stop()
    }
    discoveredNetServices.removeAll()

    if clearServices {
      discoveredServices.removeAll()
      discoveryEvents.removeAll()
    }
  }

  private func stopServiceInternal() {
    advertisedService?.stop()
    advertisedService?.delegate = nil
    advertisedService = nil
    advertisedInfo = nil
  }

  private func key(for service: NetService) -> String {
    return key(name: service.name, type: service.type, domain: service.domain)
  }

  private func key(name: String, type: String, domain: String) -> String {
    return "\(name.lowercased())|\(type.lowercased())|\(domain.lowercased())"
  }

  private func nowMs() -> Int64 {
    return Int64(Date().timeIntervalSince1970 * 1000.0)
  }

  private func preferredAddress(from candidates: [String]) -> String? {
    if let ipv4 = candidates.first(where: { $0.contains(".") }) {
      return ipv4
    }

    if let globalIpv6 = candidates.first(where: {
      let lower = $0.lowercased()
      return lower.contains(":") && !lower.hasPrefix("fe80:")
    }) {
      return stripIPv6Scope(globalIpv6)
    }

    if let anyIpv6 = candidates.first(where: { $0.contains(":") }) {
      return stripIPv6Scope(anyIpv6)
    }

    return candidates.first
  }

  private func stripIPv6Scope(_ address: String) -> String {
    guard let separator = address.firstIndex(of: "%") else {
      return address
    }
    return String(address[..<separator])
  }

  private func enqueueDiscoveryEvent(type: String, service: NetworkServiceInfo) {
    discoveryEvents.append(
      DiscoveryEvent(type: type, timestamp: nowMs(), service: service)
    )
    if discoveryEvents.count > 500 {
      discoveryEvents.removeFirst(discoveryEvents.count - 500)
    }
  }

  private func serviceInfo(from service: NetService, existing: NetworkServiceInfo?) -> NetworkServiceInfo {
    let id = existing?.id ?? key(for: service)
    let addresses = (service.addresses ?? []).compactMap { data in
      self.addressString(from: data)
    }
    let txtRecord = txtRecordDictionary(from: service.txtRecordData())

    return NetworkServiceInfo(
      id: id,
      name: service.name,
      type: service.type,
      domain: service.domain,
      hostName: service.hostName,
      port: Int(service.port),
      addresses: addresses,
      txtRecord: txtRecord,
      lastSeenAt: nowMs()
    )
  }

  private func txtRecordDictionary(from data: Data?) -> [String: String] {
    guard let data else { return [:] }

    let parsed = NetService.dictionary(fromTXTRecord: data)
    var output: [String: String] = [:]

    for (key, value) in parsed {
      output[key] = String(data: value, encoding: .utf8) ?? ""
    }

    return output
  }

  private func addressString(from data: Data) -> String? {
    return data.withUnsafeBytes { pointer in
      guard let sockaddrPointer = pointer.baseAddress?.assumingMemoryBound(to: sockaddr.self) else {
        return nil
      }

      let family = Int32(sockaddrPointer.pointee.sa_family)
      guard family == AF_INET || family == AF_INET6 else {
        return nil
      }

      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let length = socklen_t(sockaddrPointer.pointee.sa_len)
      let result = getnameinfo(
        sockaddrPointer,
        length,
        &host,
        socklen_t(host.count),
        nil,
        0,
        NI_NUMERICHOST
      )

      guard result == 0 else {
        return nil
      }

      return stripIPv6Scope(String(cString: host))
    }
  }

  private func onMainSync<T>(_ block: () -> T) -> T {
    if Thread.isMainThread {
      return block()
    }

    return DispatchQueue.main.sync {
      block()
    }
  }

  func netServiceBrowserWillSearch(_ browser: NetServiceBrowser) {
    discoveryRunning = true
  }

  func netServiceBrowserDidStopSearch(_ browser: NetServiceBrowser) {
    discoveryRunning = false
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String : NSNumber]) {
    discoveryRunning = false
    let status = statusFromNetServiceError(errorDict)
    if status == .denied || status == .restricted {
      setLocalNetworkAccessStatus(status, reason: "discovery.didNotSearch")
    }
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    let serviceKey = key(for: service)
    let existing = discoveredServices[serviceKey]
    let info = serviceInfo(from: service, existing: existing)

    discoveredServices[serviceKey] = info
    discoveredNetServices[serviceKey] = service
    enqueueDiscoveryEvent(type: "serviceFound", service: info)

    service.delegate = self
    let timeout = TimeInterval(Double(discoveryConfig.resolveTimeoutMs) / 1000.0)
    service.resolve(withTimeout: timeout)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    let serviceKey = key(for: service)
    if let existing = discoveredServices.removeValue(forKey: serviceKey) {
      enqueueDiscoveryEvent(type: "serviceLost", service: existing)
    }

    if let tracked = discoveredNetServices.removeValue(forKey: serviceKey) {
      tracked.delegate = nil
      tracked.stop()
    }
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    let serviceKey = key(for: sender)
    let existing = discoveredServices[serviceKey]
    let updated = serviceInfo(from: sender, existing: existing)
    discoveredServices[serviceKey] = updated
    enqueueDiscoveryEvent(type: "serviceResolved", service: updated)
  }

  func netService(_ sender: NetService, didUpdateTXTRecord data: Data) {
    let serviceKey = key(for: sender)
    let existing = discoveredServices[serviceKey]
    let updated = serviceInfo(from: sender, existing: existing)
    discoveredServices[serviceKey] = updated
    enqueueDiscoveryEvent(type: "serviceUpdated", service: updated)
  }

  func netServiceDidPublish(_ sender: NetService) {
    NSLog("[ZynthNetworkHost] didPublish name=%@ type=%@ port=%d", sender.name, sender.type, sender.port)
  }

  func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
    NSLog("[ZynthNetworkHost] didNotPublish name=%@ error=%@", sender.name, String(describing: errorDict))
    let status = statusFromNetServiceError(errorDict)
    if status == .denied || status == .restricted {
      setLocalNetworkAccessStatus(status, reason: "service.didNotPublish")
    }
    if let active = advertisedService, active === sender {
      stopServiceInternal()
    }
  }

  private func startLocalNetworkProbe(timeoutMs: Int, onResolved: (() -> Void)? = nil) {
    if localNetworkProbe != nil {
      onResolved?()
      return
    }

    let probe = LocalNetworkPermissionProbe(timeoutMs: timeoutMs) { [weak self] status in
      guard let self else { return }
      self.onMainSync {
        self.setLocalNetworkAccessStatus(status, reason: "probe.complete")
        self.localNetworkProbe = nil
      }
      onResolved?()
    }
    localNetworkProbe = probe
    probe.start()
  }

  private func statusFromNetServiceError(_ errorDict: [String: NSNumber]) -> LocalNetworkAccessStatus {
    let code = errorDict[NET_SERVICE_ERROR_CODE_KEY]?.intValue ?? 0
    NSLog("[ZynthNetworkHost] NetService error code=%d payload=%@", code, String(describing: errorDict))
    if code == NET_SERVICE_SECURITY_ERROR_CODE {
      return .denied
    }
    return .unknown
  }

  private func sanitizeTxtKey(_ key: String) -> String {
    let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return ""
    }
    let ascii = trimmed.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "", options: .regularExpression)
    // Android NsdServiceInfo discourages keys longer than 9; keep wire format conservative.
    return String(ascii.prefix(9))
  }

  private func sanitizeTxtValue(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return ""
    }
    let ascii = trimmed.replacingOccurrences(of: "[^\\x20-\\x7E]", with: "_", options: .regularExpression)
    // Keep TXT values modest to reduce fragmentation/parser issues on older stacks.
    return String(ascii.prefix(120))
  }
}

private final class LocalNetworkPermissionProbe: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private let timeoutMs: Int
  private let onComplete: (LocalNetworkAccessStatus) -> Void
  private var completed = false
  private var timeoutWorkItem: DispatchWorkItem?
  private var successWorkItem: DispatchWorkItem?
  private var browser: NetServiceBrowser?
  private var service: NetService?
  private var didStartBrowsing = false
  private var didPublishService = false

  init(timeoutMs: Int, onComplete: @escaping (LocalNetworkAccessStatus) -> Void) {
    self.timeoutMs = timeoutMs
    self.onComplete = onComplete
  }

  func start() {
    NSLog("[ZynthNetworkHost] probe.start timeoutMs=%d", timeoutMs)
    let browser = NetServiceBrowser()
    browser.delegate = self
    self.browser = browser
    browser.searchForServices(ofType: "_zynth._tcp.", inDomain: "local.")

    let name = "zynth-probe-\(UUID().uuidString.prefix(8))"
    let service = NetService(domain: "local.", type: "_zynth._tcp.", name: name, port: 9)
    service.delegate = self
    self.service = service
    service.publish()

    let work = DispatchWorkItem { [weak self] in
      self?.finish(self?.timeoutStatus() ?? .unknown)
    }
    timeoutWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: work)
  }

  private func finish(_ status: LocalNetworkAccessStatus) {
    guard !completed else { return }
    completed = true
    NSLog("[ZynthNetworkHost] probe.finish status=%@", status.rawValue)
    timeoutWorkItem?.cancel()
    timeoutWorkItem = nil
    successWorkItem?.cancel()
    successWorkItem = nil

    browser?.stop()
    browser?.delegate = nil
    browser = nil

    service?.stop()
    service?.delegate = nil
    service = nil

    onComplete(status)
  }

  func netServiceBrowserWillSearch(_ browser: NetServiceBrowser) {
    didStartBrowsing = true
    scheduleGrantIfReady()
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String : NSNumber]) {
    finish(statusFromNetServiceError(errorDict))
  }

  func netServiceDidPublish(_ sender: NetService) {
    didPublishService = true
    scheduleGrantIfReady()
  }

  func netService(_ sender: NetService, didNotPublish errorDict: [String : NSNumber]) {
    finish(statusFromNetServiceError(errorDict))
  }

  private func statusFromNetServiceError(_ errorDict: [String: NSNumber]) -> LocalNetworkAccessStatus {
    let code = errorDict[NET_SERVICE_ERROR_CODE_KEY]?.intValue ?? 0
    if code == NET_SERVICE_SECURITY_ERROR_CODE {
      return .denied
    }
    return .unknown
  }

  private func scheduleGrantIfReady() {
    if successWorkItem != nil || !didStartBrowsing || !didPublishService {
      return
    }
    let work = DispatchWorkItem { [weak self] in
      self?.finish(.granted)
    }
    successWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(250), execute: work)
  }

  private func timeoutStatus() -> LocalNetworkAccessStatus {
    // On some iOS versions, denied Local Network permission can fail silently
    // (no didNotSearch/didNotPublish callback) and only timeout.
    // If neither browse nor publish started, treat timeout as denied.
    if !didStartBrowsing && !didPublishService {
      return .denied
    }
    return .unknown
  }
}
