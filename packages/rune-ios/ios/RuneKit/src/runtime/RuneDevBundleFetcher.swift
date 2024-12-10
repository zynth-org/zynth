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
      let normalizedPath: String
      if let path = components?.percentEncodedPath, !path.isEmpty, path != "/" {
        normalizedPath =
          path.hasSuffix("/") ? path + "rune-native/bundle" : path + "/rune-native/bundle"
      } else {
        normalizedPath = "/rune-native/bundle"
      }
      components?.percentEncodedPath = normalizedPath
      return components?.url ?? baseURL.appendingPathComponent("rune-native/bundle")
    }

    static func fetch(baseURL: URL, timeout: TimeInterval = 12) throws -> RuneDevBundle {
      let bundleURL = buildBundleURL(from: baseURL)
      var request = URLRequest(url: bundleURL)
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

      return RuneDevBundle(code: code, url: bundleURL)
    }
  }
#endif
