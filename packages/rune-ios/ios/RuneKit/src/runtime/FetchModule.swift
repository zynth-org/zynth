import Foundation

final class FetchModule: RuneModule {
  let name: String = "Fetch"

  private let session: URLSession

  init(session: URLSession = URLSession(configuration: .default)) {
    self.session = session
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "request":
      return handleRequest(args: args)
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  private func handleRequest(args: Any?) -> Any {
    guard let payload = args as? [String: Any] else {
      return ["error": "invalid_arguments"]
    }

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

    let semaphore = DispatchSemaphore(value: 0)
    var result: [String: Any]?
    var errorResult: [String: Any]?

    let task = session.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }

      if let error {
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

    task.resume()
    semaphore.wait()

    if let errorResult {
      return errorResult
    }
    return result ?? ["error": "unknown_error"]
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
