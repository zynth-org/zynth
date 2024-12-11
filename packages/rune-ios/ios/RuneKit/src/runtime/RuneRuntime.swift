import Foundation
import JavaScriptCore
import UIKit

public typealias RuneUIManager = SNUIManager

@objcMembers
public final class RuneRuntime: NSObject {
  let runtime: JSRuntimeAdapter
  let manager: RuneUIManager
  let registry = RuneModuleRegistry()
  internal var lastRootId: Int?

  public init(rootView: UIView, runtime: JSRuntimeAdapter? = nil) {
    self.manager = RuneUIManager(rootView: rootView)

    if let runtime {
      self.runtime = runtime
    } else {
      self.runtime = HermesAdapter(uiManager: manager)
    }

    super.init()
    configureRuntime()
  }

  @objc public convenience init(rootView: UIView) {
    self.init(rootView: rootView, runtime: nil)
  }

  deinit {
    #if DEBUG
      disconnectDevServer()
    #endif
    registry.destroy()
  }

  // Toggle to prefer Hermes Bytecode bundles when available
  public var prefersHermesBytecode: Bool = {
    // Allow override via environment variable RUNE_IOS_USE_HBC=1
    if let v = ProcessInfo.processInfo.environment["RUNE_IOS_USE_HBC"],
      v == "1" || v.lowercased() == "true"
    {
      return true
    }
    return false
  }()

  internal func configureRuntime() {
    let devURL = ProcessInfo.processInfo.environment["RUNE_DEV_SERVER_URL"] ?? "<unset>"
    print("[RuneRuntime] RUNE_DEV_SERVER_URL =", devURL)

    runtime.onException = { error in
      let trimmedMessage = error.message.trimmingCharacters(in: .whitespacesAndNewlines)
      let message = trimmedMessage.isEmpty ? "Unknown Error" : trimmedMessage
      let trimmedStack = error.stack?.trimmingCharacters(in: .whitespacesAndNewlines)
      if let stack = trimmedStack, !stack.isEmpty {
        print("JS error:\n\(message)\nStack:\n\(stack)")
      } else {
        print("JS error:\n\(message)")
      }
      let stackForDisplay = (trimmedStack?.isEmpty == true) ? nil : trimmedStack
      DevRedBox.show(title: "JavaScript Error", message: message, stack: stackForDisplay)
    }

    print("[RuneTrace] configureRuntime using adapter", type(of: runtime))

    #if DEBUG
      print("[RuneRuntime] Installing default modules")
    #endif
    installModules([RuneEnvModule(), RuneDeviceModule(), PerformanceModule()])

    let constants = registry.exportedConstants()
    if !constants.isEmpty,
      let constantsData = try? JSONSerialization.data(withJSONObject: constants, options: [])
    {
      let constantsJson = String(data: constantsData, encoding: .utf8) ?? "{}"
      let script = "globalThis.NativeConstants = \(constantsJson);"
      runtime.evaluate(code: script)
    }

    runtime.evaluate(code: "globalThis.__RUNE_PLATFORM = \"ios\";")
    print("[RuneTrace] __RUNE_PLATFORM set to ios")

    runtime.evaluate(
      code:
        """
        if (typeof globalThis.global === 'undefined') {
          globalThis.global = globalThis;
        }
        if (typeof globalThis.self === 'undefined') {
          globalThis.self = globalThis;
        }
        if (typeof globalThis.window === 'undefined') {
          globalThis.window = globalThis;
        }
        """
    )

    runtime.evaluate(
      code:
        """
        if (typeof globalThis.__modules === 'object' && typeof globalThis.__modules.callSync !== 'function' && typeof globalThis.__runeCallSync === 'function') {
          globalThis.__modules.callSync = globalThis.__runeCallSync;
        }
        """
    )

    runtime.evaluate(
      code:
        """
        if (typeof globalThis.__rune_receiveHMRMessage !== 'function') {
          globalThis.__rune_receiveHMRMessage = function(payload) {
            try {
              if (typeof payload === 'string') {
                payload = JSON.parse(payload);
              }
            } catch (error) {
              console.error('[Rune HMR] parse failed', error);
              return;
            }
            if (payload && typeof globalThis.__rune_refresh === 'function') {
              globalThis.__rune_refresh(payload);
            } else if (payload && typeof globalThis.__rune_requestFullReload === 'function') {
              globalThis.__rune_requestFullReload(payload);
            } else {
              console.warn('[Rune HMR] No refresh handler available', payload && payload.type);
            }
          };
        }
        if (typeof globalThis.__rune_refresh !== 'function') {
          globalThis.__rune_refresh = function(payload) {
            console.warn('[Rune HMR] Refresh invoked with no runtime listener', payload && payload.type);
          };
        }
        """
    )

    #if DEBUG
      configureDevServer()
    #endif

    if let hermes = runtime as? HermesAdapter {
      hermes.configureModuleCall { [weak self] name, method, args in
        guard let self else { throw RuneModuleError.runtimeDeallocated }
        #if DEBUG
          let typeDescription: String
          if let value = args {
            typeDescription = String(describing: type(of: value))
          } else {
            typeDescription = "nil"
          }
          print("[RuneRuntime] moduleCall -> \(name).\(method) argsType=\(typeDescription)")
        #endif
        return try self.registry.call(name, method: method, args: args)
      }
      hermes.configureModuleSyncCall { [weak self] name, method, args in
        guard let self else { throw RuneModuleError.runtimeDeallocated }
        #if DEBUG
          let typeDescription: String
          if let value = args {
            typeDescription = String(describing: type(of: value))
          } else {
            typeDescription = "nil"
          }
          print("[RuneRuntime] moduleCallSync -> \(name).\(method) argsType=\(typeDescription)")
        #endif
        return try self.registry.callSync(name, method: method, args: args)
      }
      return
    }

    runtime.evaluate(code: "globalThis.console = globalThis.console || {};")
    runtime.setGlobalFunction("__runeConsoleLog") { (args: [Any]) -> Any? in
      print("JS:", args)
      return nil
    }
    runtime.evaluate(code: "globalThis.console.log = __runeConsoleLog;")

    if let jsc = (runtime as? JSCAdapter)?.rawContext {
      RuneInstallBindings(jsc, manager)
    }

    let modules: [String: Any] = [
      "call": { [weak self] (args: [Any]) -> Any in
        guard let self else { return ["error": "runtime_deallocated"] }
        guard args.count >= 3,
          let name = args[0] as? String,
          let method = args[1] as? String
        else {
          return ["error": "bad_args"]
        }
        let payload = args[2]

        do {
          let result = try self.registry.call(name, method: method, args: payload)
          return result ?? NSNull()
        } catch {
          let message: String
          if let localized = error as? LocalizedError, let desc = localized.errorDescription {
            message = desc
          } else {
            message = String(describing: error)
          }
          return ["error": message]
        }
      },
      "callSync": { [weak self] (args: [Any]) -> Any in
        guard let self else { return ["error": "runtime_deallocated"] }
        guard args.count >= 2,
          let name = args[0] as? String,
          let method = args[1] as? String
        else {
          return ["error": "bad_args"]
        }

        let payload = args.count > 2 ? args[2] : nil

        do {
          let result = try self.registry.callSync(name, method: method, args: payload)
          return result ?? NSNull()
        } catch {
          let message: String
          if let localized = error as? LocalizedError, let desc = localized.errorDescription {
            message = desc
          } else {
            message = String(describing: error)
          }
          return ["error": message]
        }
      },
    ]
    runtime.setGlobalObject("__modules", modules)

  }

