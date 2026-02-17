import Foundation
import Network
import ZynthKit

private let networkEventName = "zynth.network.change"

private struct NetworkSnapshot: Equatable {
  let isConnected: Bool
  let isInternetReachable: Bool
  let type: String
  let isExpensive: Bool

  func toDictionary() -> [String: Any] {
    [
      "isConnected": isConnected,
      "isInternetReachable": isInternetReachable,
      "type": type,
      "isExpensive": isExpensive,
    ]
  }
}

@objc(ZynthNetworkModule)
final class ZynthNetworkModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthNetworkCore"

  var exportedMethods: [String] {
    return ["current"]
  }

  private weak var runtime: ZynthRuntime?
  private let monitor = NWPathMonitor()
  private let monitorQueue = DispatchQueue(label: "dev.zynth.apis.network.monitor")
  private let lock = NSLock()
  private var isMonitoring = false
  private var latestSnapshot: NetworkSnapshot

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    self.latestSnapshot = NetworkSnapshot(
      isConnected: false,
      isInternetReachable: false,
      type: "unknown",
      isExpensive: false
    )
    super.init()
  }

  var constantsToExport: [String: Any]? {
    withSnapshot { $0.toDictionary() }
  }

  func initialize() {
    startMonitoring()
  }

  func invalidate() {
    stopMonitoring()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "current":
      return ["result": withSnapshot { $0.toDictionary() }]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "current":
      return withSnapshot { $0.toDictionary() }
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func startMonitoring() {
    guard !isMonitoring else { return }
    isMonitoring = true

    handlePathUpdate(monitor.currentPath)
    monitor.pathUpdateHandler = { [weak self] path in
      self?.handlePathUpdate(path)
    }
    monitor.start(queue: monitorQueue)
  }

  private func stopMonitoring() {
    guard isMonitoring else { return }
    isMonitoring = false
    monitor.pathUpdateHandler = nil
    monitor.cancel()
  }

  private func withSnapshot<T>(_ block: (NetworkSnapshot) -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return block(latestSnapshot)
  }

  private func updateSnapshot(_ snapshot: NetworkSnapshot) {
    lock.lock()
    defer { lock.unlock() }
    latestSnapshot = snapshot
  }

  private func handlePathUpdate(_ path: NWPath) {
    let snapshot = NetworkSnapshot(
      isConnected: path.status == .satisfied,
      isInternetReachable: path.status == .satisfied,
      type: resolveType(path),
      isExpensive: path.isExpensive
    )

    let previous = withSnapshot { $0 }
    guard previous != snapshot else { return }
    updateSnapshot(snapshot)
    runtime?.emitEvent(name: networkEventName, payload: snapshot.toDictionary())
  }

  private func resolveType(_ path: NWPath) -> String {
    guard path.status == .satisfied else {
      return "none"
    }
    if path.usesInterfaceType(.wifi) {
      return "wifi"
    }
    if path.usesInterfaceType(.cellular) {
      return "cellular"
    }
    if path.usesInterfaceType(.wiredEthernet) {
      return "ethernet"
    }
    if path.usesInterfaceType(.loopback) {
      return "other"
    }
    if path.usesInterfaceType(.other) {
      return "other"
    }
    return "unknown"
  }
}
