import Foundation

@objc(FetchModule)
final class FetchModule: NSObject, ZynthModule, URLSessionDataDelegate {
  let name: String = "Fetch"

  private lazy var session: URLSession = {
    URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }()

  private let taskQueue = DispatchQueue(label: "zynth.fetch.tasks")
  private var tasks: [Int: URLSessionDataTask] = [:]
  private var taskIdsByTaskIdentifier: [Int: Int] = [:]
  private var streamStates: [Int: StreamState] = [:]
  private var pendingUploads: [Int: PendingUpload] = [:]
  private var bufferedResponses: [Int: Data] = [:]

  private let emitEvent: (String, Any?) -> Void

  init(emitEvent: @escaping (String, Any?) -> Void) {
    self.emitEvent = emitEvent
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "request":
      return try handleRequest(args: args)
    case "cancel":
      return try handleCancel(args: args)
    case "streamStart":
      return try handleStreamStart(args: args)
    case "uploadChunk":
      return try handleUploadChunk(args: args)
    case "uploadComplete":
      return try handleUploadComplete(args: args)
    case "uploadAbort":
      return try handleUploadAbort(args: args)
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  private func handleRequest(args: ZynthArgs) throws -> Any {
    let requestId = try args.number("requestId")
    let idInt = Int(requestId)

    let wantsResponseStream = args.bool("stream", default: false)
    let wantsUploadStream = args.bool("uploadStream", default: false)

    let urlString = try args.string("url")
    guard let url = URL(string: urlString) else {
      return ["error": "invalid_url"]
    }

    let method = args.string("method", default: "GET").uppercased()
    let headers = try? args.dict("headers")
    let timeoutSeconds = args.number("timeout", default: 0)

    if wantsUploadStream && (method == "GET" || method == "HEAD") {
      return [
        "error": "invalid_method",
        "message": "uploadStream requires a request body method",
      ]
    }

    var request = URLRequest(url: url)
    request.httpMethod = method
    if timeoutSeconds > 0 {
      request.timeoutInterval = timeoutSeconds
    }

    if let headers {
      for (key, value) in headers {
        request.setValue(String(describing: value), forHTTPHeaderField: key)
      }
    }

    if wantsUploadStream {
      taskQueue.sync {
        pendingUploads[idInt] = PendingUpload(
          requestId: idInt,
          urlString: urlString,
          wantsResponseStream: wantsResponseStream,
          request: request,
          body: Data()
        )
      }
      return ["requestId": idInt]
    }

    let payload = try args.asDict()
    if let body = payload["body"] {
      if let data = coerceBodyData(body) {
        request.httpBody = data
      } else if let bodyString = body as? String {
        request.httpBody = bodyString.data(using: .utf8)
      } else {
        return [
          "error": "unsupported_body",
          "type": String(describing: type(of: body)),
        ]
      }
    }

    startRequest(
      requestId: idInt,
      urlString: urlString,
      request: request,
      wantsResponseStream: wantsResponseStream
    )

    return ["requestId": idInt]
  }

  private func handleCancel(args: ZynthArgs) throws -> Any {
    let requestId = try Int(args.number("id"))

    taskQueue.sync {
      pendingUploads.removeValue(forKey: requestId)
      tasks[requestId]?.cancel()
      removeTaskUnsafe(requestId)
    }

    return ["result": true]
  }

  private func handleStreamStart(args: ZynthArgs) throws -> Any {
    let streamId = try Int(args.number("id"))

    taskQueue.sync {
      guard var state = streamStates[streamId] else {
        return
      }
      state.started = true
      streamStates[streamId] = state
      flushPending(state: state)
      if state.pendingEnd || state.pendingError != nil {
        removeTaskUnsafe(streamId)
      }
    }

    return ["result": true]
  }

  private func handleUploadChunk(args: ZynthArgs) throws -> Any {
    let requestId = try Int(args.number("id"))
    let payload = try args.asDict()
    guard let chunk = payload["chunk"] else {
      throw ZynthArgsError.missingKey("chunk")
    }

    guard let data = coerceBodyData(chunk) else {
      return ["error": "unsupported_chunk"]
    }

    return taskQueue.sync {
      guard var pending = pendingUploads[requestId] else {
        return ["error": "upload_not_found"]
      }
      pending.body.append(data)
      pendingUploads[requestId] = pending
      return ["result": true]
    }
  }

  private func handleUploadComplete(args: ZynthArgs) throws -> Any {
    let requestId = try Int(args.number("id"))

    let pending = taskQueue.sync { () -> PendingUpload? in
      pendingUploads.removeValue(forKey: requestId)
    }

    guard let pending else {
      return ["error": "upload_not_found"]
    }

    var request = pending.request
    request.httpBody = pending.body

    startRequest(
      requestId: pending.requestId,
      urlString: pending.urlString,
      request: request,
      wantsResponseStream: pending.wantsResponseStream
    )

    return ["result": true]
  }

  private func handleUploadAbort(args: ZynthArgs) throws -> Any {
    let requestId = try Int(args.number("id"))

    taskQueue.sync {
      pendingUploads.removeValue(forKey: requestId)
      tasks[requestId]?.cancel()
      removeTaskUnsafe(requestId)
    }

    return ["result": true]
  }

  private func startRequest(
    requestId: Int,
    urlString: String,
    request: URLRequest,
    wantsResponseStream: Bool
  ) {
    if wantsResponseStream {
      let streamState = StreamState(
        requestId: requestId,
        streamId: requestId,
        urlString: urlString,
        responseEmitted: false,
        started: false,
        pendingChunks: [],
        pendingEnd: false,
        pendingError: nil
      )

      taskQueue.sync {
        streamStates[requestId] = streamState
      }

      let task = session.dataTask(with: request)
      storeTask(task, id: requestId)
      task.resume()
      return
    }

    let task = session.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      let bufferedData = self.takeBufferedResponseData(for: requestId)
      self.removeTask(requestId)

      if let error {
        var errorResult: [String: Any] = [
          "error": "network_error",
          "message": error.localizedDescription,
          "requestId": requestId,
        ]

        if (error as NSError).code == NSURLErrorCancelled {
          errorResult["error"] = "aborted"
          errorResult["message"] = "Request aborted"
        }

        self.emitEvent("zynth.fetch.response", errorResult)
        return
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        self.emitEvent("zynth.fetch.response", [
          "requestId": requestId,
          "error": "invalid_response",
          "message": "Response was not HTTPURLResponse",
        ])
        return
      }

      let responseHeaders = coerceHeaders(httpResponse.allHeaderFields)
      let status = httpResponse.statusCode
      let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
      let responseUrl = httpResponse.url?.absoluteString ?? urlString
      let redirected = responseUrl != urlString

      let bodyData = bufferedData ?? data ?? Data()
      let bodyBytes = [UInt8](bodyData)

      let result: [String: Any] = [
        "result": [
          "status": status,
          "statusText": statusText,
          "ok": status >= 200 && status < 300,
          "url": responseUrl,
          "redirected": redirected,
          "headers": responseHeaders,
          "body": bodyBytes,
        ],
        "requestId": requestId,
      ]

      self.emitEvent("zynth.fetch.response", result)
    }

    storeTask(task, id: requestId)
    task.resume()
  }

