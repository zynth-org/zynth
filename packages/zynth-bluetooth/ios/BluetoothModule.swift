import CoreBluetooth
import Foundation
import ZynthKit

final class BluetoothModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Bluetooth"

  var exportedMethods: [String] {
    [
      "isClassicSupported",
      "isBleSupported",
      "isEnabled",
      "getPermissions",
      "requestPermissions",
      "startClassicDiscovery",
      "stopClassicDiscovery",
      "getClassicDiscoveredDevices",
      "connectClassic",
      "reconnectClassic",
      "disconnectClassic",
      "writeClassic",
      "readClassic",
      "getClassicConnections",
      "startBleScan",
      "stopBleScan",
      "getBleScannedDevices",
      "connectBle",
      "reconnectBle",
      "disconnectBle",
      "discoverBleServices",
      "readBleCharacteristic",
      "writeBleCharacteristic",
      "setBleNotification",
      "requestBleMtu",
      "readBleRssi",
      "getBleConnections",
      "isBlePeripheralSupported",
      "startBlePeripheral",
      "stopBlePeripheral",
      "getBlePeripheralState",
      "updateBlePeripheralCharacteristic",
    ]
  }

  var protectedMethods: [String] {
    exportedMethods
  }

  private weak var runtime: ZynthRuntime?
  private let queue = DispatchQueue(label: "dev.zynth.bluetooth.ios")
  private var centralManager: CBCentralManager?
  private var isScanning = false
  private var scannedDevices: [String: [String: Any]] = [:]
  private var discoveredPeripherals: [String: CBPeripheral] = [:]
  private var connectedByConnectionId: [String: BleConnection] = [:]
  private var connectionIdByPeripheralId: [String: String] = [:]
  private var pendingConnectByPeripheralId: [String: PendingConnect] = [:]
  private var pendingPermissionRequestId: String?
  private var pendingPermissionWorkItem: DispatchWorkItem?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
    queue.sync {
      self.centralManager = CBCentralManager(delegate: self, queue: self.queue)
    }
  }

  func invalidate() {
    queue.sync {
      pendingPermissionWorkItem?.cancel()
      pendingPermissionWorkItem = nil
      pendingPermissionRequestId = nil
      stopBleScanLocked()
      for connection in connectedByConnectionId.values {
        centralManager?.cancelPeripheralConnection(connection.peripheral)
      }
      connectedByConnectionId.removeAll()
      connectionIdByPeripheralId.removeAll()
      pendingConnectByPeripheralId.removeAll()
      scannedDevices.removeAll()
      discoveredPeripherals.removeAll()
    }
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "isClassicSupported":
      return success(false)
    case "isBleSupported":
      return success(isBleSupported())
    case "isEnabled":
      return success(isEnabled())
    case "getPermissions":
      return success(permissionsPayload())
    case "requestPermissions":
      return requestPermissions(args)

    case "startClassicDiscovery", "stopClassicDiscovery", "connectClassic", "reconnectClassic",
      "disconnectClassic", "writeClassic", "readClassic":
      return classicUnavailableResult()
    case "getClassicDiscoveredDevices", "getClassicConnections":
      return success([])

    case "startBleScan":
      return startBleScan(args)
    case "stopBleScan":
      return success(stopBleScan())
    case "getBleScannedDevices":
      return success(Array(scannedDevices.values))
    case "connectBle":
      return connectBle(args)
    case "reconnectBle":
      return reconnectBle(args)
    case "disconnectBle":
      return disconnectBle(args)
    case "discoverBleServices":
      return discoverBleServices(args)
    case "readBleCharacteristic":
      return readBleCharacteristic(args)
    case "writeBleCharacteristic":
      return writeBleCharacteristic(args)
    case "setBleNotification":
      return setBleNotification(args)
    case "requestBleMtu":
      return requestBleMtu(args)
    case "readBleRssi":
      return readBleRssi(args)
    case "getBleConnections":
      return success(connectedByConnectionId.values.map { $0.toDictionary() })
    case "isBlePeripheralSupported":
      return success(false)
    case "startBlePeripheral", "stopBlePeripheral", "updateBlePeripheralCharacteristic":
      return peripheralUnavailableResult()
    case "getBlePeripheralState":
      return success(defaultPeripheralState())
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args _: ZynthArgs) throws -> Any? {
    switch method {
    case "isClassicSupported":
      return false
    case "isBleSupported":
      return isBleSupported()
    case "isEnabled":
      return isEnabled()
    case "getPermissions":
      return permissionsPayload()
    case "isBlePeripheralSupported":
      return false
    case "getBlePeripheralState":
      return defaultPeripheralState()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func defaultPeripheralState() -> [String: Any] {
    return [
      "running": false,
      "localName": NSNull(),
      "serviceUuid": NSNull(),
      "characteristicUuid": NSNull(),
      "connectedCentralIds": [],
    ]
  }

  private func isBleSupported() -> Bool {
    return managerState() != .unsupported
  }

  private func isEnabled() -> Bool {
    return managerState() == .poweredOn
  }

  private func managerState() -> CBManagerState {
    return queue.sync {
      centralManager?.state ?? .unknown
    }
  }

  private func requestPermissions(_ args: ZynthArgs) -> [String: Any] {
    let requestId = args.string("requestId", default: "bt-\(Int(Date().timeIntervalSince1970))")
    let payload = permissionsPayload()
    if (payload["allGranted"] as? Bool) == true {
      return success(payload)
    }

    queue.async {
      self.pendingPermissionRequestId = requestId
      if self.centralManager == nil {
        self.centralManager = CBCentralManager(delegate: self, queue: self.queue)
      }
      if self.centralManager?.state == .poweredOn {
        self.centralManager?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        self.centralManager?.stopScan()
      }

      self.pendingPermissionWorkItem?.cancel()
      let workItem = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.emitPermissionResultIfNeeded()
      }
      self.pendingPermissionWorkItem = workItem
      self.queue.asyncAfter(deadline: .now() + 0.5, execute: workItem)
    }

    return success(["status": "pending"])
  }

  private func startBleScan(_ args: ZynthArgs) -> [String: Any] {
    guard isBleSupported() else {
      return failure("E_UNAVAILABLE", "BLE is unsupported on this device")
    }
    guard isEnabled() else {
      return failure("E_NOT_ENABLED", "Bluetooth is disabled")
    }
    let permissions = permissionsPayload()
    if (permissions["allGranted"] as? Bool) != true {
      return failure("E_PERMISSION_DENIED", "Bluetooth permission is not granted")
    }

    let allowDuplicates = args.bool("allowDuplicates", default: false)
    let serviceValues = (try? args.array("serviceUuids")) ?? []
    let namePrefix = args.string("namePrefix", default: "").trimmingCharacters(in: .whitespacesAndNewlines)

    var serviceUUIDs: [CBUUID] = []
    for entry in serviceValues {
      guard let stringValue = entry as? String else { continue }
      let normalized = normalizeUuid(stringValue)
      if !normalized.isEmpty {
        serviceUUIDs.append(CBUUID(string: normalized))
      }
    }

    queue.sync {
      if !allowDuplicates {
        scannedDevices.removeAll()
      }
      stopBleScanLocked()
      let options = [CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates]
      let withServices = serviceUUIDs.isEmpty ? nil : serviceUUIDs
      centralManager?.scanForPeripherals(withServices: withServices, options: options)
      isScanning = true
      emitBleEvent([
        "type": "scan_started",
        "timestamp": timestamp(),
      ])
      if !namePrefix.isEmpty {
        self.namePrefixFilter = namePrefix
      } else {
        self.namePrefixFilter = nil
      }
    }

    return success(true)
  }

  private func stopBleScan() -> Bool {
    return queue.sync {
      stopBleScanLocked()
      return true
    }
  }

  private func stopBleScanLocked() {
    if isScanning {
      centralManager?.stopScan()
      isScanning = false
      namePrefixFilter = nil
      emitBleEvent([
        "type": "scan_stopped",
        "timestamp": timestamp(),
      ])
    }
  }

  private func connectBle(_ args: ZynthArgs) -> [String: Any] {
    guard isBleSupported() else {
      return failure("E_UNAVAILABLE", "BLE is unsupported on this device")
    }
    guard isEnabled() else {
      return failure("E_NOT_ENABLED", "Bluetooth is disabled")
    }

    let permissions = permissionsPayload()
    if (permissions["allGranted"] as? Bool) != true {
      return failure("E_PERMISSION_DENIED", "Bluetooth permission is not granted")
    }

    let deviceId = args.string("deviceId", default: "")
    if deviceId.isEmpty {
      return failure("E_INVALID_ARGUMENT", "deviceId is required")
    }
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 15000)))

    let result = waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        guard let peripheral = self.resolvePeripheral(deviceId: deviceId) else {
          completion(.failure("E_NOT_FOUND", "BLE device not found: \(deviceId)"))
          return
        }

        let peripheralId = peripheral.identifier.uuidString
        let pending = PendingConnect(completion: completion)
        self.pendingConnectByPeripheralId[peripheralId] = pending
        peripheral.delegate = self
        self.centralManager?.connect(peripheral, options: nil)
      }
    }

    return result
  }

  private func reconnectBle(_ args: ZynthArgs) -> [String: Any] {
    let policy = (try? args.dict("policy")) ?? [:]
    let maxAttempts = max(1, (policy["maxAttempts"] as? NSNumber)?.intValue ?? 4)
    let initialDelayMs = max(100, (policy["initialDelayMs"] as? NSNumber)?.intValue ?? 500)
    let maxDelayMs = max(100, (policy["maxDelayMs"] as? NSNumber)?.intValue ?? 5000)
    let multiplier = max(1.0, (policy["backoffMultiplier"] as? NSNumber)?.doubleValue ?? 1.7)

    var delayMs = initialDelayMs
    var lastFailure = failure("E_IO", "BLE reconnect failed")

    for attempt in 0..<maxAttempts {
      let result = connectBle(args)
      if (result["ok"] as? Bool) == true {
        return result
      }
      lastFailure = result
      if attempt < (maxAttempts - 1) {
        Thread.sleep(forTimeInterval: Double(delayMs) / 1000.0)
        delayMs = min(maxDelayMs, Int(Double(delayMs) * multiplier))
      }
    }
    return lastFailure
  }

  private func disconnectBle(_ args: ZynthArgs) -> [String: Any] {
    let connectionId = args.string("connectionId", default: "")
    if connectionId.isEmpty {
      return failure("E_INVALID_ARGUMENT", "connectionId is required")
    }

    return queue.sync {
      guard let connection = connectedByConnectionId[connectionId] else {
        return failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)")
      }
      centralManager?.cancelPeripheralConnection(connection.peripheral)
      connection.connected = false
      emitBleConnectionState(connection)
      return success(true)
    }
  }

  private func discoverBleServices(_ args: ZynthArgs) -> [String: Any] {
    let connectionId = args.string("connectionId", default: "")
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 10000)))
    guard !connectionId.isEmpty else {
      return failure("E_INVALID_ARGUMENT", "connectionId is required")
    }

    return waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        guard let connection = self.connectedByConnectionId[connectionId] else {
          completion(.failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)"))
          return
        }
        connection.pendingServiceDiscovery = completion
        connection.peripheral.discoverServices(nil)
      }
    }
  }

  private func readBleCharacteristic(_ args: ZynthArgs) -> [String: Any] {
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 10000)))
    let withCharacteristic = resolveCharacteristic(args, timeoutMs: timeoutMs)
    guard case .success(let resolved) = withCharacteristic else {
      if case .failure(let code, let message) = withCharacteristic {
        return failure(code, message)
      }
      return failure("E_NATIVE", "Failed to resolve characteristic")
    }

    return waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        resolved.connection.pendingRead = PendingRead(
          characteristicId: resolved.characteristicId,
          completion: completion
        )
        resolved.connection.peripheral.readValue(for: resolved.characteristic)
      }
    }
  }

  private func writeBleCharacteristic(_ args: ZynthArgs) -> [String: Any] {
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 10000)))
    let withResponse = args.bool("withResponse", default: true)
    let dataBase64 = args.string("dataBase64", default: "")
    guard !dataBase64.isEmpty, let data = Data(base64Encoded: dataBase64) else {
      return failure("E_INVALID_ARGUMENT", "Invalid base64 payload")
    }

    let withCharacteristic = resolveCharacteristic(args, timeoutMs: timeoutMs)
    guard case .success(let resolved) = withCharacteristic else {
      if case .failure(let code, let message) = withCharacteristic {
        return failure(code, message)
      }
      return failure("E_NATIVE", "Failed to resolve characteristic")
    }

    let writeType: CBCharacteristicWriteType = withResponse ? .withResponse : .withoutResponse
    if withResponse {
      return waitResult(timeoutMs: timeoutMs) { completion in
        queue.async {
          resolved.connection.pendingWrite = PendingWrite(
            characteristicId: resolved.characteristicId,
            completion: completion
          )
          resolved.connection.peripheral.writeValue(data, for: resolved.characteristic, type: writeType)
        }
      }
    }

    queue.sync {
      resolved.connection.peripheral.writeValue(data, for: resolved.characteristic, type: writeType)
    }
    return success(true)
  }

  private func setBleNotification(_ args: ZynthArgs) -> [String: Any] {
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 10000)))
    let enabled = args.bool("enabled", default: true)
    let withCharacteristic = resolveCharacteristic(args, timeoutMs: timeoutMs)
    guard case .success(let resolved) = withCharacteristic else {
      if case .failure(let code, let message) = withCharacteristic {
        return failure(code, message)
      }
      return failure("E_NATIVE", "Failed to resolve characteristic")
    }

    return waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        resolved.connection.pendingNotify = PendingNotify(
          characteristicId: resolved.characteristicId,
          completion: completion
        )
        resolved.connection.peripheral.setNotifyValue(enabled, for: resolved.characteristic)
      }
    }
  }

  private func requestBleMtu(_ args: ZynthArgs) -> [String: Any] {
    let connectionId = args.string("connectionId", default: "")
    let requestedMtu = max(23, min(517, Int(args.number("mtu", default: 247))))
    guard !connectionId.isEmpty else {
      return failure("E_INVALID_ARGUMENT", "connectionId is required")
    }

    return queue.sync {
      guard let connection = connectedByConnectionId[connectionId] else {
        return failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)")
      }
      let estimated = connection.estimatedMtu()
      let negotiated = max(23, min(requestedMtu, estimated))
      connection.mtu = negotiated
      return success(negotiated)
    }
  }

  private func readBleRssi(_ args: ZynthArgs) -> [String: Any] {
    let connectionId = args.string("connectionId", default: "")
    let timeoutMs = max(1000, Int(args.number("timeoutMs", default: 10000)))
    guard !connectionId.isEmpty else {
      return failure("E_INVALID_ARGUMENT", "connectionId is required")
    }

    return waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        guard let connection = self.connectedByConnectionId[connectionId] else {
          completion(.failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)"))
          return
        }
        connection.pendingRssi = completion
        connection.peripheral.readRSSI()
      }
    }
  }

  private enum ResolvedCharacteristic {
    case success(CharacteristicResolution)
    case failure(String, String)
  }

  private struct CharacteristicResolution {
    let connection: BleConnection
    let characteristic: CBCharacteristic
    let characteristicId: String
  }

  private func resolveCharacteristic(_ args: ZynthArgs, timeoutMs: Int) -> ResolvedCharacteristic {
    let connectionId = args.string("connectionId", default: "")
    let serviceUuid = args.string("serviceUuid", default: "")
    let characteristicUuid = args.string("characteristicUuid", default: "")
    if connectionId.isEmpty || serviceUuid.isEmpty || characteristicUuid.isEmpty {
      return .failure("E_INVALID_ARGUMENT", "connectionId, serviceUuid and characteristicUuid are required")
    }

    let serviceId = normalizeUuid(serviceUuid)
    let characteristicId = normalizeUuid(characteristicUuid)
    if serviceId.isEmpty || characteristicId.isEmpty {
      return .failure("E_INVALID_ARGUMENT", "serviceUuid or characteristicUuid is invalid")
    }

    let fastPath = queue.sync { () -> CharacteristicResolution? in
      guard let connection = connectedByConnectionId[connectionId] else { return nil }
      let key = makeCharacteristicKey(serviceId: serviceId, characteristicId: characteristicId)
      guard let characteristic = connection.characteristicsByKey[key] else { return nil }
      return CharacteristicResolution(connection: connection, characteristic: characteristic, characteristicId: characteristicId)
    }
    if let resolved = fastPath {
      return .success(resolved)
    }

    let serviceDiscoverResult = waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        guard let connection = self.connectedByConnectionId[connectionId] else {
          completion(.failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)"))
          return
        }
        connection.pendingServiceLookup = PendingServiceLookup(
          expectedServiceId: serviceId,
          completion: completion
        )
        connection.peripheral.discoverServices([CBUUID(string: serviceId)])
      }
    }
    if (serviceDiscoverResult["ok"] as? Bool) != true {
      return .failure(
        serviceDiscoverResult["code"] as? String ?? "E_NATIVE",
        serviceDiscoverResult["message"] as? String ?? "Failed to discover service"
      )
    }

    let characteristicDiscoverResult = waitResult(timeoutMs: timeoutMs) { completion in
      queue.async {
        guard let connection = self.connectedByConnectionId[connectionId] else {
          completion(.failure("E_NOT_FOUND", "BLE connection not found: \(connectionId)"))
          return
        }
        guard let service = connection.servicesById[serviceId] else {
          completion(.failure("E_NOT_FOUND", "BLE service not found: \(serviceId)"))
          return
        }
        connection.pendingCharacteristicLookup = PendingCharacteristicLookup(
          expectedServiceId: serviceId,
          expectedCharacteristicId: characteristicId,
          completion: completion
        )
        connection.peripheral.discoverCharacteristics([CBUUID(string: characteristicId)], for: service)
      }
    }
    if (characteristicDiscoverResult["ok"] as? Bool) != true {
      return .failure(
        characteristicDiscoverResult["code"] as? String ?? "E_NATIVE",
        characteristicDiscoverResult["message"] as? String ?? "Failed to discover characteristic"
      )
    }

    let resolved = queue.sync { () -> CharacteristicResolution? in
      guard let connection = connectedByConnectionId[connectionId] else { return nil }
      let key = makeCharacteristicKey(serviceId: serviceId, characteristicId: characteristicId)
      guard let characteristic = connection.characteristicsByKey[key] else { return nil }
      return CharacteristicResolution(connection: connection, characteristic: characteristic, characteristicId: characteristicId)
    }
    guard let resolved else {
      return .failure("E_NOT_FOUND", "BLE characteristic not found")
    }
    return .success(resolved)
  }

  private func permissionsPayload() -> [String: Any] {
    let granted = bluetoothAuthorizationGranted()
    return [
      "bluetoothScan": granted,
      "bluetoothConnect": granted,
      "bluetoothAdvertise": granted,
      "location": true,
      "allGranted": granted,
    ]
  }

  private func bluetoothAuthorizationGranted() -> Bool {
    if #available(iOS 13.1, *) {
      return CBManager.authorization == .allowedAlways
    }
    return true
  }

  private var namePrefixFilter: String?

  private func resolvePeripheral(deviceId: String) -> CBPeripheral? {
    if let existing = discoveredPeripherals[deviceId] {
      return existing
    }
    guard let uuid = UUID(uuidString: deviceId), let manager = centralManager else {
      return nil
    }
    let peripherals = manager.retrievePeripherals(withIdentifiers: [uuid])
    if let peripheral = peripherals.first {
      discoveredPeripherals[deviceId] = peripheral
      return peripheral
    }
    return nil
  }

  private func makeConnectionId(for peripheral: CBPeripheral) -> String {
    return "ble-\(Int(Date().timeIntervalSince1970 * 1000))-\(peripheral.identifier.uuidString.lowercased())"
  }

  private func makeCharacteristicKey(serviceId: String, characteristicId: String) -> String {
    return "\(serviceId.lowercased())|\(characteristicId.lowercased())"
  }

  private func normalizeUuid(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return ""
    }
    if trimmed.count == 4 {
      return "0000\(trimmed.lowercased())-0000-1000-8000-00805f9b34fb"
    }
    return trimmed.lowercased()
  }

  private func waitResult(
    timeoutMs: Int,
    start: (@escaping (AsyncResult) -> Void) -> Void
  ) -> [String: Any] {
    let semaphore = DispatchSemaphore(value: 0)
    var result: AsyncResult = .failure("E_NATIVE", "Operation failed")
    start { completion in
      result = completion
      semaphore.signal()
    }

    let status = semaphore.wait(timeout: .now() + .milliseconds(timeoutMs))
    if status == .timedOut {
      return failure("E_TIMEOUT", "Operation timed out")
    }

    switch result {
    case .success(let value):
      return success(value)
    case .failure(let code, let message):
      return failure(code, message)
    }
  }

  private func emitPermissionResultIfNeeded() {
    guard let requestId = pendingPermissionRequestId else {
      return
    }
    pendingPermissionRequestId = nil
    runtime?.emitEvent(
      name: "Bluetooth.permissionResult",
      payload: [
        "requestId": requestId,
        "ok": true,
        "data": permissionsPayload(),
      ]
    )
  }

  private func emitBleConnectionState(_ connection: BleConnection) {
    emitBleEvent([
      "type": "connection_state",
      "timestamp": timestamp(),
      "connection": connection.toDictionary(),
    ])
  }

  private func emitBleEvent(_ payload: [String: Any]) {
    runtime?.emitEvent(name: "Bluetooth.bleEvent", payload: payload)
  }

  private func emitBleError(_ code: String, _ message: String) {
    emitBleEvent([
      "type": "error",
      "timestamp": timestamp(),
      "code": code,
      "message": message,
    ])
  }

  private func classicUnavailableResult() -> [String: Any] {
    return failure(
      "E_UNAVAILABLE",
      "Bluetooth Classic is unavailable on iOS. MFi-compliant accessories and Apple-approved protocols are required."
    )
  }

  private func peripheralUnavailableResult() -> [String: Any] {
    return failure(
      "E_UNAVAILABLE",
      "BLE peripheral mode is not available in this iOS module build."
    )
  }

  private func success(_ data: Any) -> [String: Any] {
    return [
      "ok": true,
      "data": data,
    ]
  }

  private func failure(_ code: String, _ message: String) -> [String: Any] {
    return [
      "ok": false,
      "code": code,
      "message": message,
    ]
  }

  private func timestamp() -> Int64 {
    return Int64(Date().timeIntervalSince1970 * 1000)
  }
}

