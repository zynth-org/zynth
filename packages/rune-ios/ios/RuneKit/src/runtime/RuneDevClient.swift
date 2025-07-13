#if DEBUG
  import Foundation

  final class RuneDevClient: NSObject, URLSessionWebSocketDelegate {
    private weak var runtime: RuneRuntime?
    private var baseURL: URL
    private var token: String?
    private var session: URLSession!
    private var socket: URLSessionWebSocketTask?
    private var reconnectWorkItem: DispatchWorkItem?
    private var reconnectAttempts: Int = 0
    private var pingTimer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "dev.rune.websocket")
    private var stopped = false

    init(url: URL, runtime: RuneRuntime, token: String?) {
      self.baseURL = Self.normalize(url)
      self.token = Self.sanitizeToken(token)
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
        self.baseURL = Self.normalize(url)
        self.token = Self.sanitizeToken(token)
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
      guard let socketURL = makeWebSocketURL(from: baseURL) else {
        print("[RuneDevClient] ❌ Invalid dev server URL: \(baseURL.absoluteString)")
        return
      }

      print("[RuneDevClient] 🔌 Opening WebSocket connection to: \(socketURL.absoluteString)")
      socket?.cancel(with: .goingAway, reason: nil)
      socket = session.webSocketTask(with: socketURL)
      socket?.resume()
    }

    private func makeWebSocketURL(from url: URL) -> URL? {
      guard let host = url.host else { return nil }
      var components = URLComponents()
      let lowercasedScheme = (url.scheme ?? "http").lowercased()
      components.scheme = (lowercasedScheme == "https" || lowercasedScheme == "wss") ? "wss" : "ws"
      components.host = host
      components.port = url.port
      components.path = "/rsbuild-hmr"

      if let token = token {
        var items = components.queryItems ?? []
        let desiredItems = [
          URLQueryItem(name: "token", value: token)
        ]
        for item in desiredItems where !items.contains(where: { $0.name == item.name }) {
          items.append(item)
        }
        components.queryItems = items
      }

      return components.url
    }

    private func receiveNextMessage() {
      guard let socket else { return }
      socket.receive { [weak self] result in
        guard let self else { return }
        switch result {
        case .failure(let error):
          print("[RuneDevClient] receive error: \(error.localizedDescription)")
          self.scheduleReconnect()
        case .success(let message):
          switch message {
          case .string(let text):
            self.handleTextMessage(text)
          case .data(let data):
            if let text = String(data: data, encoding: .utf8) {
              self.handleTextMessage(text)
            }
          @unknown default:
            break
          }
          self.receiveNextMessage()
        }
      }
    }

    private func handleTextMessage(_ text: String) {
      if text == "__rune_pong__" {
        return
      }

      // Try to parse as JSON first
      var parsedPayload: [String: Any]?
      if let data = text.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
      {
        parsedPayload = object
      }

      guard let payload = parsedPayload, let type = payload["type"] as? String else {
        // Not a structured message, pass through
        runtime?.handleDevMessage(text)
        return
      }

      print("[RuneDevClient] Received message type: \(type)")

      var shouldForward = true
      switch type {
      case "hash":
        if let hash = payload["data"] as? String {
          print("[RuneDevClient] 🔑 New build hash: \(hash)")
        }

      case "ok", "still-ok":
        print("[RuneDevClient] ✅ Compilation OK")
      // Forward to runtime so it can decide whether to apply updates

      case "warnings":
        if let warnings = payload["data"] as? [[String: Any]] {
          print("[RuneDevClient] ⚠️ Compilation warnings (\(warnings.count))")
          for warning in warnings {
            if let message = warning["message"] as? String {
              print("  - \(message)")
            }
          }
        }

      case "errors":
        if let errors = payload["data"] as? [[String: Any]] {
          print("[RuneDevClient] ❌ Compilation errors (\(errors.count))")
          for error in errors {
            if let message = error["message"] as? String {
              print("  - \(message)")
            }
          }
        }

      default:
        // Pass through other message types (like "update")
        print("[RuneDevClient] Forwarding message type '\(type)' to runtime")
      }

      if shouldForward {
        runtime?.handleDevMessage(text)
      }
    }

    private func sendHello() {
      guard let socket else { return }
      let payload: [String: Any] = [
        "type": "custom",
        "event": "rune:hello",
        "data": [
          "platform": "ios",
          "timestamp": Date().timeIntervalSince1970 * 1000,
        ],
      ]
      if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let json = String(data: data, encoding: .utf8)
      {
        print("[RuneDevClient] 👋 Sending hello message")
        socket.send(.string(json)) { error in
          if let error {
            print("[RuneDevClient] ❌ Failed to send hello: \(error.localizedDescription)")
          } else {
            print("[RuneDevClient] ✅ Hello message sent")
          }
        }
      }
    }

    private func sendPing() {
      guard let socket else { return }
      socket.sendPing { error in
        if let error {
          print("[RuneDevClient] ping failed: \(error.localizedDescription)")
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

    private static func sanitizeToken(_ token: String?) -> String? {
      guard
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines),
        !trimmed.isEmpty
      else {
        return nil
      }
      return trimmed
    }

    private static func normalize(_ url: URL) -> URL {
      guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return url
      }

      if let host = components.host?.lowercased(), host == "localhost" {
        components.host = "127.0.0.1"
      }

      return components.url ?? url
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
        print("[RuneDevClient] ✅ WebSocket connected to \(urlString)")
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
        print(
          "[RuneDevClient] ⚠️ WebSocket closed (code: \(closeCode.rawValue), reason: \(reasonString))"
        )
        self?.scheduleReconnect()
      }
    }
  }
#endif