  private func storeTask(_ task: URLSessionDataTask, id: Int) {
    taskQueue.sync {
      tasks[id] = task
      taskIdsByTaskIdentifier[task.taskIdentifier] = id
    }
  }

  private func removeTask(_ id: Int) {
    taskQueue.sync {
      removeTaskUnsafe(id)
    }
  }

  private func detachTaskUnsafe(_ id: Int) {
    if let task = tasks.removeValue(forKey: id) {
      taskIdsByTaskIdentifier.removeValue(forKey: task.taskIdentifier)
    }
  }

  private func removeTaskUnsafe(_ id: Int) {
    detachTaskUnsafe(id)
    streamStates.removeValue(forKey: id)
    pendingUploads.removeValue(forKey: id)
    bufferedResponses.removeValue(forKey: id)
  }

  private func takeBufferedResponseData(for requestId: Int) -> Data? {
    taskQueue.sync {
      if let data = bufferedResponses.removeValue(forKey: requestId), !data.isEmpty {
        return data
      }
      return nil
    }
  }

  private func flushPending(state: StreamState) {
    for chunk in state.pendingChunks {
      emitEvent("zynth.fetch.stream", [
        "id": state.streamId,
        "type": "chunk",
        "chunk": [UInt8](chunk),
      ])
    }

    if let pendingError = state.pendingError {
      emitEvent("zynth.fetch.stream", [
        "id": state.streamId,
        "type": "error",
        "message": pendingError,
      ])
      return
    }

    if state.pendingEnd {
      emitEvent("zynth.fetch.stream", [
        "id": state.streamId,
        "type": "end",
      ])
    }
  }

