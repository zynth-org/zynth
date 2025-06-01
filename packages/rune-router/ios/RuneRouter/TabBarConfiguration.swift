import UIKit

struct TabBarConfiguration {
  struct Item {
    let name: String
    let label: String?
    let badge: String?
    let badgeColor: UIColor?
    let activeTintColor: UIColor?
    let inactiveTintColor: UIColor?
    let backgroundColor: UIColor?
    let icon: TabIconConfiguration?
  }

  let navigatorId: String
  let items: [Item]
  let initialRouteName: String?
}

struct TabIconConfiguration {
  let systemName: String?
  let assetName: String?
  let runeId: String?
  let surfaceId: Int?
  let glyph: TabGlyphIconConfiguration?

  func makeSystemImage() -> UIImage? {
    if let systemName {
      if #available(iOS 13.0, *) {
        return UIImage(systemName: systemName)
      }
    }
    if let assetName {
      return UIImage(named: assetName)
    }
    return nil
  }
}

struct TabGlyphIconConfiguration {
  let glyph: String
  let fontSize: CGFloat
  let fontFamily: String?
  let fontWeight: String?
  let baselineOffset: CGFloat
  let activeColor: UIColor?
  let inactiveColor: UIColor?

  func image(active: Bool) -> UIImage? {
    guard !glyph.isEmpty else { return nil }
    let color = active ? (activeColor ?? UIColor.label) : (inactiveColor ?? UIColor.secondaryLabel)
    let font: UIFont
    if let family = fontFamily, let custom = UIFont(name: family, size: fontSize) {
      font = custom
    } else {
      font = UIFont.systemFont(ofSize: fontSize, weight: fontWeightValue())
    }
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
    ]
    let attributed = NSAttributedString(string: glyph, attributes: attributes)
    var size = attributed.size()
    size.width = max(ceil(size.width) + 6, 20)
    size.height = max(ceil(size.height) + 4, 20)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { _ in
      let rect = CGRect(
        x: (size.width - attributed.size().width) / 2,
        y: (size.height - attributed.size().height) / 2 - baselineOffset,
        width: size.width,
        height: size.height
      )
      attributed.draw(in: rect)
    }
  }

  private func fontWeightValue() -> UIFont.Weight {
    guard let fontWeight else { return .medium }
    switch fontWeight.lowercased() {
    case "thin":
      return .thin
    case "light":
      return .light
    case "regular":
      return .regular
    case "medium":
      return .medium
    case "semibold":
      return .semibold
    case "bold":
      return .bold
    case "heavy":
      return .heavy
    default:
      return .medium
    }
  }
}

extension TabBarConfiguration {
  init?(dictionary: [String: Any]) {
    guard
      let navigatorId = dictionary["navigatorId"] as? String,
      let tabs = dictionary["tabs"] as? [[String: Any]]
    else {
      return nil
    }
    var items: [Item] = []
    for entry in tabs {
      guard let item = Item(dictionary: entry) else { continue }
      items.append(item)
    }
    if items.isEmpty {
      return nil
    }
    self.navigatorId = navigatorId
    self.items = items
    self.initialRouteName = dictionary["initialRouteName"] as? String
  }
}

extension TabBarConfiguration.Item {
  init?(dictionary: [String: Any]) {
    guard let name = dictionary["name"] as? String else {
      return nil
    }
    self.name = name
    self.label = dictionary["label"] as? String
    if let badge = dictionary["badge"], !(badge is NSNull) {
      self.badge = "\(badge)"
    } else {
      self.badge = nil
    }
    if let badgeColorHex = dictionary["badgeColor"] as? String {
      self.badgeColor = UIColor(hex: badgeColorHex)
    } else {
      self.badgeColor = nil
    }
    if let activeHex = dictionary["activeTintColor"] as? String {
      self.activeTintColor = UIColor(hex: activeHex)
    } else {
      self.activeTintColor = nil
    }
    if let inactiveHex = dictionary["inactiveTintColor"] as? String {
      self.inactiveTintColor = UIColor(hex: inactiveHex)
    } else {
      self.inactiveTintColor = nil
    }
    if let backgroundHex = dictionary["backgroundColor"] as? String {
      self.backgroundColor = UIColor(hex: backgroundHex)
    } else {
      self.backgroundColor = nil
    }
    if let iconDict = dictionary["icon"] as? [String: Any] {
      self.icon = TabIconConfiguration(dictionary: iconDict)
    } else {
      self.icon = nil
    }
  }
}

extension TabIconConfiguration {
  init?(dictionary: [String: Any]) {
    let systemName = dictionary["systemName"] as? String
    let assetName = dictionary["assetName"] as? String
    let runeId = dictionary["runeId"] as? String
    let surfaceId = (dictionary["surfaceId"] as? NSNumber)?.intValue
    let glyph = TabGlyphIconConfiguration(dictionary: dictionary)
    if systemName == nil, assetName == nil, runeId == nil, glyph == nil {
      return nil
    }
    self.systemName = systemName
    self.assetName = assetName
    self.runeId = runeId
    self.surfaceId = surfaceId
    self.glyph = glyph
  }
}

extension TabGlyphIconConfiguration {
  init?(dictionary: [String: Any]) {
    guard let glyph = dictionary["glyph"] as? String, !glyph.isEmpty else {
      return nil
    }
    self.glyph = glyph
    if let fontSize = dictionary["glyphFontSize"] as? NSNumber {
      self.fontSize = CGFloat(truncating: fontSize)
    } else {
      self.fontSize = 16
    }
    self.fontFamily = dictionary["glyphFontFamily"] as? String
    self.fontWeight = dictionary["glyphFontWeight"] as? String
    if let offset = dictionary["glyphBaselineOffset"] as? NSNumber {
      self.baselineOffset = CGFloat(truncating: offset)
    } else {
      self.baselineOffset = 0
    }
    if let activeHex = dictionary["glyphActiveColor"] as? String {
      self.activeColor = UIColor(hex: activeHex)
    } else {
      self.activeColor = nil
    }
    if let inactiveHex = dictionary["glyphInactiveColor"] as? String {
      self.inactiveColor = UIColor(hex: inactiveHex)
    } else {
      self.inactiveColor = nil
    }
  }
}
