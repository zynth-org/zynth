import Foundation

public final class HermesAdapter: JSRuntimeAdapter {
  public var onException: ((JsRuntimeException) -> Void)? {
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
      host.exceptionHandler = { [weak self] message, stack in
        guard let self else { return }
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let stackText = stack?.trimmingCharacters(in: .whitespacesAndNewlines)
        let error = JsRuntimeException(
          message: trimmed.isEmpty ? "Unknown Error" : trimmed,
          stack: stackText?.isEmpty == true ? nil : stackText
        )
        self.onException?(error)
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

  // Optional API: evaluate Hermes bytecode when available
  public func evaluate(bytecode data: Data, sourceURL: String = "main.hbc") {
    host.evaluateBytecode(data, sourceURL: sourceURL)
  }

  // Convenience to load from URL
  public func evaluate(bytecodeURL url: URL) throws {
    let data = try Data(contentsOf: url)
    evaluate(bytecode: data, sourceURL: url.lastPathComponent)
  }

  public func callGlobal(_ name: String, args: [Any]) -> Any? {
    host.callGlobal(name, args: args)
    return nil
  }
}
