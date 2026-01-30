import Foundation

@objc(FetchModule)
final class FetchModule: NSObject, ZynthModule, URLSessionDataDelegate {
  let name: String = "Fetch"

  private lazy var session: URLSession = {
    URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }()
  private let taskQueue = DispatchQueue(label: "zynth.fetch.tasks")
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
    case "streamStart":
      return handleStreamStart(args: args)
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

    let task = session.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      self.removeTask(requestId)

      if let error {
        var errorResult: [String: Any]
        if (error as NSError).code == NSURLErrorCancelled {
          errorResult = [
            "error": "aborted",
            "message": "Request aborted",
          ]
        } else {
          errorResult = [
            "error": "network_error",
            "message": error.localizedDescription,
          ]
        }
        errorResult["requestId"] = requestId
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

      // Convert body to number array for bridge
      let bodyData = data ?? Data()
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

    return ["requestId": requestId]
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

  private func handleStreamStart(args: Any?) -> Any {
    guard let payload = args as? [String: Any], let streamId = payload["id"] as? Int else {
      return ["error": "invalid_arguments"]
    }
    taskQueue.sync {
      for (id, state) in states where state.streamId == streamId {
        var updated = state
        updated.started = true
        states[id] = updated
        flushPending(state: updated)
        if updated.pendingEnd || updated.pendingError != nil {
          removeTaskUnsafe(id)
        }
        break
      }
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
      removeTaskUnsafe(id)
    }
  }

  private func removeTaskUnsafe(_ id: Int) {
    tasks.removeValue(forKey: id)
    states.removeValue(forKey: id)
  }
}

private struct StreamState {
  let requestId: Int
  let streamId: Int
  let urlString: String
  var result: [String: Any]?
  var error: [String: Any]?
  var started: Bool
  var pendingChunks: [Data]
  var pendingEnd: Bool
  var pendingError: String?
}

extension FetchModule {
  private func handleStreamRequest(requestId: Int, urlString: String, request: URLRequest) -> Any {
    let state = StreamState(
      requestId: requestId,
      streamId: requestId,
      urlString: urlString,
      result: nil,
      error: nil,
      started: false,
      pendingChunks: [],
      pendingEnd: false,
      pendingError: nil
    )
    taskQueue.sync {
      states[requestId] = state
    }

    let task = session.dataTask(with: request)
    storeTask(task, id: requestId)
    task.resume()
    
    // For streams, the initial response is handled in didReceive response delegate
    // But we need to ensure we emit 'zynth.fetch.response' when we get headers.
    
    return ["requestId": requestId]
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
          
          state.result = result // Keep for reference if needed, though mostly unused now
          states[id] = state
        }
        break
      }
    }
    completionHandler(.allow)
  }

      func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {

        taskQueue.sync {

          for (id, task) in tasks where task.taskIdentifier == dataTask.taskIdentifier {

            if var state = states[id] {

              if state.started {

                let bytes = [UInt8](data)

                emitEvent("zynth.fetch.stream", [

                  "id": state.streamId,

                  "type": "chunk",

                  "chunk": bytes,

                ])

              } else {

                state.pendingChunks.append(data)

                states[id] = state

              }

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

                              if state.started {

                                emitEvent("zynth.fetch.stream", [

                                  "id": state.streamId,

                                  "type": "error",

                                  "message": "Request aborted",

                                ])

                              } else {

                                state.pendingError = "Request aborted"

                                // If cancelled before start, emit response error

                                 emitEvent("zynth.fetch.response", [

                                    "requestId": state.requestId,

                                    "error": "aborted",

                                    "message": "Request aborted",

                                 ])

                              }

                            } else if state.result == nil {

                              state.error = [

                                "error": "network_error",

                                "message": error.localizedDescription,

                              ]

                              // Emit error as response if not yet started

                               emitEvent("zynth.fetch.response", [

                                  "requestId": state.requestId,

                                  "error": "network_error",

                                  "message": error.localizedDescription,

                               ])

                            } else {

                if state.started {

                  emitEvent("zynth.fetch.stream", [

                    "id": state.streamId,

                    "type": "error",

                    "message": error.localizedDescription,

                  ])

                } else {

                  state.pendingError = error.localizedDescription

                }

              }

            } else {

              if state.started {

                emitEvent("zynth.fetch.stream", [

                  "id": state.streamId,

                  "type": "end",

                ])

              }

              else {

                state.pendingEnd = true

              }

            }

            states[id] = state

          }

          if (error == nil || states[id]?.result != nil), states[id]?.started == true {

            removeTaskUnsafe(id)

          }

          break

        }

      }

    }

  private func flushPending(state: StreamState) {
    if !state.pendingChunks.isEmpty {
      for chunk in state.pendingChunks {
        let bytes = [UInt8](chunk)
        emitEvent("zynth.fetch.stream", [
          "id": state.streamId,
          "type": "chunk",
          "chunk": bytes,
        ])
      }
    }
    if let message = state.pendingError {
      emitEvent("zynth.fetch.stream", [
        "id": state.streamId,
        "type": "error",
        "message": message,
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
