import Foundation

@objc public enum ZynthScreenAnimation: Int {
  case none
  case push
  case modal
  case sheetBlur
  case zoom
  case fade

  init(string: String?) {
    guard let value = string?.lowercased() else {
      self = .push
      return
    }

    switch value {
    case "none":
      self = .none
    case "modal", "sheet":
      self = .modal
    case "sheet-blur":
      self = .sheetBlur
    case "zoom", "scale":
      self = .zoom
    case "fade":
      self = .fade
    default:
      self = .push
    }
  }
}
