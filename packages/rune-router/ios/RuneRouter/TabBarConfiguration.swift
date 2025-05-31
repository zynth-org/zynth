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

  func makeImage() -> UIImage? {
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
    if systemName == nil, assetName == nil, runeId == nil {
      return nil
    }
    self.systemName = systemName
    self.assetName = assetName
    self.runeId = runeId
  }
}