extension BluetoothModule: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state != .poweredOn && isScanning {
      _ = stopBleScan()
    }
    emitPermissionResultIfNeeded()
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData _: [String: Any], rssi RSSI: NSNumber) {
    let peripheralId = peripheral.identifier.uuidString
    let name: Any = peripheral.name ?? NSNull()
    if let prefix = namePrefixFilter, !prefix.isEmpty {
      if let peripheralName = peripheral.name, peripheralName.hasPrefix(prefix) {
        // keep
      } else {
        return
      }
    }

    discoveredPeripherals[peripheralId] = peripheral
    scannedDevices[peripheralId] = [
      "id": peripheralId,
      "name": name,
      "address": peripheralId,
      "rssi": RSSI.intValue,
      "bondState": NSNull(),
      "type": NSNull(),
    ]

    emitBleEvent([
      "type": "scan_result",
      "timestamp": timestamp(),
      "device": scannedDevices[peripheralId] ?? [:],
    ])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let peripheralId = peripheral.identifier.uuidString
    guard let pending = pendingConnectByPeripheralId.removeValue(forKey: peripheralId) else {
      return
    }

    let connectionId = connectionIdByPeripheralId[peripheralId] ?? makeConnectionId(for: peripheral)
    let connection = BleConnection(connectionId: connectionId, peripheral: peripheral)
    connection.connected = true
    connection.mtu = connection.estimatedMtu()

    connectedByConnectionId[connectionId] = connection
    connectionIdByPeripheralId[peripheralId] = connectionId

    emitBleConnectionState(connection)
    pending.completion(.success(connection.toDictionary()))
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let peripheralId = peripheral.identifier.uuidString
    guard let pending = pendingConnectByPeripheralId.removeValue(forKey: peripheralId) else {
      return
    }
    let message = error?.localizedDescription ?? "BLE connection failed"
    pending.completion(.failure("E_IO", message))
    emitBleError("E_IO", message)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let peripheralId = peripheral.identifier.uuidString
    guard let connectionId = connectionIdByPeripheralId.removeValue(forKey: peripheralId),
          let connection = connectedByConnectionId.removeValue(forKey: connectionId) else {
      return
    }

    connection.connected = false
    if let error {
      connection.lastError = error.localizedDescription
      emitBleError("E_IO", error.localizedDescription)
    }
    emitBleConnectionState(connection)
  }
}