  public func installModules(_ modules: [RuneModule]) {
    modules.forEach(registry.register)
  }

  @objc public func loadInitialBundle(jsBundleURL: URL?) throws {
    #if DEBUG
      if loadDevBundleIfAvailable() {
        return
      }
    #endif

    guard let url = jsBundleURL else {
      throw NSError(
        domain: "dev.rune.runtime",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Bundle URL not provided"]
      )
    }
    try load(jsBundleURL: url)
  }

  public func load(jsBundleURL: URL) throws {
    DevRedBox.dismiss()
    // If we prefer HBC, try loading a sibling .hbc first
    if prefersHermesBytecode, let hermes = runtime as? HermesAdapter {
      let hbcURL = jsBundleURL.deletingPathExtension().appendingPathExtension("hbc")
      if FileManager.default.fileExists(atPath: hbcURL.path) {
        print("[RuneTrace] load() evaluating HBC bundle", hbcURL.lastPathComponent)
        try hermes.evaluate(bytecodeURL: hbcURL)
        print("[RuneTrace] HBC bundle evaluated")
        return
      } else {
        print("[RuneTrace] prefers HBC but file missing:", hbcURL.lastPathComponent)
      }
    }
    // Fallback to JS source text
    let code = try String(contentsOf: jsBundleURL, encoding: .utf8)
    print("[RuneTrace] load() evaluating bundle length", code.count)
    runtime.evaluate(code: code)
    print("[RuneTrace] JS bundle evaluated")
  }

  public func start(rootId: Int) {
    print("[RuneTrace] start() invoking __startApp with rootId", rootId)
    lastRootId = rootId
    _ = runtime.callGlobal("__startApp", args: [rootId])
  }
}

public typealias SolidRuntime = RuneRuntime  // TODO: phase out once external references migrate to RuneRuntime