  private func requestId(for taskIdentifier: Int) -> Int? {
    taskQueue.sync {
      taskIdsByTaskIdentifier[taskIdentifier]
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    defer {
      completionHandler(.allow)
    }

    guard let httpResponse = response as? HTTPURLResponse else {
      return
    }

    guard let requestId = requestId(for: dataTask.taskIdentifier) else {
      return
    }

    taskQueue.sync {
      guard var state = streamStates[requestId] else {
        return
      }

      let responseHeaders = coerceHeaders(httpResponse.allHeaderFields)
      let status = httpResponse.statusCode
      let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
      let responseUrl = httpResponse.url?.absoluteString ?? state.urlString
      let redirected = responseUrl != state.urlString

      let result: [String: Any] = [
        "result": [
          "status": status,
          "statusText": statusText,
          "ok": status >= 200 && status < 300,
          "url": responseUrl,
          "redirected": redirected,
          "headers": responseHeaders,
          "streamId": state.streamId,
        ],
        "requestId": state.requestId,
      ]

      emitEvent("zynth.fetch.response", result)
      state.responseEmitted = true
      streamStates[requestId] = state
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    guard let requestId = requestId(for: dataTask.taskIdentifier) else {
      return
    }

    taskQueue.sync {
      guard var state = streamStates[requestId] else {
        if var buffered = bufferedResponses[requestId] {
          buffered.append(data)
          bufferedResponses[requestId] = buffered
        } else {
          bufferedResponses[requestId] = data
        }
        return
      }

      if state.started {
        emitEvent("zynth.fetch.stream", [
          "id": state.streamId,
          "type": "chunk",
          "chunk": [UInt8](data),
        ])
      } else {
        state.pendingChunks.append(data)
        streamStates[requestId] = state
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    guard let requestId = requestId(for: task.taskIdentifier) else {
      return
    }

    taskQueue.sync {
      guard var state = streamStates[requestId] else {
        removeTaskUnsafe(requestId)
        return
      }

      if let error {
        let isAborted = (error as NSError).code == NSURLErrorCancelled
        let message = isAborted ? "Request aborted" : error.localizedDescription

        if !state.responseEmitted {
          emitEvent("zynth.fetch.response", [
            "requestId": state.requestId,
            "error": isAborted ? "aborted" : "network_error",
            "message": message,
          ])
          removeTaskUnsafe(requestId)
          return
        }

        if state.started {
          emitEvent("zynth.fetch.stream", [
            "id": state.streamId,
            "type": "error",
            "message": message,
          ])
          removeTaskUnsafe(requestId)
        } else {
          state.pendingError = message
          streamStates[requestId] = state
          detachTaskUnsafe(requestId)
        }
      } else {
        if state.started {
          emitEvent("zynth.fetch.stream", [
            "id": state.streamId,
            "type": "end",
          ])
          removeTaskUnsafe(requestId)
        } else {
          state.pendingEnd = true
          streamStates[requestId] = state
          detachTaskUnsafe(requestId)
        }
      }
    }
  }
}

private struct StreamState {
  let requestId: Int
  let streamId: Int
  let urlString: String
  var responseEmitted: Bool
  var started: Bool
  var pendingChunks: [Data]
  var pendingEnd: Bool
  var pendingError: String?
}

private struct PendingUpload {
  let requestId: Int
  let urlString: String
  let wantsResponseStream: Bool
  let request: URLRequest
  var body: Data
}

private func coerceHeaders(_ raw: [AnyHashable: Any]) -> [String: String] {
  var headers: [String: String] = [:]
  headers.reserveCapacity(raw.count)
  for (key, value) in raw {
    headers[String(describing: key)] = String(describing: value)
  }
  return headers
}

private func coerceBodyData(_ body: Any) -> Data? {
  if let data = body as? Data {
    return data
  }
  if let numbers = body as? [NSNumber] {
    return Data(numbers.map { UInt8(truncating: $0) })
  }
  if let ints = body as? [Int] {
    return Data(ints.map { UInt8($0 & 0xff) })
  }
  if let bytes = body as? [UInt8] {
    return Data(bytes)
  }
  return nil
}
