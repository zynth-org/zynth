import Foundation

@objc(FetchModule)
final class FetchModule: NSObject, ZynthModule, URLSessionDataDelegate {
  let name: String = "Fetch"

  var exportedMethods: [String] {
    return ["request", "cancel", "streamStart", "uploadChunk", "uploadComplete", "uploadAbort"]
  }

  private lazy var session: URLSession = {
    URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }()

  private let taskQueue = DispatchQueue(label: "zynth.fetch.tasks")
  private var tasks: [Int: URLSessionDataTask] = [:]
  private var taskIdsByTaskIdentifier: [Int: Int] = [:]
  private var trustedCertificatesByTaskIdentifier: [Int: [Data]] = [:]
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
    let bodyFileUri = args.optionalString("bodyFileUri")?.trimmingCharacters(in: .whitespacesAndNewlines)
    let trustedCertificates = try parseTrustedCertificatesPem(args)

    if (wantsUploadStream || (bodyFileUri?.isEmpty == false)) &&
      (method == "GET" || method == "HEAD") {
      return [
        "error": "invalid_method",
        "message": "Request body requires a non-GET/HEAD method",
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

    if let bodyFileUri, !bodyFileUri.isEmpty {
      do {
        request.httpBody = try loadBodyFileData(bodyFileUri)
      } catch {
        return [
          "error": "invalid_body_file_uri",
          "message": error.localizedDescription,
        ]
      }
      startRequest(
        requestId: idInt,
        urlString: urlString,
        request: request,
        wantsResponseStream: wantsResponseStream,
        trustedCertificates: trustedCertificates
      )
      return ["requestId": idInt]
    }

    if wantsUploadStream {
      taskQueue.sync {
        pendingUploads[idInt] = PendingUpload(
          requestId: idInt,
          urlString: urlString,
          wantsResponseStream: wantsResponseStream,
          request: request,
          trustedCertificates: trustedCertificates,
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
      wantsResponseStream: wantsResponseStream,
      trustedCertificates: trustedCertificates
    )

    return ["requestId": idInt]
  }

  private func loadBodyFileData(_ rawUri: String) throws -> Data {
    let trimmed = rawUri.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      throw NSError(
        domain: "Fetch",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "bodyFileUri is empty"]
      )
    }
    let fileUrl: URL
    if trimmed.hasPrefix("file://") {
      guard let url = URL(string: trimmed), url.isFileURL else {
        throw NSError(
          domain: "Fetch",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "bodyFileUri is not a valid file URL"]
        )
      }
      fileUrl = url
    } else if trimmed.hasPrefix("/") {
      fileUrl = URL(fileURLWithPath: trimmed)
    } else {
      throw NSError(
        domain: "Fetch",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "bodyFileUri must be file:// or absolute path"]
      )
    }
    return try Data(contentsOf: fileUrl)
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
      wantsResponseStream: pending.wantsResponseStream,
      trustedCertificates: pending.trustedCertificates
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
    wantsResponseStream: Bool,
    trustedCertificates: [Data]
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
      storeTask(task, id: requestId, trustedCertificates: trustedCertificates)
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

