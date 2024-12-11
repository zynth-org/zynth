#if DEBUG
  import Foundation

  enum RuneDevBundleError: Error {
    case invalidResponse
    case requestFailed(String)
    case timeout
  }

  struct RuneDevBundle {
    let code: String
    let url: URL
  }

  enum RuneDevBundleFetcher {
    private static func buildBundleURL(from baseURL: URL) -> URL {
      var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
      components?.percentEncodedPath = "/main.js"
      return components?.url ?? baseURL.appendingPathComponent("main.js")
    }

    static func fetch(
      baseURL: URL,
      timeout: TimeInterval = 12,
      attempts: Int = 8,
      retryDelay: TimeInterval = 0.75
    ) throws -> RuneDevBundle {
      var lastError: Error?
      for attempt in 0..<max(attempts, 1) {
        do {
          return try fetchOnce(
            url: buildBundleURL(from: baseURL),
            timeout: timeout
          )
        } catch {
          lastError = error
          if attempt < attempts - 1 {
            Thread.sleep(forTimeInterval: retryDelay)
            continue
          }
        }
      }
      throw lastError ?? RuneDevBundleError.invalidResponse
    }

    private static func fetchOnce(url: URL, timeout: TimeInterval) throws -> RuneDevBundle {
      var request = URLRequest(url: url)
      request.httpMethod = "GET"
      request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

      let semaphore = DispatchSemaphore(value: 0)
      var receivedData: Data?
      var receivedResponse: URLResponse?
      var receivedError: Error?

      let session = URLSession(configuration: .ephemeral)
      let task = session.dataTask(with: request) { data, response, error in
        receivedData = data
        receivedResponse = response
        receivedError = error
        semaphore.signal()
      }
      task.resume()

      let waitResult = semaphore.wait(timeout: .now() + timeout)
      if waitResult == .timedOut {
        task.cancel()
        throw RuneDevBundleError.timeout
      }

      if let error = receivedError {
        throw RuneDevBundleError.requestFailed(error.localizedDescription)
      }

      guard
        let httpResponse = receivedResponse as? HTTPURLResponse,
        httpResponse.statusCode == 200,
        let data = receivedData,
        let code = String(data: data, encoding: .utf8)
      else {
        throw RuneDevBundleError.invalidResponse
      }

      return RuneDevBundle(code: code, url: url)
    }
  }
#endif