extension BluetoothModule: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId] else {
      return
    }
    if let error {
      let message = error.localizedDescription
      connection.pendingServiceDiscovery?(.failure("E_IO", message))
      connection.pendingServiceLookup?.completion(.failure("E_IO", message))
      connection.pendingServiceDiscovery = nil
      connection.pendingServiceLookup = nil
      return
    }

    for service in peripheral.services ?? [] {
      let serviceId = service.uuid.uuidString.lowercased()
      connection.servicesById[serviceId] = service
    }

    if let pendingLookup = connection.pendingServiceLookup {
      connection.pendingServiceLookup = nil
      if connection.servicesById[pendingLookup.expectedServiceId] != nil {
        pendingLookup.completion(.success(true))
      } else {
        pendingLookup.completion(.failure("E_NOT_FOUND", "BLE service not found: \(pendingLookup.expectedServiceId)"))
      }
    }

    if let pending = connection.pendingServiceDiscovery {
      connection.pendingServiceDiscovery = nil
      let services = connection.servicesById.keys.sorted()
      pending(.success(services))
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId] else {
      return
    }
    if let error {
      let message = error.localizedDescription
      connection.pendingCharacteristicLookup?.completion(.failure("E_IO", message))
      connection.pendingCharacteristicLookup = nil
      return
    }

    let serviceId = service.uuid.uuidString.lowercased()
    for characteristic in service.characteristics ?? [] {
      let characteristicId = characteristic.uuid.uuidString.lowercased()
      let key = makeCharacteristicKey(serviceId: serviceId, characteristicId: characteristicId)
      connection.characteristicsByKey[key] = characteristic
    }

    if let pending = connection.pendingCharacteristicLookup {
      connection.pendingCharacteristicLookup = nil
      let key = makeCharacteristicKey(serviceId: pending.expectedServiceId, characteristicId: pending.expectedCharacteristicId)
      if connection.characteristicsByKey[key] != nil {
        pending.completion(.success(true))
      } else {
        pending.completion(.failure("E_NOT_FOUND", "BLE characteristic not found: \(pending.expectedCharacteristicId)"))
      }
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId] else {
      return
    }
    let serviceId = characteristic.service?.uuid.uuidString.lowercased() ?? ""
    let characteristicId = characteristic.uuid.uuidString.lowercased()
    let key = makeCharacteristicKey(serviceId: serviceId, characteristicId: characteristicId)

    if let pendingRead = connection.pendingRead, pendingRead.characteristicId == characteristicId {
      connection.pendingRead = nil
      if let error {
        pendingRead.completion(.failure("E_IO", error.localizedDescription))
        return
      }
      let data = characteristic.value ?? Data()
      pendingRead.completion(.success(data.base64EncodedString()))
      return
    }

    if let error {
      emitBleError("E_IO", error.localizedDescription)
      return
    }

    let data = characteristic.value ?? Data()
    emitBleEvent([
      "type": "characteristic_changed",
      "timestamp": timestamp(),
      "connectionId": connectionId,
      "serviceUuid": serviceId,
      "characteristicUuid": characteristicId,
      "dataBase64": data.base64EncodedString(),
    ])

    if connection.characteristicsByKey[key] == nil {
      connection.characteristicsByKey[key] = characteristic
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId],
          let pendingWrite = connection.pendingWrite else {
      return
    }
    let characteristicId = characteristic.uuid.uuidString.lowercased()
    guard pendingWrite.characteristicId == characteristicId else {
      return
    }
    connection.pendingWrite = nil

    if let error {
      pendingWrite.completion(.failure("E_IO", error.localizedDescription))
    } else {
      pendingWrite.completion(.success(true))
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId],
          let pendingNotify = connection.pendingNotify else {
      return
    }
    let characteristicId = characteristic.uuid.uuidString.lowercased()
    guard pendingNotify.characteristicId == characteristicId else {
      return
    }
    connection.pendingNotify = nil

    if let error {
      pendingNotify.completion(.failure("E_IO", error.localizedDescription))
    } else {
      pendingNotify.completion(.success(true))
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
    guard let connectionId = connectionIdByPeripheralId[peripheral.identifier.uuidString],
          let connection = connectedByConnectionId[connectionId],
          let pendingRssi = connection.pendingRssi else {
      return
    }
    connection.pendingRssi = nil

    if let error {
      pendingRssi(.failure("E_IO", error.localizedDescription))
    } else {
      pendingRssi(.success(RSSI.intValue))
    }
  }
}

