import Foundation

final class ZynthDevtoolsModule: ZynthModule {
  let name: String = "Devtools"

#if DEBUG
  private let client = ZynthDevtoolsClient()
#endif

  func initialize() {
#if DEBUG
    let env = ProcessInfo.processInfo.environment
    if let urlString = env["ZYNTH_DEVTOOLS_URL"], let url = URL(string: urlString) {
      let token = env["ZYNTH_DEVTOOLS_TOKEN"]
      client.connect(url: url, token: token)
    }
#endif
  }

  func invalidate() {
#if DEBUG
    client.disconnect()
#endif
  }

  func call(method: String, args: Any?) throws -> Any? {
#if DEBUG
    switch method {
    case "connect":
      guard let payload = args as? [String: Any] else {
        return ["error": "invalid_arguments"]
      }
      guard let urlString = payload["url"] as? String, let url = URL(string: urlString) else {
        return ["error": "invalid_url"]
      }
      let token = payload["token"] as? String
      client.connect(url: url, token: token)
      return ["result": true]
    case "emit":
      guard var event = args as? [String: Any] else {
        return ["error": "invalid_arguments"]
      }
      if event["topic"] == nil {
        return ["error": "missing_topic"]
      }
      client.publish(event: event)
      return ["result": true]
    case "isConnected":
      return ["result": client.isConnected]
    default:
      return ["error": "unknown_method", "method": method]
    }
#else
    return ["result": false]
#endif
  }
}

#if DEBUG
final class ZynthDevtoolsClient: NSObject {
  private let queue = DispatchQueue(label: "dev.zynth.devtools")
  private var session: URLSession!
  private var socket: URLSessionWebSocketTask?
  private var baseURL: URL?
  private var token: String?
  private var pending: [String] = []
  private var stopped = false
  private let maxQueue = 256

  var isConnected: Bool {
    return socket?.state == .running
  }

  override init() {
    super.init()
    let configuration = URLSessionConfiguration.default
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 30
    session = URLSession(configuration: configuration, delegate: nil, delegateQueue: nil)
  }

  func connect(url: URL, token: String?) {
    queue.async { [weak self] in
      guard let self else { return }
      self.baseURL = url
      self.token = token
      self.stopped = false
      self.openSocket()
    }
  }

  func disconnect() {
    queue.async { [weak self] in
      guard let self else { return }
      self.stopped = true
      self.socket?.cancel(with: .goingAway, reason: nil)
      self.socket = nil
    }
  }

  func publish(event: [String: Any]) {
    queue.async { [weak self] in
      guard let self else { return }
      let payload: [String: Any] = [
        "type": "pub",
        "event": event,
      ]
      guard
        let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let json = String(data: data, encoding: .utf8)
      else {
        return
      }
      self.enqueue(json)
      self.flushIfPossible()
    }
  }

  private func enqueue(_ message: String) {
    if pending.count >= maxQueue {
      pending.removeFirst()
    }
    pending.append(message)
  }

  private func flushIfPossible() {
    guard let socket, socket.state == .running else {
      return
    }
    while !pending.isEmpty {
      let message = pending.removeFirst()
      socket.send(.string(message)) { _ in }
    }
  }

  private func openSocket() {
    guard let baseURL else { return }
    guard let socketURL = makeWebSocketURL(from: baseURL, token: token) else { return }
    socket?.cancel(with: .goingAway, reason: nil)
    socket = session.webSocketTask(with: socketURL)
    socket?.resume()
    flushIfPossible()
    receiveNextMessage()
  }

  private func receiveNextMessage() {
    guard let socket else { return }
    socket.receive { [weak self] _ in
      guard let self else { return }
      self.receiveNextMessage()
    }
  }

  private func makeWebSocketURL(from url: URL, token: String?) -> URL? {
    guard let host = url.host else { return nil }
    var components = URLComponents()
    let lowercasedScheme = (url.scheme ?? "http").lowercased()
    components.scheme = (lowercasedScheme == "https" || lowercasedScheme == "wss") ? "wss" : "ws"
    components.host = host
    components.port = url.port
    components.path = url.path.isEmpty ? "/" : url.path
    if let token, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      components.queryItems = [
        URLQueryItem(name: "token", value: token),
      ]
    }
    return components.url
  }

}
#endif