    storeTask(task, id: requestId, trustedCertificates: trustedCertificates)
    task.resume()
  }

  private func storeTask(_ task: URLSessionDataTask, id: Int, trustedCertificates: [Data]) {
    taskQueue.sync {
      tasks[id] = task
      taskIdsByTaskIdentifier[task.taskIdentifier] = id
      if !trustedCertificates.isEmpty {
        trustedCertificatesByTaskIdentifier[task.taskIdentifier] = trustedCertificates
      } else {
        trustedCertificatesByTaskIdentifier.removeValue(forKey: task.taskIdentifier)
      }
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
      trustedCertificatesByTaskIdentifier.removeValue(forKey: task.taskIdentifier)
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

  private func trustedCertificates(for taskIdentifier: Int) -> [Data] {
    taskQueue.sync {
      trustedCertificatesByTaskIdentifier[taskIdentifier] ?? []
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    let trustedCertificates = trustedCertificates(for: task.taskIdentifier)
    if trustedCertificates.isEmpty {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    guard let serverTrust = challenge.protectionSpace.serverTrust else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    guard #available(iOS 15.0, *),
      let certificateChain = SecTrustCopyCertificateChain(serverTrust),
      CFArrayGetCount(certificateChain) > 0,
      let firstEntry = CFArrayGetValueAtIndex(certificateChain, 0)
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let serverCertificate = unsafeBitCast(firstEntry, to: SecCertificate.self)

    let serverCertificateData = Data(SecCertificateCopyData(serverCertificate) as Data)
    let matched = trustedCertificates.contains(serverCertificateData)
    if matched {
      completionHandler(.useCredential, URLCredential(trust: serverTrust))
      return
    }

    completionHandler(.cancelAuthenticationChallenge, nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64,
    totalBytesExpectedToSend: Int64
  ) {
    guard let requestId = requestId(for: task.taskIdentifier) else {
      return
    }

    emitEvent("zynth.fetch.uploadProgress", [
      "requestId": requestId,
      "bytesSent": totalBytesSent,
      "bytesTotal": totalBytesExpectedToSend,
      "chunkBytes": bytesSent,
      "phase": "enqueue",
    ])
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
  let trustedCertificates: [Data]
  var body: Data
}

private enum FetchTlsParseError: LocalizedError {
  case invalidTlsObject
  case invalidTrustedCertificatesType
  case invalidTrustedCertificatesEntry
  case missingCertificateBlock
  case invalidCertificateBlock

  var errorDescription: String? {
    switch self {
    case .invalidTlsObject:
      return "tls must be an object"
    case .invalidTrustedCertificatesType:
      return "tls.trustedCertificatesPem must be a PEM string or array of PEM strings"
    case .invalidTrustedCertificatesEntry:
      return "tls.trustedCertificatesPem array must contain only PEM strings"
    case .missingCertificateBlock:
      return "tls.trustedCertificatesPem must include at least one CERTIFICATE block"
    case .invalidCertificateBlock:
      return "tls.trustedCertificatesPem contains an invalid CERTIFICATE block"
    }
  }
}

private extension FetchModule {
  func parseTrustedCertificatesPem(_ args: ZynthArgs) throws -> [Data] {
    let payload = try args.asDict()
    guard let rawTls = payload["tls"] else {
      return []
    }
    guard let tlsConfig = rawTls as? [String: Any] else {
      throw FetchTlsParseError.invalidTlsObject
    }
    guard let rawTrustedCertificates = tlsConfig["trustedCertificatesPem"] else {
      return []
    }

    let sources: [String]
    if let single = rawTrustedCertificates as? String {
      sources = [single]
    } else if let array = rawTrustedCertificates as? [Any] {
      var parsed: [String] = []
      parsed.reserveCapacity(array.count)
      for entry in array {
        guard let value = entry as? String else {
          throw FetchTlsParseError.invalidTrustedCertificatesEntry
        }
        parsed.append(value)
      }
      sources = parsed
    } else {
      throw FetchTlsParseError.invalidTrustedCertificatesType
    }

    if sources.isEmpty {
      return []
    }

    var certificates: [Data] = []
    for source in sources {
      let blocks = extractCertificateBlocks(source)
      if blocks.isEmpty {
        throw FetchTlsParseError.missingCertificateBlock
      }
      for block in blocks {
        let body = block
          .replacingOccurrences(of: "-----BEGIN CERTIFICATE-----", with: "")
          .replacingOccurrences(of: "-----END CERTIFICATE-----", with: "")
          .components(separatedBy: .whitespacesAndNewlines)
          .joined()
        guard let der = Data(base64Encoded: body), !der.isEmpty else {
          throw FetchTlsParseError.invalidCertificateBlock
        }
        certificates.append(der)
      }
    }
    return certificates
  }

  func extractCertificateBlocks(_ source: String) -> [String] {
    let pattern = "-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----"
    guard let regex = try? NSRegularExpression(pattern: pattern) else {
      return []
    }
    let input = source as NSString
    let matches = regex.matches(in: source, range: NSRange(location: 0, length: input.length))
    if matches.isEmpty {
      return []
    }

    var blocks: [String] = []
    blocks.reserveCapacity(matches.count)
    for match in matches {
      blocks.append(input.substring(with: match.range).trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return blocks
  }
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
  if let dict = body as? [String: Any] {
    return coerceIndexedDictionaryData(dict)
  }
  return nil
}

private func coerceIndexedDictionaryData(_ body: [String: Any]) -> Data? {
  if let lengthNumber = body["length"] as? NSNumber {
    let length = lengthNumber.intValue
    guard length >= 0 else {
      return nil
    }
    var bytes = [UInt8]()
    bytes.reserveCapacity(length)
    for index in 0..<length {
      guard let value = body[String(index)] as? NSNumber else {
        return nil
      }
      bytes.append(UInt8(truncating: value))
    }
    return Data(bytes)
  }

  let numericKeys = body.keys.compactMap { Int($0) }.sorted()
  guard let lastIndex = numericKeys.last, lastIndex >= 0 else {
    return nil
  }

  var bytes = Array(repeating: UInt8(0), count: lastIndex + 1)
  for index in numericKeys {
    guard let value = body[String(index)] as? NSNumber else {
      return nil
    }
    bytes[index] = UInt8(truncating: value)
  }
  return Data(bytes)
}
