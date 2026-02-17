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

  var exportedMethods: [String] {
    return ["notificationAsync", "impactAsync", "selectionAsync", "performHapticsAsync"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "notificationAsync":
      return try handleNotification(args)
    case "impactAsync":
      return try handleImpact(args)
    case "selectionAsync":
      return handleSelection()
    case "performHapticsAsync":
      return try handlePerformHaptics(args)
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func handleNotification(_ args: ZynthArgs) throws -> [String: Any] {
    let typeString = try args.string("type")
    guard let type = NotificationType(rawValue: typeString.lowercased()) else {
      throw ZynthArgsError.invalidType(key: "type", expected: "NotificationType")
    }

    runOnMain {
      let generator = UINotificationFeedbackGenerator()
      generator.prepare()
      generator.notificationOccurred(type.feedbackType)
    }

    return ["result": true]
  }

  private func handleImpact(_ args: ZynthArgs) throws -> [String: Any] {
    let styleString = try args.string("style")
    guard let style = ImpactStyle(rawValue: styleString.lowercased()) else {
      throw ZynthArgsError.invalidType(key: "style", expected: "ImpactStyle")
    }

    runOnMain {
      let generator = UIImpactFeedbackGenerator(style: style.feedbackStyle)
      generator.prepare()
      generator.impactOccurred()
    }

    return ["result": true]
  }

  private func handleSelection() -> [String: Any] {
    runOnMain {
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }

    return ["result": true]
  }

  private func handlePerformHaptics(_ args: ZynthArgs) throws -> [String: Any] {
    let type = try args.string("type")
    if type == "no-haptics" {
      return ["result": true]
    }

    // Since we don't have a direct mapping for all HapticFeedbackConstants on iOS,
    // we'll use selection feedback as a fallback or map common ones.
    runOnMain {
      let generator = UISelectionFeedbackGenerator()
      generator.prepare()
      generator.selectionChanged()
    }

    return ["result": true]
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
