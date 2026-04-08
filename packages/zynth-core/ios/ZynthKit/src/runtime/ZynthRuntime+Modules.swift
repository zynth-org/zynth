import Foundation
import ObjectiveC
#if DEBUG
import Darwin
#endif

private var zynthModuleRegistryKey: UInt8 = 0

#if DEBUG
private var zynthCrashHandlersInstalled = false
private weak var zynthCrashRuntime: ZynthRuntime?
private var zynthPrevExceptionHandler: (@convention(c) (NSException) -> Void)?
private var zynthCrashPipe: [Int32] = [-1, -1]
private var zynthCrashWriteFD: Int32 = -1
private var zynthCrashReadSource: DispatchSourceRead?
private let zynthCrashQueue = DispatchQueue(label: "dev.zynth.crash")

private func zynthHandleUncaughtException(_ exception: NSException) {
  let data: [String: Any] = [
    "name": exception.name.rawValue,
    "reason": exception.reason ?? "",
    "stack": exception.callStackSymbols.joined(separator: "\n"),
  ]
  zynthCrashRuntime?.emitDevtoolsEvent(topic: "crash/exception", level: "error", tag: "crash", data: data)
  zynthPrevExceptionHandler?(exception)
}

@_cdecl("zynth_devtools_signal_handler")
private func zynthDevtoolsSignalHandler(_ signal: Int32) {
  if zynthCrashWriteFD != -1 {
    var sig = signal
    withUnsafePointer(to: &sig) { ptr in
      _ = Darwin.write(zynthCrashWriteFD, ptr, MemoryLayout<Int32>.size)
    }
  }
  Darwin.signal(signal, SIG_DFL)
  Darwin.raise(signal)
}

private func zynthInstallSignalHandlers() {
  if zynthCrashPipe[0] != -1 { return }
  var fds: [Int32] = [0, 0]
  if Darwin.pipe(&fds) != 0 { return }
  zynthCrashPipe = fds
  zynthCrashWriteFD = fds[1]

  let source = DispatchSource.makeReadSource(fileDescriptor: fds[0], queue: zynthCrashQueue)
  source.setEventHandler {
    var sig: Int32 = 0
    let readBytes = withUnsafeMutablePointer(to: &sig) { ptr in
      Darwin.read(fds[0], ptr, MemoryLayout<Int32>.size)
    }
    guard readBytes == MemoryLayout<Int32>.size else { return }
    let data: [String: Any] = [
      "signal": sig,
      "message": "Signal \(sig)",
    ]
    zynthCrashRuntime?.emitDevtoolsEvent(topic: "crash/signal", level: "error", tag: "crash", data: data)
  }
  source.setCancelHandler {
    Darwin.close(fds[0])
    Darwin.close(fds[1])
  }
  source.resume()
  zynthCrashReadSource = source

  let signals: [Int32] = [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGFPE]
  for sig in signals {
    Darwin.signal(sig, zynthDevtoolsSignalHandler)
  }
}
#endif

public extension ZynthRuntime {
  private var zynthModuleRegistry: ZynthModuleRegistry {
    if let registry = objc_getAssociatedObject(self, &zynthModuleRegistryKey) as? ZynthModuleRegistry {
      return registry
    }
    let registry = ZynthModuleRegistry()
    objc_setAssociatedObject(self, &zynthModuleRegistryKey, registry, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    return registry
  }

  func installModules(_ modules: [ZynthModule]) {
    ZynthStartupMetricsRegistry.markModuleInitStart(forSession: bridgeSessionId)
    for module in modules {
      ZynthStartupMetricsRegistry.markModuleInitializeStart(forSession: bridgeSessionId, moduleName: module.name)
      zynthModuleRegistry.register(module)
      ZynthStartupMetricsRegistry.markModuleInitializeEnd(forSession: bridgeSessionId, moduleName: module.name)
    }
    ZynthStartupMetricsRegistry.markModuleInitEnd(forSession: bridgeSessionId)
    zynthModuleRegistry.setSessionId(bridgeSessionId)
    // Register the registry as the bridge and inject constants
    ZynthStartupMetricsRegistry.markJsRuntimeSetupStart(forSession: bridgeSessionId)
    var constants = zynthModuleRegistry.exportedConstants()
    constants["bridgeSessionId"] = bridgeSessionId
    installModuleBridge(zynthModuleRegistry, constants: constants)
    ZynthStartupMetricsRegistry.markJsRuntimeSetupEnd(forSession: bridgeSessionId)
  }

  @objc func installDefaultModules() {
    let fetch = FetchModule { [weak self] name, data in
      self?.emitEvent(name: name, payload: data)
    }
    let coreSystem = CoreSystemModule(runtime: self)
    let webSocket = WebSocketModule(runtime: self)
    var modules: [ZynthModule] = [fetch, coreSystem, webSocket]
#if DEBUG
    modules.append(ZynthDevtoolsModule(runtime: self))
    installDevtoolsCrashHandlersIfNeeded()
#endif
    installModules(modules)
  }

  func emitEvent(name: String, payload: Any?) {
    emitEvent(withName: name, payload: payload)
  }

#if DEBUG
  fileprivate func emitDevtoolsEvent(topic: String, level: String = "error", tag: String = "runtime", data: Any?) {
    var event: [String: Any] = ["topic": topic]
    event["level"] = level
    event["tag"] = tag
    if let data {
      event["data"] = data
    }
    _ = zynthModuleRegistry.callModule("Devtools", method: "emit", args: event)
  }

  private func installDevtoolsCrashHandlersIfNeeded() {
    if zynthCrashHandlersInstalled { return }
    zynthCrashHandlersInstalled = true
    zynthCrashRuntime = self

    let previous = NSGetUncaughtExceptionHandler()
    zynthPrevExceptionHandler = previous
    NSSetUncaughtExceptionHandler(zynthHandleUncaughtException)

    zynthInstallSignalHandlers()
  }
#endif
}
