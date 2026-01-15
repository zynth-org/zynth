import Foundation

struct WebServerInfo {
  let host: String
  let port: Int
  let url: String
  let documentRoot: String?
  let uploadPath: String?
  let eventsPath: String?

  func toDictionary() -> [String: Any] {
    return [
      "host": host,
      "port": port,
      "url": url,
      "documentRoot": documentRoot ?? NSNull(),
      "uploadPath": uploadPath ?? NSNull(),
      "eventsPath": eventsPath ?? NSNull(),
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

final class RuneWebServerHost {
  struct StartConfig {
    let host: String?
    let port: Int
    let documentRoot: String?
    let indexHtml: String?
    let uploadPath: String?
    let uploadDir: String?
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

    guard let server = RuneWebServerBridge.start(
      withHost: config.host,
      port: config.port,
      documentRoot: config.documentRoot,
      indexHtml: config.indexHtml,
      uploadPath: config.uploadPath,
      uploadDir: config.uploadDir,
      maxUploadBytes: config.maxUploadBytes,
      eventsPath: config.eventsPath
    ) else {
      throw NSError(domain: "RuneWebServer", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Failed to start web server",
      ])
    }

    handle = server
    let port = Int(RuneWebServerBridge.port(server))
    let host = config.host ?? "0.0.0.0"
    let url = "http://\(host):\(port)"
    let info = WebServerInfo(
      host: host,
      port: port,
      url: url,
      documentRoot: config.documentRoot,
      uploadPath: config.uploadPath,
      eventsPath: config.eventsPath
    )
    self.info = info
    return info
  }

  func stop() {
    if let server = handle {
      RuneWebServerBridge.stop(server)
    }
    handle = nil
    info = nil
  }

  func isRunning() -> Bool {
    guard let server = handle else {
      return false
    }
    return RuneWebServerBridge.isRunning(server)
  }

  func drainEvents(maxEvents: Int) -> [WebServerEvent] {
    guard let server = handle else {
      return []
    }
    if maxEvents <= 0 {
      return []
    }
    let payloads = RuneWebServerBridge.drainEvents(server, maxEvents: maxEvents)
    return payloads.map { payload in
      let type = payload["type"] as? String ?? "message"
      let data = payload["payload"] as? String ?? ""
      return WebServerEvent(type: type, payload: data)
    }
  }
}