private enum AsyncResult {
  case success(Any)
  case failure(String, String)
}

private final class PendingConnect {
  let completion: (AsyncResult) -> Void

  init(completion: @escaping (AsyncResult) -> Void) {
    self.completion = completion
  }
}

private final class PendingServiceLookup {
  let expectedServiceId: String
  let completion: (AsyncResult) -> Void

  init(expectedServiceId: String, completion: @escaping (AsyncResult) -> Void) {
    self.expectedServiceId = expectedServiceId
    self.completion = completion
  }
}

private final class PendingCharacteristicLookup {
  let expectedServiceId: String
  let expectedCharacteristicId: String
  let completion: (AsyncResult) -> Void

  init(
    expectedServiceId: String,
    expectedCharacteristicId: String,
    completion: @escaping (AsyncResult) -> Void
  ) {
    self.expectedServiceId = expectedServiceId
    self.expectedCharacteristicId = expectedCharacteristicId
    self.completion = completion
  }
}

private final class PendingRead {
  let characteristicId: String
  let completion: (AsyncResult) -> Void

  init(characteristicId: String, completion: @escaping (AsyncResult) -> Void) {
    self.characteristicId = characteristicId
    self.completion = completion
  }
}

private final class PendingWrite {
  let characteristicId: String
  let completion: (AsyncResult) -> Void

