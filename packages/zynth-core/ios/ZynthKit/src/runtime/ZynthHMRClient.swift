import Foundation

final class ZynthHMRClient: NSObject, URLSessionWebSocketDelegate {
  private weak var runtime: ZynthRuntime?
  private var baseURL: URL
  private var token: String?
  private var session: URLSession!
  private var socket: URLSessionWebSocketTask?
  private var reconnectWorkItem: DispatchWorkItem?
  private var reconnectAttempts: Int = 0
  private var pingTimer: DispatchSourceTimer?
  private let queue = DispatchQueue(label: "dev.zynth.hmr")
  private var stopped = false

  init(url: URL, runtime: ZynthRuntime, token: String?) {
    self.baseURL = url
    self.token = token
    self.runtime = runtime
    super.init()
    let configuration = URLSessionConfiguration.default
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 30
    self.session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }

  func updateConfiguration(url: URL, token: String?) {
    queue.async { [weak self] in
      guard let self else { return }
      self.baseURL = url
      self.token = token
      self.stopped = false
    }
  }

  func connect() {
    queue.async { [weak self] in
      guard let self else { return }
      self.stopped = false
      self.reconnectWorkItem?.cancel()
      self.openSocket()
    }
  }

  func disconnect() {
    queue.async { [weak self] in
      guard let self else { return }
      self.stopped = true
      self.reconnectWorkItem?.cancel()
      self.stopPingTimer()
      self.socket?.cancel(with: .goingAway, reason: nil)
      self.socket = nil
      self.session.invalidateAndCancel()
    }
  }

  private func openSocket() {
    guard let socketURL = makeWebSocketURL(from: baseURL, token: token) else {
      print("[ZynthHMRClient] ❌ Invalid dev server URL: \(baseURL.absoluteString)")
      return
    }
    print("[ZynthHMRClient] 🔌 Opening WebSocket: \(socketURL.absoluteString)")
    socket?.cancel(with: .goingAway, reason: nil)
    socket = session.webSocketTask(with: socketURL)
    socket?.resume()
  }

  private func makeWebSocketURL(from url: URL, token: String?) -> URL? {
    guard let host = url.host else { return nil }
    var components = URLComponents()
    let scheme = (url.scheme ?? "http").lowercased()
    components.scheme = (scheme == "https" || scheme == "wss") ? "wss" : "ws"
    components.host = host
    components.port = url.port
    components.path = "/rsbuild-hmr"
    if let token = token, !token.isEmpty {
      components.queryItems = [URLQueryItem(name: "token", value: token)]
    }
    return components.url
  }

  private func receiveNextMessage() {
    guard let socket else { return }
    socket.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure(let error):
        print("[ZynthHMRClient] receive error: \(error.localizedDescription)")
        self.scheduleReconnect()
      case .success(let message):
        switch message {
        case .string(let text):
          print("[ZynthHMRClient] 📩 message (string, \(text.count) chars)")
          self.runtime?.handleDevMessage(text)
        case .data(let data):
          if let text = String(data: data, encoding: .utf8) {
            print("[ZynthHMRClient] 📩 message (data, \(data.count) bytes)")
            self.runtime?.handleDevMessage(text)
          }
        @unknown default:
          break
        }
        self.receiveNextMessage()
      }
    }
  }

  private func sendHello() {
    guard let socket else { return }
    let payload: [String: Any] = [
      "type": "custom",
      "event": "zynth:hello",
      "data": [
        "platform": "ios",
        "timestamp": Date().timeIntervalSince1970 * 1000,
      ],
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
      let json = String(data: data, encoding: .utf8)
    {
      socket.send(.string(json)) { error in
        if let error {
          print("[ZynthHMRClient] ❌ Failed to send hello: \(error.localizedDescription)")
        }
      }
    }
  }

  private func sendPing() {
    guard let socket else { return }
    socket.sendPing { error in
      if let error {
        print("[ZynthHMRClient] ping failed: \(error.localizedDescription)")
        self.scheduleReconnect()
      }
    }
  }

  private func startPingTimer() {
    stopPingTimer()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .seconds(5), repeating: .seconds(15))
    timer.setEventHandler { [weak self] in
      self?.sendPing()
    }
    pingTimer = timer
    timer.resume()
  }

  private func stopPingTimer() {
    pingTimer?.cancel()
    pingTimer = nil
  }

  private func scheduleReconnect() {
    guard !stopped else { return }
    reconnectWorkItem?.cancel()
    stopPingTimer()
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    let cappedAttempts = min(reconnectAttempts, 6)
    let delay = pow(2.0, Double(cappedAttempts)) * 0.5
    reconnectAttempts += 1
    let workItem = DispatchWorkItem { [weak self] in
      self?.openSocket()
    }
    reconnectWorkItem = workItem
    queue.asyncAfter(deadline: .now() + delay, execute: workItem)
  }

  // MARK: - URLSessionWebSocketDelegate

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    queue.async { [weak self] in
      guard let self else { return }
      self.reconnectAttempts = 0
      self.startPingTimer()
      let urlString = webSocketTask.currentRequest?.url?.absoluteString ?? "<unknown>"
      print("[ZynthHMRClient] ✅ WebSocket connected to \(urlString)")
      self.sendHello()
      self.receiveNextMessage()
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    queue.async { [weak self] in
      let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) } ?? "none"
      print("[ZynthHMRClient] ⚠️ WebSocket closed (code: \(closeCode.rawValue), reason: \(reasonString))")
      self?.scheduleReconnect()
    }
  }
}
