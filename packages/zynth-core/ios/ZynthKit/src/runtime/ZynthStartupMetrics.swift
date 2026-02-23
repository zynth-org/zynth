import Foundation
import QuartzCore

@objcMembers
public final class ZynthStartupMetricsRegistry: NSObject {
  private static let lock = NSLock()
  private static var bySession: [String: StartupMetrics] = [:]
  fileprivate static let processStartMs: Double = CACurrentMediaTime() * 1000.0

  private override init() {}

  private static func uptimeMs() -> Double {
    CACurrentMediaTime() * 1000.0
  }

  private static func currentThreadLabel() -> String {
    let name = Thread.current.name ?? "unknown"
    let prefix = Thread.isMainThread ? "main" : "background"
    return "\(prefix):\(name)"
  }

  public static func markRuntimeConstructStart(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.runtimeConstructStartMs == nil {
        metrics.runtimeConstructStartMs = uptimeMs()
      }
      metrics.markPhaseThread("runtimeConstructStart", thread: currentThreadLabel())
    }
  }

  public static func markRuntimeConstructEnd(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.runtimeConstructEndMs == nil {
        metrics.runtimeConstructEndMs = uptimeMs()
      }
      metrics.markPhaseThread("runtimeConstructEnd", thread: currentThreadLabel())
    }
  }

  public static func runtimeCreated(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.runtimeInitMs == nil {
        metrics.runtimeInitMs = uptimeMs()
      }
      metrics.markPhaseThread("runtimeCreated", thread: currentThreadLabel())
    }
  }

  public static func markModuleInitStart(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.moduleInitStartMs == nil {
        metrics.moduleInitStartMs = uptimeMs()
      }
      metrics.markPhaseThread("moduleInitStart", thread: currentThreadLabel())
    }
  }

  public static func markModuleInitEnd(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.moduleInitEndMs == nil {
        metrics.moduleInitEndMs = uptimeMs()
      }
      metrics.markPhaseThread("moduleInitEnd", thread: currentThreadLabel())
    }
  }

  public static func markModuleInitializeStart(forSession sessionId: String, moduleName: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if moduleName.isEmpty { return }
      metrics.moduleInitStarts[moduleName] = uptimeMs()
      metrics.markPhaseThread("moduleInit:\(moduleName):start", thread: currentThreadLabel())
    }
  }

  public static func markModuleInitializeEnd(forSession sessionId: String, moduleName: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if moduleName.isEmpty { return }
      guard let start = metrics.moduleInitStarts.removeValue(forKey: moduleName) else {
        return
      }
      let end = uptimeMs()
      let timing = ModuleInitTiming(
        name: moduleName,
        startMs: start,
        endMs: end,
        durationMs: max(0.0, end - start),
        thread: currentThreadLabel()
      )
      metrics.moduleInitTimings.append(timing)
      metrics.markPhaseThread("moduleInit:\(moduleName):end", thread: currentThreadLabel())
    }
  }

  public static func markJsRuntimeSetupStart(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.jsRuntimeSetupStartMs == nil {
        metrics.jsRuntimeSetupStartMs = uptimeMs()
      }
      metrics.markPhaseThread("jsRuntimeSetupStart", thread: currentThreadLabel())
    }
  }

  public static func markJsRuntimeSetupEnd(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.jsRuntimeSetupEndMs == nil {
        metrics.jsRuntimeSetupEndMs = uptimeMs()
      }
      metrics.markPhaseThread("jsRuntimeSetupEnd", thread: currentThreadLabel())
    }
  }

  public static func markBundleReadStart(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      metrics.bundleReadStartMs = uptimeMs()
      metrics.markPhaseThread("bundleReadStart", thread: currentThreadLabel())
    }
  }

  public static func markBundleReadEnd(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      let end = uptimeMs()
      metrics.bundleReadEndMs = end
      if let start = metrics.bundleReadStartMs {
        metrics.bundleReadMs = max(0.0, end - start)
      }
      metrics.markPhaseThread("bundleReadEnd", thread: currentThreadLabel())
    }
  }

  public static func markHermesEvalStart(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      metrics.hermesEvalStartMs = uptimeMs()
      metrics.markPhaseThread("hermesEvalStart", thread: currentThreadLabel())
    }
  }

  public static func markHermesEvalEnd(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      let end = uptimeMs()
      metrics.hermesEvalEndMs = end
      if let start = metrics.hermesEvalStartMs {
        metrics.hermesEvalMs = max(0.0, end - start)
      }
      metrics.markPhaseThread("hermesEvalEnd", thread: currentThreadLabel())
    }
  }

  public static func markStartRequested(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.startRequestedMs == nil {
        metrics.startRequestedMs = uptimeMs()
      }
      metrics.markPhaseThread("startRequested", thread: currentThreadLabel())
    }
  }

  public static func markFirstCommit(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.firstCommitMs == nil {
        metrics.firstCommitMs = uptimeMs()
      }
      metrics.markPhaseThread("firstCommit", thread: currentThreadLabel())
    }
  }

  public static func markFirstFramePresented(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.firstFrameMs == nil {
        metrics.firstFrameMs = uptimeMs()
      }
      metrics.markPhaseThread("firstFrame", thread: currentThreadLabel())
    }
  }

  public static func markFirstInteractive(forSession sessionId: String) {
    mutateEnabled(sessionId: sessionId) { metrics in
      if metrics.firstInteractiveMs == nil {
        metrics.firstInteractiveMs = uptimeMs()
      }
      metrics.markPhaseThread("firstInteractive", thread: currentThreadLabel())
    }
  }

  public static func recordFrame(
    forSession sessionId: String,
    frameMs: Double,
    layoutMs: Double
  ) {
    mutateEnabled(sessionId: sessionId) { metrics in
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
    guard metrics.enabledFeatures.contains("startupTime") else {
      lock.unlock()
      return nil
    }
    lock.unlock()
    return metrics.makeStartupSnapshot(processStartMs: processStartMs)
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

  private static func mutateEnabled(
    sessionId: String,
    _ apply: (StartupMetrics) -> Void
  ) {
    lock.lock()
    guard let metrics = bySession[sessionId], metrics.enabledFeatures.contains("startupTime") else {
      lock.unlock()
      return
    }
    apply(metrics)
    bySession[sessionId] = metrics
    lock.unlock()
  }
}

private struct ModuleInitTiming {
  let name: String
  let startMs: Double
  let endMs: Double
  let durationMs: Double
  let thread: String
}

private final class StartupMetrics {
  var runtimeConstructStartMs: Double?
  var runtimeConstructEndMs: Double?
  var runtimeInitMs: Double?
  var moduleInitStartMs: Double?
  var moduleInitEndMs: Double?
  var jsRuntimeSetupStartMs: Double?
  var jsRuntimeSetupEndMs: Double?
  var bundleReadStartMs: Double?
  var bundleReadEndMs: Double?
  var bundleReadMs: Double?
  var hermesEvalStartMs: Double?
  var hermesEvalEndMs: Double?
  var hermesEvalMs: Double?
  var startRequestedMs: Double?
  var firstCommitMs: Double?
  var firstFrameMs: Double?
  var firstInteractiveMs: Double?
  var framesToFirstRender: Int = 0
  var totalFrameMs: Double = 0.0
  var totalLayoutMs: Double = 0.0
  var enabledFeatures: Set<String> = []
  var phaseThreads: [String: String] = [:]
  var moduleInitStarts: [String: Double] = [:]
  var moduleInitTimings: [ModuleInitTiming] = []

  func markPhaseThread(_ phase: String, thread: String) {
    if phaseThreads[phase] == nil {
      phaseThreads[phase] = thread
    }
  }

  func makeSnapshot() -> [String: Any] {
    var result: [String: Any] = [:]
    if enabledFeatures.contains("startupTime") {
      result["startupTime"] = makeStartupSnapshot(processStartMs: ZynthStartupMetricsRegistry.processStartMs)
    }
    return result
  }

  func makeStartupSnapshot(processStartMs: Any) -> [String: Any] {
    let averageFrameMs: Double? = framesToFirstRender > 0
      ? (totalFrameMs / Double(framesToFirstRender))
      : nil
    let averageLayoutMs: Double? = framesToFirstRender > 0
      ? (totalLayoutMs / Double(framesToFirstRender))
      : nil

    let runtimeConstructMs = duration(runtimeConstructStartMs, runtimeConstructEndMs)
    let moduleInitMs = duration(moduleInitStartMs, moduleInitEndMs)
    let jsRuntimeSetupMs = duration(jsRuntimeSetupStartMs, jsRuntimeSetupEndMs)
    let startToFirstFrameMs = duration(startRequestedMs, firstFrameMs)
    let runtimeToFirstFrameMs = duration(runtimeInitMs, firstFrameMs)
    let firstCommitToFirstFrameMs = duration(firstCommitMs, firstFrameMs)
    let firstFrameToFirstInteractiveMs = duration(firstFrameMs, firstInteractiveMs)
    let startToFirstInteractiveMs = duration(startRequestedMs, firstInteractiveMs)

    let moduleBreakdown: [[String: Any]] = moduleInitTimings
      .sorted { $0.durationMs > $1.durationMs }
      .map { timing in
        [
          "name": timing.name,
          "startMs": timing.startMs,
          "endMs": timing.endMs,
          "durationMs": timing.durationMs,
          "thread": timing.thread,
        ]
      }

    return [
      "enabled": enabledFeatures.contains("startupTime"),
      "ready": firstFrameMs != nil,
      "processStartMs": processStartMs,
      "runtimeConstructStartMs": boxed(runtimeConstructStartMs),
      "runtimeConstructEndMs": boxed(runtimeConstructEndMs),
      "runtimeConstructMs": boxed(runtimeConstructMs),
      "runtimeInitMs": boxed(runtimeInitMs),
      "moduleInitStartMs": boxed(moduleInitStartMs),
      "moduleInitEndMs": boxed(moduleInitEndMs),
      "moduleInitMs": boxed(moduleInitMs),
      "jsRuntimeSetupStartMs": boxed(jsRuntimeSetupStartMs),
      "jsRuntimeSetupEndMs": boxed(jsRuntimeSetupEndMs),
      "jsRuntimeSetupMs": boxed(jsRuntimeSetupMs),
      "bundleReadMs": boxed(bundleReadMs),
      "hermesEvalMs": boxed(hermesEvalMs),
      "startAppCallMs": boxed(startRequestedMs),
      "firstCommitMs": boxed(firstCommitMs),
      "firstFrameAtMs": boxed(firstFrameMs),
      "firstInteractiveMs": boxed(firstInteractiveMs),
      "startToFirstFrameMs": boxed(startToFirstFrameMs),
      "runtimeToFirstFrameMs": boxed(runtimeToFirstFrameMs),
      "firstCommitToFirstFrameMs": boxed(firstCommitToFirstFrameMs),
      "firstFrameToFirstInteractiveMs": boxed(firstFrameToFirstInteractiveMs),
      "startToFirstInteractiveMs": boxed(startToFirstInteractiveMs),
      "framesToFirstRender": framesToFirstRender,
      "avgFrameMsToFirstRender": boxed(averageFrameMs),
      "avgLayoutMsToFirstRender": boxed(averageLayoutMs),
      "threadByPhase": phaseThreads,
      "moduleInitBreakdown": moduleBreakdown,
    ]
  }

  private func boxed(_ value: Double?) -> Any {
    if let value {
      return value
    }
    return NSNull()
  }

  private func duration(_ start: Double?, _ end: Double?) -> Double? {
    guard let start, let end else {
      return nil
    }
    return max(0.0, end - start)
  }
}
