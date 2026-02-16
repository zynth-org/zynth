import CoreMotion
import Foundation
import ZynthKit

@objc(SensorsModule)
final class SensorsModule: NSObject, ZynthModule {
  let name: String = "Sensors"

  private let runtime: ZynthRuntime
  private let motionManager = CMMotionManager()
  private let pedometer = CMPedometer()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "dev.zynth.sensors.queue"
    return queue
  }()

  private var lastReadings: [String: [String: Any]] = [:]
  private var activeSensors = Set<String>()

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func invalidate() {
    stopAll()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "isAvailable":
      return isAvailable(sensorName(from: args))
    case "getPermissionStatus":
      return permissionStatus(sensorName(from: args))
    case "requestPermission":
      return requestPermission(args: args)
    case "startUpdates":
      return startUpdates(args: args)
    case "stopUpdates":
      stopUpdates(sensorName(from: args))
      return nil
    case "readCurrent":
      return readCurrent(sensorName(from: args)) ?? NSNull()
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  private func requestPermission(args: ZynthArgs) -> Any {
    let sensor = sensorName(from: args)
    guard isAvailable(sensor) else {
      return permissionStatusUnavailable()
    }

    let status = permissionStatus(sensor)
    if status["status"] as? String != "undetermined" {
      return status
    }

    let requestId = args.string("requestId", default: UUID().uuidString)

    if sensor == "pedometer" {
      let now = Date()
      pedometer.queryPedometerData(from: now, to: now) { [weak self] _, _ in
        guard let self else { return }
        let next = self.permissionStatus(sensor)
        self.emitPermission(requestId: requestId, permission: next)
      }
      return ["pending": true]
    }

    if motionManager.isDeviceMotionAvailable {
      motionManager.startDeviceMotionUpdates()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        guard let self else { return }
        self.motionManager.stopDeviceMotionUpdates()
        let next = self.permissionStatus(sensor)
        self.emitPermission(requestId: requestId, permission: next)
      }
      return ["pending": true]
    }

    return status
  }

  private func startUpdates(args: ZynthArgs) -> Bool {
    let sensor = sensorName(from: args)
    let intervalMs = max(10, Int(args.number("sampleIntervalMs", default: 100)))
    let interval = TimeInterval(intervalMs) / 1000.0

    guard isAvailable(sensor) else {
      return false
    }

    if activeSensors.contains(sensor) {
      return true
    }

    switch sensor {
    case "accelerometer":
      guard motionManager.isAccelerometerAvailable else { return false }
      motionManager.accelerometerUpdateInterval = interval
      motionManager.startAccelerometerUpdates(to: queue) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "x": data.acceleration.x,
          "y": data.acceleration.y,
          "z": data.acceleration.z,
        ])
      }
    case "barometer":
      guard CMAltimeter.isRelativeAltitudeAvailable() else { return false }
      let altimeter = CMAltimeter()
      altimeter.startRelativeAltitudeUpdates(to: queue) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "pressureKPa": data.pressure.doubleValue,
          "relativeAltitudeMeters": data.relativeAltitude.doubleValue,
        ])
      }
      lastReadings["__altimeter__"] = ["altimeter": altimeter]
    case "deviceMotion":
      guard motionManager.isDeviceMotionAvailable else { return false }
      motionManager.deviceMotionUpdateInterval = interval
      motionManager.startDeviceMotionUpdates(to: queue) { [weak self] data, _ in
        guard let self, let data else { return }

        let quaternion = data.attitude.quaternion
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "acceleration": [
            "x": data.userAcceleration.x,
            "y": data.userAcceleration.y,
            "z": data.userAcceleration.z,
          ],
          "gravity": [
            "x": data.gravity.x,
            "y": data.gravity.y,
            "z": data.gravity.z,
          ],
          "rotationRate": [
            "x": data.rotationRate.x,
            "y": data.rotationRate.y,
            "z": data.rotationRate.z,
          ],
          "attitude": [
            "pitch": data.attitude.pitch,
            "roll": data.attitude.roll,
            "yaw": data.attitude.yaw,
            "quaternion": [
              "x": quaternion.x,
              "y": quaternion.y,
              "z": quaternion.z,
              "w": quaternion.w,
            ],
          ],
        ])
      }
    case "gyroscope":
      guard motionManager.isGyroAvailable else { return false }
      motionManager.gyroUpdateInterval = interval
      motionManager.startGyroUpdates(to: queue) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "x": data.rotationRate.x,
          "y": data.rotationRate.y,
          "z": data.rotationRate.z,
        ])
      }
    case "magnetometer":
      guard motionManager.isMagnetometerAvailable else { return false }
      motionManager.magnetometerUpdateInterval = interval
      motionManager.startMagnetometerUpdates(to: queue) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "x": data.magneticField.x,
          "y": data.magneticField.y,
          "z": data.magneticField.z,
        ])
      }
    case "magnetometerUncalibrated":
      return false
    case "lightSensor":
      return false
    case "pedometer":
      guard CMPedometer.isStepCountingAvailable() else { return false }
      let startDate = Calendar.current.startOfDay(for: Date())
      pedometer.queryPedometerData(from: startDate, to: Date()) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "steps": data.numberOfSteps.doubleValue,
          "distanceMeters": data.distance?.doubleValue ?? NSNull(),
          "floorsAscended": data.floorsAscended?.doubleValue ?? NSNull(),
          "floorsDescended": data.floorsDescended?.doubleValue ?? NSNull(),
        ])
      }
      pedometer.startUpdates(from: Date()) { [weak self] data, _ in
        guard let self, let data else { return }
        self.emitReading(sensor: sensor, data: [
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "steps": data.numberOfSteps.doubleValue,
          "distanceMeters": data.distance?.doubleValue ?? NSNull(),
          "floorsAscended": data.floorsAscended?.doubleValue ?? NSNull(),
          "floorsDescended": data.floorsDescended?.doubleValue ?? NSNull(),
        ])
      }
    default:
      return false
    }

    activeSensors.insert(sensor)
    return true
  }

  private func stopUpdates(_ sensor: String) {
    guard activeSensors.contains(sensor) else {
      return
    }

    switch sensor {
    case "accelerometer":
      motionManager.stopAccelerometerUpdates()
    case "barometer":
      if let wrapped = lastReadings["__altimeter__"]?["altimeter"] as? CMAltimeter {
        wrapped.stopRelativeAltitudeUpdates()
      }
      lastReadings.removeValue(forKey: "__altimeter__")
    case "deviceMotion":
      motionManager.stopDeviceMotionUpdates()
    case "gyroscope":
      motionManager.stopGyroUpdates()
    case "magnetometer":
      motionManager.stopMagnetometerUpdates()
    case "pedometer":
      pedometer.stopUpdates()
    default:
      break
    }

    activeSensors.remove(sensor)
  }

  private func stopAll() {
    for sensor in activeSensors {
      stopUpdates(sensor)
    }
    activeSensors.removeAll()
  }

  private func readCurrent(_ sensor: String) -> [String: Any]? {
    return lastReadings[sensor]
  }

  private func isAvailable(_ sensor: String) -> Bool {
    switch sensor {
    case "accelerometer":
      return motionManager.isAccelerometerAvailable
    case "barometer":
      return CMAltimeter.isRelativeAltitudeAvailable()
    case "deviceMotion":
      return motionManager.isDeviceMotionAvailable
    case "gyroscope":
      return motionManager.isGyroAvailable
    case "lightSensor":
      return false
    case "magnetometer":
      return motionManager.isMagnetometerAvailable
    case "magnetometerUncalibrated":
      return false
    case "pedometer":
      return CMPedometer.isStepCountingAvailable()
    default:
      return false
    }
  }

  private func permissionStatus(_ sensor: String) -> [String: Any] {
    if !isAvailable(sensor) {
      return permissionStatusUnavailable()
    }

    if sensor == "pedometer" {
      if #available(iOS 11.0, *) {
        return permissionStatus(from: CMPedometer.authorizationStatus())
      }
      return ["status": "granted", "granted": true, "canAskAgain": false]
    }

    if sensor == "lightSensor" {
      return permissionStatusUnavailable()
    }

    return permissionStatus(from: CMMotionActivityManager.authorizationStatus())
  }

  private func permissionStatus(from status: CMAuthorizationStatus) -> [String: Any] {
    switch status {
    case .authorized:
      return ["status": "granted", "granted": true, "canAskAgain": false]
    case .denied:
      return ["status": "denied", "granted": false, "canAskAgain": false]
    case .restricted:
      return ["status": "restricted", "granted": false, "canAskAgain": false]
    case .notDetermined:
      return ["status": "undetermined", "granted": false, "canAskAgain": true]
    @unknown default:
      return permissionStatusUnavailable()
    }
  }

  private func permissionStatusUnavailable() -> [String: Any] {
    ["status": "unavailable", "granted": false, "canAskAgain": false]
  }

  private func emitReading(sensor: String, data: [String: Any]) {
    lastReadings[sensor] = data
    runtime.emitEvent(name: "Sensors.update", payload: [
      "sensor": sensor,
      "data": data,
    ])
  }

  private func emitPermission(requestId: String, permission: [String: Any]) {
    var payload = permission
    payload["requestId"] = requestId
    runtime.emitEvent(name: "Sensors.permission", payload: payload)
  }

  private func sensorName(from args: ZynthArgs) -> String {
    return args.string("sensor", default: "")
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    ["error": error, "message": message]
  }
}
