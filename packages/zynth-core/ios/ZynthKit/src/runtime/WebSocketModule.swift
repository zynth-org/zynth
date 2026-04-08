import Foundation

@objc(WebSocketModule)
final class WebSocketModule: NSObject, ZynthModule, URLSessionWebSocketDelegate {
  let name: String = "WebSocket"
  private weak var runtime: ZynthRuntime?
  private var session: URLSession!
  private var sockets: [Int: URLSessionWebSocketTask] = [:]
  private let queue = DispatchQueue(label: "dev.zynth.websocket")

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }

  var exportedMethods: [String] {
    ["connect", "send", "close", "reloadDevBundle"]
  }

  func invalidate() {
    queue.sync {
      for socket in sockets.values {
        socket.cancel(with: .goingAway, reason: nil)
      }
      sockets.removeAll()
    }
    session.invalidateAndCancel()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "connect":
      return try connect(args)
    case "send":
      return try send(args)
    case "close":
      return try close(args)
    case "reloadDevBundle":
      return reloadDevBundle(args)
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  private func connect(_ args: ZynthArgs) throws -> Any {
    let id = Int(try args.number("id"))
    let urlString = try args.string("url")
    guard let url = URL(string: urlString) else {
      return ["error": "invalid_url", "message": urlString]
    }
    let task = session.webSocketTask(with: url)
    queue.sync {
      sockets[id] = task
    }
    task.resume()
    receiveLoop(id: id, task: task)
    return ["result": true]
  }

  private func send(_ args: ZynthArgs) throws -> Any {
    let id = Int(try args.number("id"))
    let data = try args.string("data")
    guard let task = queue.sync(execute: { sockets[id] }) else {
      return ["error": "socket_not_found"]
    }
    task.send(.string(data)) { [weak self] error in
      if let error {
        self?.emit(id: id, type: "error", ["message": error.localizedDescription])
      }
    }
    return ["result": true]
  }

  private func close(_ args: ZynthArgs) throws -> Any {
    let id = Int(try args.number("id"))
    let codeValue = Int(args.number("code", default: 1000))
    let reason = args.string("reason", default: "")
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: codeValue) ?? .normalClosure
    let reasonData = reason.isEmpty ? nil : reason.data(using: .utf8)
    let task = queue.sync {
      sockets.removeValue(forKey: id)
    }
    task?.cancel(with: closeCode, reason: reasonData)
    guard task != nil else { return ["result": true] }
    emit(id: id, type: "close", ["code": codeValue, "reason": reason, "wasClean": true])
    return ["result": true]
  }

  private func reloadDevBundle(_ args: ZynthArgs) -> Any {
    guard let runtime else {
      return ["error": "runtime_deallocated"]
    }
    DispatchQueue.main.async {
      runtime.refreshDevBundle()
    }
    return ["result": true]
  }

  private func receiveLoop(id: Int, task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          self.emit(id: id, type: "message", ["data": text])
        case .data:
          self.emit(id: id, type: "error", ["message": "Binary WebSocket frames are not supported"])
        @unknown default:
          self.emit(id: id, type: "error", ["message": "Unknown WebSocket frame"])
        }
        if self.queue.sync(execute: { self.sockets[id] != nil }) {
          self.receiveLoop(id: id, task: task)
        }
      case .failure(let error):
        let task = self.queue.sync {
          self.sockets.removeValue(forKey: id)
        }
        guard task != nil else { return }
        self.emit(id: id, type: "error", ["message": error.localizedDescription])
        self.emit(id: id, type: "close", ["code": 1006, "reason": error.localizedDescription, "wasClean": false])
      }
    }
  }

  private func emit(id: Int, type: String, _ data: [String: Any] = [:]) {
    var payload = data
    payload["id"] = id
    payload["type"] = type
    runtime?.emitEvent(name: "zynth.websocket.event", payload: payload)
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    let id = queue.sync { sockets.first(where: { $0.value == webSocketTask })?.key }
    guard let id else { return }
    emit(id: id, type: "open")
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    let id = queue.sync { sockets.first(where: { $0.value == webSocketTask })?.key }
    guard let id else { return }
    let task = queue.sync {
      sockets.removeValue(forKey: id)
    }
    guard task != nil else { return }
    let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    emit(id: id, type: "close", ["code": closeCode.rawValue, "reason": reasonText, "wasClean": closeCode == .normalClosure])
  }
}
