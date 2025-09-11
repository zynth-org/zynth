import Foundation

public final class RuneRuntimeManagerRegistry {
  public static let shared = RuneRuntimeManagerRegistry()

  private let queue = DispatchQueue(label: "dev.rune.runtime.registry", attributes: .concurrent)
  private let map = NSMapTable<SNUIManager, RuneRuntime>(keyOptions: [.weakMemory], valueOptions: [.weakMemory])

  func setRuntime(_ runtime: RuneRuntime, for manager: SNUIManager) {
    queue.async(flags: .barrier) {
      self.map.setObject(runtime, forKey: manager)
    }
  }

  public func runtime(for manager: SNUIManager?) -> RuneRuntime? {
    guard let manager else { return nil }
    return queue.sync {
      self.map.object(forKey: manager)
    }
  }
}
