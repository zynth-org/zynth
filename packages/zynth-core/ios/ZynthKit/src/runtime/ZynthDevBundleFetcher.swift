import Foundation

enum ZynthDevBundleError: Error {
  case invalidURL
  case timeout
  case requestFailed(String)
  case invalidResponse
}

struct ZynthDevBundle {
  let code: String
  let url: URL
}

enum ZynthDevBundleFetcher {
  static func fetch(
    baseURL: URL,
    token: String? = nil,
    attempts: Int = 6,
    retryDelay: TimeInterval = 0.75,
    timeout: TimeInterval = 10
  ) throws -> ZynthDevBundle {
    let bundleURL = buildBundleURL(baseURL: baseURL, token: token)
    var lastError: Error?

    let maxAttempts = max(1, attempts)
    for _ in 0..<maxAttempts {
      do {
        return try fetchOnce(url: bundleURL, timeout: timeout)
      } catch {
        lastError = error
        if retryDelay > 0 {
          Thread.sleep(forTimeInterval: retryDelay)
        }
      }
    }

    throw lastError ?? ZynthDevBundleError.invalidResponse
  }

  private static func buildBundleURL(baseURL: URL, token: String?) -> URL {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    components?.path = "/main.js"
    if let token = sanitizeToken(token) {
      var items = components?.queryItems ?? []
      if !items.contains(where: { $0.name == "token" }) {
        items.append(URLQueryItem(name: "token", value: token))
      }
      components?.queryItems = items
    }
    return components?.url ?? baseURL.appendingPathComponent("main.js")
  }

  private static func sanitizeToken(_ token: String?) -> String? {
    guard let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmed.isEmpty
    else {
      return nil
    }
    return trimmed
  }

  private static func fetchOnce(url: URL, timeout: TimeInterval) throws -> ZynthDevBundle {
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.addValue("no-cache", forHTTPHeaderField: "Cache-Control")

    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<ZynthDevBundle, Error> = .failure(ZynthDevBundleError.timeout)

    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }

      if let error {
        result = .failure(ZynthDevBundleError.requestFailed(error.localizedDescription))
        return
      }

      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        result = .failure(ZynthDevBundleError.invalidResponse)
        return
      }

      guard let data, let code = String(data: data, encoding: .utf8) else {
        result = .failure(ZynthDevBundleError.invalidResponse)
        return
      }

      result = .success(ZynthDevBundle(code: code, url: url))
    }.resume()

    let waitResult = semaphore.wait(timeout: .now() + timeout + 1)
    if waitResult == .timedOut {
      throw ZynthDevBundleError.timeout
    }

    switch result {
    case .success(let bundle):
      return bundle
    case .failure(let error):
      throw error
    }
  }
}
