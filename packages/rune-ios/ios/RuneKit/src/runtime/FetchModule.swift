import Foundation

final class FetchModule: NSObject, RuneModule, URLSessionDataDelegate {
  let name: String = "Fetch"

  private lazy var session: URLSession = {
    URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }()
  private let taskQueue = DispatchQueue(label: "rune.fetch.tasks")
  private var tasks: [Int: URLSessionDataTask] = [:]
  private var states: [Int: StreamState] = [:]
  private let emitEvent: (String, Any?) -> Void

  init(emitEvent: @escaping (String, Any?) -> Void) {
    self.emitEvent = emitEvent
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "request":
      return handleRequest(args: args)
    case "cancel":
      return handleCancel(args: args)
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  private func handleRequest(args: Any?) -> Any {
    guard let payload = args as? [String: Any] else {
      return ["error": "invalid_arguments"]
    }

    guard let requestId = payload["requestId"] as? Int else {
      return ["error": "missing_request_id"]
    }
    let wantsStream = payload["stream"] as? Bool ?? false

    guard let urlString = payload["url"] as? String, let url = URL(string: urlString) else {
      return ["error": "invalid_url"]
    }

    let method = (payload["method"] as? String)?.uppercased() ?? "GET"
    let headers = payload["headers"] as? [String: Any]
    let timeoutSeconds = (payload["timeout"] as? Double) ?? 0

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

    if wantsStream {
      return handleStreamRequest(requestId: requestId, urlString: urlString, request: request)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var result: [String: Any]?
    var errorResult: [String: Any]?

    let task = session.dataTask(with: request) { [weak self] data, response, error in
      defer { semaphore.signal() }
      self?.removeTask(requestId)

      if let error {
        if (error as NSError).code == NSURLErrorCancelled {
          errorResult = [
            "error": "aborted",
            "message": "Request aborted",
          ]
          return
        }
        errorResult = [
          "error": "network_error",
          "message": error.localizedDescription,
        ]
        return
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        errorResult = [
          "error": "invalid_response",
          "message": "Response was not HTTPURLResponse",
        ]
        return
      }

      let responseHeaders = coerceHeaders(httpResponse.allHeaderFields)
      let status = httpResponse.statusCode
      let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
      let responseUrl = httpResponse.url?.absoluteString ?? urlString
      let redirected = responseUrl != urlString

      result = [
        "result": [
          "status": status,
          "statusText": statusText,
          "ok": status >= 200 && status < 300,
          "url": responseUrl,
          "redirected": redirected,
          "headers": responseHeaders,
          "body": data ?? Data(),
        ],
      ]
    }

    storeTask(task, id: requestId)
    task.resume()
    semaphore.wait()

    if let errorResult {
      return errorResult
    }
    return result ?? ["error": "unknown_error"]
  }

  private func handleCancel(args: Any?) -> Any {
    guard let payload = args as? [String: Any], let requestId = payload["id"] as? Int else {
      return ["error": "invalid_arguments"]
    }
    taskQueue.sync {
      tasks[requestId]?.cancel()
    }
    return ["result": true]
  }

  private func storeTask(_ task: URLSessionDataTask, id: Int) {
    taskQueue.sync {
      tasks[id] = task
    }
  }

  private func removeTask(_ id: Int) {
    taskQueue.sync {
      tasks.removeValue(forKey: id)
      states.removeValue(forKey: id)
    }
  }
}

private struct StreamState {
  let requestId: Int
  let streamId: Int
  let urlString: String
  let semaphore: DispatchSemaphore
  var result: [String: Any]?
  var error: [String: Any]?
}

extension FetchModule {
  private func handleStreamRequest(requestId: Int, urlString: String, request: URLRequest) -> Any {
    let semaphore = DispatchSemaphore(value: 0)
    let state = StreamState(
      requestId: requestId,
      streamId: requestId,
      urlString: urlString,
      semaphore: semaphore,
      result: nil,
      error: nil
    )
    taskQueue.sync {
      states[requestId] = state
    }

    let task = session.dataTask(with: request)
    storeTask(task, id: requestId)
    task.resume()
    semaphore.wait()

    let stateResult = taskQueue.sync { states[requestId] }
    if let error = stateResult?.error {
      removeTask(requestId)
      return error
    }
    if let result = stateResult?.result {
      return result
    }
    removeTask(requestId)
    return ["error": "unknown_error"]
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let httpResponse = response as? HTTPURLResponse else {
      completionHandler(.cancel)
      return
    }

    taskQueue.sync {
      for (id, task) in tasks where task.taskIdentifier == dataTask.taskIdentifier {
        if var state = states[id] {
          let responseHeaders = coerceHeaders(httpResponse.allHeaderFields)
          let status = httpResponse.statusCode
          let statusText = HTTPURLResponse.localizedString(forStatusCode: status)
          let responseUrl = httpResponse.url?.absoluteString ?? state.urlString
          let redirected = responseUrl != state.urlString
          state.result = [
            "result": [
              "status": status,
              "statusText": statusText,
              "ok": status >= 200 && status < 300,
              "url": responseUrl,
              "redirected": redirected,
              "headers": responseHeaders,
              "streamId": state.streamId,
            ],
          ]
          states[id] = state
          state.semaphore.signal()
        }
        break
      }
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    taskQueue.sync {
      for (id, task) in tasks where task.taskIdentifier == dataTask.taskIdentifier {
        if let state = states[id] {
          emitEvent("rune.fetch.stream", [
            "id": state.streamId,
            "type": "chunk",
            "chunk": data,
          ])
        }
        break
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    taskQueue.sync {
      for (id, storedTask) in tasks where storedTask.taskIdentifier == task.taskIdentifier {
        if var state = states[id] {
          if let error {
            if (error as NSError).code == NSURLErrorCancelled {
              state.error = [
                "error": "aborted",
                "message": "Request aborted",
              ]
              emitEvent("rune.fetch.stream", [
                "id": state.streamId,
                "type": "error",
                "message": "Request aborted",
              ])
              state.semaphore.signal()
            } else if state.result == nil {
              state.error = [
                "error": "network_error",
                "message": error.localizedDescription,
              ]
              state.semaphore.signal()
            } else {
              emitEvent("rune.fetch.stream", [
                "id": state.streamId,
                "type": "error",
                "message": error.localizedDescription,
              ])
            }
          } else {
            emitEvent("rune.fetch.stream", [
              "id": state.streamId,
              "type": "end",
            ])
          }
          states[id] = state
        }
        if error == nil || states[id]?.result != nil {
          tasks.removeValue(forKey: id)
          states.removeValue(forKey: id)
        }
        break
      }
    }
  }
}

private func coerceHeaders(_ raw: [AnyHashable: Any]) -> [String: String] {
  var headers: [String: String] = [:]
  headers.reserveCapacity(raw.count)
  for (key, value) in raw {
    let keyString = String(describing: key)
    let valueString = String(describing: value)
    headers[keyString] = valueString
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
  if let bytes = body as? [UInt8] {
    return Data(bytes)
  }
  return nil
}
