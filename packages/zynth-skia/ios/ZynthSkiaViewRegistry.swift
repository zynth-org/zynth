import Foundation

@objc(ZynthSkiaViewRegistry)
final class ZynthSkiaViewRegistry: NSObject {
  static let shared = ZynthSkiaViewRegistry()

  private let lock = NSLock()
  private var views: [Int: WeakBox<ZynthSkiaView>] = [:]

  private override init() {}

  func register(nodeId: Int, view: ZynthSkiaView) {
    lock.lock()
    views[nodeId] = WeakBox(value: view)
    lock.unlock()
  }

  func unregister(nodeId: Int) {
    lock.lock()
    views.removeValue(forKey: nodeId)
    lock.unlock()
  }

  func view(for nodeId: Int) -> ZynthSkiaView? {
    lock.lock()
    defer { lock.unlock() }
    guard let boxed = views[nodeId] else {
      return nil
    }
    guard let value = boxed.value else {
      views.removeValue(forKey: nodeId)
      return nil
    }
    return value
  }

  func clear() {
    lock.lock()
    views.removeAll()
    lock.unlock()
  }

  @objc(sharedInstance)
  static func sharedInstance() -> ZynthSkiaViewRegistry {
    shared
  }

  @objc(registerWithNodeId:view:)
  func registerWithNodeId(_ nodeId: Int, view: ZynthSkiaView) {
    register(nodeId: nodeId, view: view)
  }

  @objc(unregisterWithNodeId:)
  func unregisterWithNodeId(_ nodeId: Int) {
    unregister(nodeId: nodeId)
  }

  @objc(viewForNodeId:)
  func viewForNodeId(_ nodeId: Int) -> ZynthSkiaView? {
    view(for: nodeId)
  }

  @objc(clearRegistry)
  func clearRegistry() {
    clear()
  }
}

private final class WeakBox<T: AnyObject> {
  weak var value: T?

  init(value: T?) {
    self.value = value
  }
}
