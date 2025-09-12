import UIKit

extension UIColor {
  static func rune_color(from hexString: String?) -> UIColor? {
    guard var hex = hexString?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: ""),
      !hex.isEmpty
    else {
      return nil
    }

    if hex.count == 3 {
      let chars = Array(hex)
      hex = chars.map { "\($0)\($0)" }.joined()
    }

    guard hex.count == 6 || hex.count == 8 else {
      return nil
    }

    var int: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&int)

    let r, g, b, a: UInt64
    if hex.count == 8 {
      a = int & 0xFF
      b = (int >> 8) & 0xFF
      g = (int >> 16) & 0xFF
      r = (int >> 24) & 0xFF
    } else {
      a = 0xFF
      b = int & 0xFF
      g = (int >> 8) & 0xFF
      r = (int >> 16) & 0xFF
    }

    return UIColor(
      red: CGFloat(r) / 255.0,
      green: CGFloat(g) / 255.0,
      blue: CGFloat(b) / 255.0,
      alpha: CGFloat(a) / 255.0
    )
  }

  static func rune_hexString(from color: UIColor) -> String {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    let red = Int(round(r * 255))
    let green = Int(round(g * 255))
    let blue = Int(round(b * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
  }
}
