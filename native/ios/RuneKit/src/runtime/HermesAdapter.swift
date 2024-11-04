import Foundation

public final class HermesAdapter: JSRuntimeAdapter {
  public var onException: ((String) -> Void)? {
    didSet { installExceptionHandler() }
  }
  private let host: HermesRuntimeHost

  public init(uiManager: SNUIManager) {
    self.host = HermesRuntimeHost(uiManager: uiManager)
    installExceptionHandler()
  }

  public func configureModuleCall(_ handler: @escaping (String, String, String) -> String) {
    host.moduleCallHandler = handler
  }

  private func installExceptionHandler() {
    if onException != nil {
      host.exceptionHandler = { [weak self] message in
        guard let self else { return }
        self.onException?(message)
      }
    } else {
      host.exceptionHandler = nil
    }
  }

  public func setGlobalObject(_ name: String, _ value: Any) {
    // Hermes host registers globals directly via native bridges.
  }

  public func setGlobalFunction(_ name: String, _ fn: @escaping ([Any]) -> Any?) {
    // Not required with native Hermes bindings; keep stub for protocol.
  }

  public func evaluate(code: String) {
    host.evaluateString(code)
  }

  public func callGlobal(_ name: String, args: [Any]) -> Any? {
    host.callGlobal(name, args: args)
    return nil
  }
}
