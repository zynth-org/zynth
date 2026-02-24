import Foundation
import SafariServices
import UIKit
import ZynthKit

final class WebBrowserModule: NSObject, ZynthModule, SFSafariViewControllerDelegate {
  let name: String = "WebBrowser"

  var exportedMethods: [String] {
    ["openBrowserAsync", "dismissBrowser", "warmUpAsync", "coolDownAsync"]
  }

  private weak var runtime: ZynthRuntime?
  private weak var safariController: SFSafariViewController?
  private var pendingRequestId: String?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "openBrowserAsync":
      return try openBrowserAsync(args: args)
    case "dismissBrowser":
      return dismissBrowser()
    case "warmUpAsync":
      return ["warmedUp": true]
    case "coolDownAsync":
      return ["cooledDown": true]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func openBrowserAsync(args: ZynthArgs) throws -> Any? {
    if pendingRequestId != nil {
      throw NSError(domain: "ZynthWebBrowser", code: 1, userInfo: [NSLocalizedDescriptionKey: "Another browser request is already active"])
    }

    let requestId = args.string("requestId", default: UUID().uuidString)
    let options = try args.dict("options")
    let rawUrl = options["url"] as? String ?? ""
    let url = try validateBrowserUrl(rawUrl)

    pendingRequestId = requestId
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard let presenter = self.topViewController() else {
        self.emitResult(requestId: requestId, type: "error", errorCode: "E_NO_VIEW_CONTROLLER", errorMessage: "No active view controller")
        self.pendingRequestId = nil
        return
      }

      let browser = SFSafariViewController(url: url)
      browser.delegate = self
      self.safariController = browser
      presenter.present(browser, animated: true) {
        self.emitResult(requestId: requestId, type: "opened", url: url.absoluteString)
      }
    }

    return ["status": "pending"]
  }

  private func dismissBrowser() -> [String: Any] {
    guard let safariController else {
      return ["dismissed": false]
    }
    let requestId = pendingRequestId
    pendingRequestId = nil
    DispatchQueue.main.async {
      safariController.dismiss(animated: true)
    }
    if let requestId {
      emitResult(requestId: requestId, type: "dismiss")
    }
    return ["dismissed": true]
  }

  func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
    guard let requestId = pendingRequestId else {
      return
    }
    pendingRequestId = nil
    safariController = nil
    emitResult(requestId: requestId, type: "cancel")
  }

  private func validateBrowserUrl(_ raw: String) throws -> URL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw NSError(domain: "ZynthWebBrowser", code: 2, userInfo: [NSLocalizedDescriptionKey: "WebBrowser URL cannot be empty"])
    }
    guard trimmed.count <= 4096 else {
      throw NSError(domain: "ZynthWebBrowser", code: 3, userInfo: [NSLocalizedDescriptionKey: "WebBrowser URL exceeds maximum length"])
    }
    guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host != nil else {
      throw NSError(domain: "ZynthWebBrowser", code: 4, userInfo: [NSLocalizedDescriptionKey: "WebBrowser URL must be valid http/https"])
    }
    return url
  }

  private func emitResult(
    requestId: String,
    type: String,
    url: String? = nil,
    errorCode: String? = nil,
    errorMessage: String? = nil
  ) {
    let payload: [String: Any] = [
      "requestId": requestId,
      "type": type,
      "url": url ?? NSNull(),
      "errorCode": errorCode ?? NSNull(),
      "errorMessage": errorMessage ?? NSNull(),
    ]

    runtime?.emitEvent(
      name: "WebBrowser.result",
      payload: payload
    )
  }

  private func topViewController(base: UIViewController? = nil) -> UIViewController? {
    let start: UIViewController?
    if let base {
      start = base
    } else {
      start = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first(where: { $0.isKeyWindow })?
        .rootViewController
    }

    if let nav = start as? UINavigationController {
      return topViewController(base: nav.visibleViewController)
    }
    if let tab = start as? UITabBarController {
      return topViewController(base: tab.selectedViewController)
    }
    if let presented = start?.presentedViewController {
      return topViewController(base: presented)
    }
    return start
  }
}
