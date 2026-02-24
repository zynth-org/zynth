import AuthenticationServices
import Foundation
import UIKit
import ZynthKit

final class AuthSessionModule: NSObject, ZynthModule, ASWebAuthenticationPresentationContextProviding {
  let name: String = "AuthSession"

  var exportedMethods: [String] {
    ["openAuthSession", "completeAuthSession", "dismissAuthSession"]
  }

  var protectedMethods: [String] {
    ["openAuthSession", "completeAuthSession", "dismissAuthSession"]
  }

  private weak var runtime: ZynthRuntime?
  private var pendingSession: PendingSession?
  private var webAuthSession: ASWebAuthenticationSession?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "openAuthSession":
      return try openAuthSession(args: args)
    case "completeAuthSession":
      return try completeAuthSession(args: args)
    case "dismissAuthSession":
      return dismissAuthSession()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow }) ?? ASPresentationAnchor()
  }

  private func openAuthSession(args: ZynthArgs) throws -> Any? {
    if pendingSession != nil {
      throw NSError(domain: "ZynthAuthSession", code: 1, userInfo: [NSLocalizedDescriptionKey: "Another auth session is already active"])
    }

    let requestId = args.string("requestId", default: UUID().uuidString)
    let request = try args.dict("request")

    let authUrl = try validateAuthUrl(request["authUrl"] as? String ?? "")
    let redirectUri = try validateRedirectUri(request["redirectUri"] as? String ?? "")
    let preferEphemeral = (request["preferEphemeralSession"] as? Bool) ?? false

    let callbackScheme = redirectUri.scheme
    pendingSession = PendingSession(requestId: requestId, redirectUri: redirectUri)

    let session = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
      guard let self else { return }
      guard let pending = self.pendingSession else { return }

      self.pendingSession = nil
      self.webAuthSession = nil

      if let callbackURL {
        if self.matchesRedirect(expected: pending.redirectUri, actual: callbackURL) {
          self.emitResult(requestId: pending.requestId, type: "success", url: callbackURL.absoluteString)
        } else {
          self.emitResult(
            requestId: pending.requestId,
            type: "error",
            errorCode: "E_REDIRECT_MISMATCH",
            errorMessage: "Redirect URL does not match expected callback",
          )
        }
        return
      }

      if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
        self.emitResult(requestId: pending.requestId, type: "cancel")
        return
      }

      self.emitResult(
        requestId: pending.requestId,
        type: "error",
        errorCode: "E_AUTH_SESSION_FAILED",
        errorMessage: error?.localizedDescription ?? "Authentication session failed",
      )
    }

    session.presentationContextProvider = self
    if #available(iOS 13.0, *) {
      session.prefersEphemeralWebBrowserSession = preferEphemeral
    }

    webAuthSession = session

    if !session.start() {
      pendingSession = nil
      webAuthSession = nil
      throw NSError(domain: "ZynthAuthSession", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to start authentication session"])
    }

    return ["status": "pending"]
  }

  private func completeAuthSession(args: ZynthArgs) throws -> Any? {
    let url = try args.string("url")
    guard let pending = pendingSession else {
      return ["completed": false]
    }
    guard let callback = URL(string: url), matchesRedirect(expected: pending.redirectUri, actual: callback) else {
      return ["completed": false]
    }

    pendingSession = nil
    webAuthSession?.cancel()
    webAuthSession = nil

    emitResult(requestId: pending.requestId, type: "success", url: callback.absoluteString)
    return ["completed": true]
  }

  private func dismissAuthSession() -> [String: Any] {
    guard let pending = pendingSession else {
      return ["dismissed": false]
    }

    pendingSession = nil
    webAuthSession?.cancel()
    webAuthSession = nil

    emitResult(requestId: pending.requestId, type: "dismiss")
    return ["dismissed": true]
  }

  private func validateAuthUrl(_ raw: String) throws -> URL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw NSError(domain: "ZynthAuthSession", code: 10, userInfo: [NSLocalizedDescriptionKey: "authUrl cannot be empty"])
    }
    guard trimmed.count <= 4096 else {
      throw NSError(domain: "ZynthAuthSession", code: 11, userInfo: [NSLocalizedDescriptionKey: "authUrl exceeds maximum length"])
    }
    guard let url = URL(string: trimmed), url.scheme?.lowercased() == "https", url.host != nil else {
      throw NSError(domain: "ZynthAuthSession", code: 12, userInfo: [NSLocalizedDescriptionKey: "authUrl must be a valid https URL"])
    }
    return url
  }

  private func validateRedirectUri(_ raw: String) throws -> URL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw NSError(domain: "ZynthAuthSession", code: 13, userInfo: [NSLocalizedDescriptionKey: "redirectUri cannot be empty"])
    }
    guard trimmed.count <= 4096 else {
      throw NSError(domain: "ZynthAuthSession", code: 14, userInfo: [NSLocalizedDescriptionKey: "redirectUri exceeds maximum length"])
    }
    guard let url = URL(string: trimmed), let scheme = url.scheme, !scheme.isEmpty else {
      throw NSError(domain: "ZynthAuthSession", code: 15, userInfo: [NSLocalizedDescriptionKey: "redirectUri must include a scheme"])
    }
    return url
  }

  private func matchesRedirect(expected: URL, actual: URL) -> Bool {
    let expectedScheme = expected.scheme?.lowercased()
    let actualScheme = actual.scheme?.lowercased()
    if expectedScheme != actualScheme {
      return false
    }

    let expectedHost = expected.host?.lowercased() ?? ""
    let actualHost = actual.host?.lowercased() ?? ""
    if !expectedHost.isEmpty || !actualHost.isEmpty {
      if expectedHost != actualHost {
        return false
      }
    }

    let expectedPath = expected.path
    let actualPath = actual.path
    return expectedPath == actualPath
  }

  private func emitResult(
    requestId: String,
    type: String,
    url: String? = nil,
    errorCode: String? = nil,
    errorMessage: String? = nil,
  ) {
    let payload: [String: Any] = [
      "requestId": requestId,
      "type": type,
      "url": url ?? NSNull(),
      "errorCode": errorCode ?? NSNull(),
      "errorMessage": errorMessage ?? NSNull(),
    ]
    runtime?.emitEvent(name: "AuthSession.result", payload: payload)
  }

  private struct PendingSession {
    let requestId: String
    let redirectUri: URL
  }
}
