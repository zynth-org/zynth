//
//  ZynthHapticsBridge.swift
//  ZynthHaptics
//
//  Bridge module that exposes haptics to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import UIKit
import ZynthKit

final class ZynthHapticsBridge: NSObject, ZynthModule {

  let name = "ZynthHaptics"

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "notificationAsync":
      return handleNotification(args)
    case "impactAsync":
      return handleImpact(args)
    case "selectionAsync":
      return handleSelection()
    case "performHapticsAsync":
      return errorResponse("unsupported_method", "performHapticsAsync")
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  private func handleNotification(_ args: ZynthArgs) -> [String: Any] {
    guard let typeString = try? args.string("type"),
          let type = NotificationType(rawValue: typeString.lowercased()) else {
      return errorResponse("invalid_argument", "type")
    }

    runOnMain {
      let generator = UINotificationFeedbackGenerator()
      generator.prepare()
      generator.notificationOccurred(type.feedbackType)
    }

    return successResponse()
  }

  private func handleImpact(_ args: ZynthArgs) -> [String: Any] {
    guard let styleString = try? args.string("style"),
          let style = ImpactStyle(rawValue: styleString.lowercased()) else {
      return errorResponse("invalid_argument", "style")
    }

    runOnMain {
      let generator = UIImpactFeedbackGenerator(style: style.feedbackStyle)
      generator.prepare()
      generator.impactOccurred()
    }

    return successResponse()
  }

  private func handleSelection() -> [String: Any] {
    runOnMain {
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }

    return successResponse()
  }

  private func runOnMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async {
        block()
      }
    }
  }

  private func successResponse() -> [String: Any] {
    return ["success": true]
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }

  private enum NotificationType: String {
    case success
    case warning
    case error

    var feedbackType: UINotificationFeedbackGenerator.FeedbackType {
      switch self {
      case .success:
        return .success
      case .warning:
        return .warning
      case .error:
        return .error
      }
    }
  }

  private enum ImpactStyle: String {
    case light
    case medium
    case heavy
    case soft
    case rigid

    var feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle {
      switch self {
      case .light:
        return .light
      case .medium:
        return .medium
      case .heavy:
        return .heavy
      case .soft:
        return .soft
      case .rigid:
        return .rigid
      }
    }
  }
}
