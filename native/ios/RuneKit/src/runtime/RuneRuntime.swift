import Foundation
import UIKit
import JavaScriptCore

public typealias RuneUIManager = SNUIManager

public final class RuneRuntime {
  let runtime: JSRuntimeAdapter
  let manager: RuneUIManager
  let registry = RuneModuleRegistry()

  public init(rootView: UIView, runtime: JSRuntimeAdapter = JSCAdapter()) {
    self.runtime = runtime
    self.manager = RuneUIManager(rootView: rootView)

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
              let method = args[1] as? String else {
          return ["error": "bad_args"]
        }
        let payload = args[2]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        let out = self.registry.call(name, method: method, argsJSON: json)
        let outData = Data(out.utf8)
        return (try? JSONSerialization.jsonObject(with: outData)) ?? [:]
      },
    ]
    runtime.setGlobalObject("__modules", modules)
  }

  public func installModules(_ modules: [RuneModule]) {
    modules.forEach(registry.register)
  }

  public func load(jsBundleURL: URL) throws {
    let code = try String(contentsOf: jsBundleURL, encoding: .utf8)
    runtime.onException = { print("JS error:", $0) }
    runtime.evaluate(code: code)
  }

  public func start(rootId: Int) {
    _ = runtime.callGlobal("__startApp", args: [rootId])
  }
}

public typealias SolidRuntime = RuneRuntime // TODO: phase out once external references migrate to RuneRuntime
