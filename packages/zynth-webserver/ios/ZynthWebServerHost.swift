import Foundation

struct WebServerInfo {
  let host: String
  let port: Int
  let url: String
  let documentRoot: String?
  let uploadPath: String?
  let uploadMetadataPath: String?
  let eventsPath: String?
  let signalPath: String?
  let replyPath: String?

  func toDictionary() -> [String: Any] {
    return [
      "host": host,
      "port": port,
      "url": url,
      "documentRoot": documentRoot ?? NSNull(),
      "uploadPath": uploadPath ?? NSNull(),
      "uploadMetadataPath": uploadMetadataPath ?? NSNull(),
      "eventsPath": eventsPath ?? NSNull(),
      "signalPath": signalPath ?? NSNull(),
      "replyPath": replyPath ?? NSNull(),
    ]
  }
}

struct WebServerEvent {
  let type: String
  let payload: String

  func toDictionary() -> [String: Any] {
    return [
      "type": type,
      "payload": payload,
    ]
  }
}

struct WebServerUploadState {
  let activeCount: Int
  let totalStarted: Int64
  let totalCompleted: Int64
  let totalFailed: Int64
  let totalBytesReceived: Int64
  let activeUploads: [[String: Any]]

  static let empty = WebServerUploadState(
    activeCount: 0,
    totalStarted: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalBytesReceived: 0,
    activeUploads: []
  )

  func toDictionary() -> [String: Any] {
    return [
      "activeCount": activeCount,
      "totalStarted": totalStarted,
      "totalCompleted": totalCompleted,
      "totalFailed": totalFailed,
      "totalBytesReceived": totalBytesReceived,
      "activeUploads": activeUploads,
    ]
  }
}

final class ZynthWebServerHost {
  struct StartConfig {
    let host: String?
    let port: Int
    let documentRoot: String?
    let indexHtml: String?
    let uploadPath: String?
    let uploadDir: String?
    let uploadMetadataPath: String?
    let uploadAuthToken: String?
    let uploadAuthHeader: String?
    let uploadAuthQueryKey: String?
    let maxUploadBytes: Int64
    let eventsPath: String?
  }

  private var handle: UnsafeMutableRawPointer?
  private(set) var info: WebServerInfo?

  deinit {
    stop()
  }

  func start(config: StartConfig) throws -> WebServerInfo {
    stop()

    guard let server = ZynthWebServerBridge.start(
      withHost: config.host,
      port: config.port,
      documentRoot: config.documentRoot,
      indexHtml: config.indexHtml,
      uploadPath: config.uploadPath,
      uploadDir: config.uploadDir,
      uploadMetadataPath: config.uploadMetadataPath,
      uploadAuthToken: config.uploadAuthToken,
      uploadAuthHeader: config.uploadAuthHeader,
      uploadAuthQueryKey: config.uploadAuthQueryKey,
      maxUploadBytes: config.maxUploadBytes,
      eventsPath: config.eventsPath
    ) else {
      throw NSError(domain: "ZynthWebServer", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Failed to start web server",
      ])
    }

    handle = server
    let port = Int(ZynthWebServerBridge.port(server))
    let host = config.host ?? "0.0.0.0"
    let url = "http://\(host):\(port)"
    let info = WebServerInfo(
      host: host,
      port: port,
      url: url,
      documentRoot: config.documentRoot,
      uploadPath: config.uploadPath,
      uploadMetadataPath: config.uploadMetadataPath,
      eventsPath: config.eventsPath,
      signalPath: "/__zynth/signal",
      replyPath: "/__zynth/reply"
    )
    self.info = info
    return info
  }

  func stop() {
    if let server = handle {
      ZynthWebServerBridge.stop(server)
    }
    handle = nil
    info = nil
  }

  func isRunning() -> Bool {
    guard let server = handle else {
      return false
    }
    return ZynthWebServerBridge.isRunning(server)
  }

  func drainEvents(maxEvents: Int) -> [WebServerEvent] {
    guard let server = handle else {
      return []
    }
    if maxEvents <= 0 {
      return []
    }
    let payloads = ZynthWebServerBridge.drainEvents(server, maxEvents: maxEvents)
    return payloads.map { payload in
      let type = payload["type"] as? String ?? "message"
      let data = payload["payload"] as? String ?? ""
      return WebServerEvent(type: type, payload: data)
    }
  }

  func getUploadState() -> WebServerUploadState {
    guard let server = handle else {
      return .empty
    }
    guard let json = ZynthWebServerBridge.uploadStateJson(server),
      let data = json.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return .empty
    }

    return WebServerUploadState(
      activeCount: object["activeCount"] as? Int ?? 0,
      totalStarted: (object["totalStarted"] as? NSNumber)?.int64Value ?? 0,
      totalCompleted: (object["totalCompleted"] as? NSNumber)?.int64Value ?? 0,
      totalFailed: (object["totalFailed"] as? NSNumber)?.int64Value ?? 0,
      totalBytesReceived: (object["totalBytesReceived"] as? NSNumber)?.int64Value ?? 0,
      activeUploads: object["activeUploads"] as? [[String: Any]] ?? []
    )
  }

  func setReply(key: String, payloadJson: String) -> Bool {
    guard let server = handle else {
      return false
    }
    if key.isEmpty {
      return false
    }
    return ZynthWebServerBridge.setReply(server, key: key, payloadJson: payloadJson)
  }

  func getReply(key: String, consume: Bool) -> Any? {
    guard let server = handle else {
      return nil
    }
    if key.isEmpty {
      return nil
    }
    guard let json = ZynthWebServerBridge.getReplyJson(server, key: key, consume: consume),
      let data = json.data(using: .utf8)
    else {
      return nil
    }
    return try? JSONSerialization.jsonObject(with: data)
  }
}
