import Foundation

public final class ZynthRuntimeManagerRegistry {
  public static let shared = ZynthRuntimeManagerRegistry()

  private let queue = DispatchQueue(label: "dev.zynth.runtime.registry", attributes: .concurrent)
  private let map = NSMapTable<SNUIManager, ZynthRuntime>(keyOptions: [.weakMemory], valueOptions: [.weakMemory])

  func setRuntime(_ runtime: ZynthRuntime, for manager: SNUIManager) {
    queue.async(flags: .barrier) {
      self.map.setObject(runtime, forKey: manager)
    }
  }

  public func runtime(for manager: SNUIManager?) -> ZynthRuntime? {
    guard let manager else { return nil }
    return queue.sync {
      self.map.object(forKey: manager)
    }
  }
}
