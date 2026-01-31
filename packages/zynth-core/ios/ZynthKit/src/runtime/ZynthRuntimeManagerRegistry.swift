import Foundation

@objcMembers
public final class ZynthRuntimeManagerRegistry: NSObject {
  public static let shared = ZynthRuntimeManagerRegistry()

  private let queue = DispatchQueue(label: "dev.zynth.runtime.registry", attributes: .concurrent)
  private let map = NSMapTable<ZynthUIManager, ZynthRuntime>(
    keyOptions: [.weakMemory],
    valueOptions: [.weakMemory]
  )

  public func setRuntime(_ runtime: ZynthRuntime, for manager: ZynthUIManager) {
    queue.async(flags: .barrier) {
      self.map.setObject(runtime, forKey: manager)
    }
  }

  public func runtime(for manager: ZynthUIManager?) -> ZynthRuntime? {
    guard let manager else { return nil }
    return queue.sync {
      self.map.object(forKey: manager)
    }
  }
}
