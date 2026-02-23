import Foundation
import QuartzCore

@objcMembers
public final class ZynthStartupMetricsRegistry: NSObject {
  private static let lock = NSLock()
  private static var bySession: [String: StartupMetrics] = [:]

  private override init() {}

  private static func uptimeMs() -> Double {
    CACurrentMediaTime() * 1000.0
  }

  public static func runtimeCreated(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      if metrics.runtimeInitMs == nil {
        metrics.runtimeInitMs = uptimeMs()
      }
    }
  }

  public static func markBundleReadStart(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      metrics.bundleReadStartMs = uptimeMs()
    }
  }

  public static func markBundleReadEnd(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      let end = uptimeMs()
      metrics.bundleReadEndMs = end
      if let start = metrics.bundleReadStartMs {
        metrics.bundleReadMs = max(0.0, end - start)
      }
    }
  }

  public static func markHermesEvalStart(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      metrics.hermesEvalStartMs = uptimeMs()
    }
  }

  public static func markHermesEvalEnd(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      let end = uptimeMs()
      metrics.hermesEvalEndMs = end
      if let start = metrics.hermesEvalStartMs {
        metrics.hermesEvalMs = max(0.0, end - start)
      }
    }
  }

  public static func markStartRequested(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      if metrics.startRequestedMs == nil {
        metrics.startRequestedMs = uptimeMs()
      }
    }
  }

  public static func markFirstFramePresented(forSession sessionId: String) {
    mutate(sessionId: sessionId) { metrics in
      if metrics.firstFrameMs == nil {
        metrics.firstFrameMs = uptimeMs()
      }
    }
  }

  public static func recordFrame(
    forSession sessionId: String,
    frameMs: Double,
    layoutMs: Double
  ) {
    mutate(sessionId: sessionId) { metrics in
      if metrics.firstFrameMs != nil {
        return
      }
      metrics.framesToFirstRender += 1
      metrics.totalFrameMs += max(0.0, frameMs)
      metrics.totalLayoutMs += max(0.0, layoutMs)
    }
  }

  public static func enableFeatures(
    forSession sessionId: String,
    features: [String]
  ) {
    mutate(sessionId: sessionId) { metrics in
      for feature in features {
        if feature == "startupTime" {
          metrics.enabledFeatures.insert(feature)
        }
      }
    }
  }

  public static func metricsSnapshot(forSession sessionId: String) -> [String: Any] {
    lock.lock()
    let metrics = bySession[sessionId] ?? StartupMetrics()
    lock.unlock()
    return metrics.makeSnapshot()
  }

  public static func startupMetrics(forSession sessionId: String) -> [String: Any]? {
    lock.lock()
    guard let metrics = bySession[sessionId] else {
      lock.unlock()
      return nil
    }
    lock.unlock()
    return metrics.makeStartupSnapshot()
  }

  private static func mutate(
    sessionId: String,
    _ apply: (StartupMetrics) -> Void
  ) {
    lock.lock()
    let metrics = bySession[sessionId] ?? StartupMetrics()
    apply(metrics)
    bySession[sessionId] = metrics
    lock.unlock()
  }
}

private final class StartupMetrics {
  var runtimeInitMs: Double?
  var bundleReadStartMs: Double?
  var bundleReadEndMs: Double?
  var bundleReadMs: Double?
  var hermesEvalStartMs: Double?
  var hermesEvalEndMs: Double?
  var hermesEvalMs: Double?
  var startRequestedMs: Double?
  var firstFrameMs: Double?
  var framesToFirstRender: Int = 0
  var totalFrameMs: Double = 0.0
  var totalLayoutMs: Double = 0.0
  var enabledFeatures: Set<String> = []

  func makeSnapshot() -> [String: Any] {
    var result: [String: Any] = [:]
    if enabledFeatures.contains("startupTime") {
      result["startupTime"] = makeStartupSnapshot()
    }
    return result
  }

  func makeStartupSnapshot() -> [String: Any] {
    let averageFrameMs: Double? = framesToFirstRender > 0
      ? (totalFrameMs / Double(framesToFirstRender))
      : nil
    let averageLayoutMs: Double? = framesToFirstRender > 0
      ? (totalLayoutMs / Double(framesToFirstRender))
      : nil
    let startToFirstFrameMs: Double? = {
      guard let startRequestedMs, let firstFrameMs else {
        return nil
      }
      return max(0.0, firstFrameMs - startRequestedMs)
    }()
    let runtimeToFirstFrameMs: Double? = {
      guard let runtimeInitMs, let firstFrameMs else {
        return nil
      }
      return max(0.0, firstFrameMs - runtimeInitMs)
    }()

    func boxed(_ value: Double?) -> Any {
      if let value {
        return value
      }
      return NSNull()
    }

    return [
      "enabled": enabledFeatures.contains("startupTime"),
      "ready": firstFrameMs != nil,
      "runtimeInitMs": boxed(runtimeInitMs),
      "bundleReadMs": boxed(bundleReadMs),
      "hermesEvalMs": boxed(hermesEvalMs),
      "startToFirstFrameMs": boxed(startToFirstFrameMs),
      "runtimeToFirstFrameMs": boxed(runtimeToFirstFrameMs),
      "framesToFirstRender": framesToFirstRender,
      "avgFrameMsToFirstRender": boxed(averageFrameMs),
      "avgLayoutMsToFirstRender": boxed(averageLayoutMs),
      "firstFrameAtMs": boxed(firstFrameMs),
    ]
  }
}