  init(characteristicId: String, completion: @escaping (AsyncResult) -> Void) {
    self.characteristicId = characteristicId
    self.completion = completion
  }
}

private final class PendingNotify {
  let characteristicId: String
  let completion: (AsyncResult) -> Void

  init(characteristicId: String, completion: @escaping (AsyncResult) -> Void) {
    self.characteristicId = characteristicId
    self.completion = completion
  }
}

private final class BleConnection {
  let connectionId: String
  let peripheral: CBPeripheral
  var connected = true
  var mtu = 23
  var lastError: String?
  var servicesById: [String: CBService] = [:]
  var characteristicsByKey: [String: CBCharacteristic] = [:]
  var pendingServiceDiscovery: ((AsyncResult) -> Void)?
  var pendingServiceLookup: PendingServiceLookup?
  var pendingCharacteristicLookup: PendingCharacteristicLookup?
  var pendingRead: PendingRead?
  var pendingWrite: PendingWrite?
  var pendingNotify: PendingNotify?
  var pendingRssi: ((AsyncResult) -> Void)?

  init(connectionId: String, peripheral: CBPeripheral) {
    self.connectionId = connectionId
    self.peripheral = peripheral
  }

  func estimatedMtu() -> Int {
    let writeLength = peripheral.maximumWriteValueLength(for: .withoutResponse)
    return max(23, min(517, writeLength + 3))
  }

  func toDictionary() -> [String: Any] {
    return [
      "connectionId": connectionId,
      "deviceId": peripheral.identifier.uuidString,
      "name": peripheral.name as Any? ?? NSNull(),
      "connected": connected,
      "mtu": mtu,
      "lastError": lastError as Any? ?? NSNull(),
    ]
  }
}
