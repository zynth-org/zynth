import Foundation
import JavaScriptCore

public protocol JSRuntimeAdapter: AnyObject {
  var onException: ((JsRuntimeException) -> Void)? { get set }
  func setGlobalObject(_ name: String, _ value: Any)
  func setGlobalFunction(_ name: String, _ fn: @escaping ([Any]) -> Any?)
  func evaluate(code: String)
  func callGlobal(_ name: String, args: [Any]) -> Any?
}

public final class JSCAdapter: JSRuntimeAdapter {
  let ctx = JSContext()!
  public var onException: ((JsRuntimeException) -> Void)?

  public init() {
    ctx.exceptionHandler = { [weak self] _, exception in
      guard let self else { return }
      let message = (exception?.toString() ?? "unknown").trimmingCharacters(in: .whitespacesAndNewlines)
      let stackValue = exception?.objectForKeyedSubscript("stack")
      let stack = stackValue?.toString()?.trimmingCharacters(in: .whitespacesAndNewlines)
      let error = JsRuntimeException(message: message.isEmpty ? "Unknown Error" : message, stack: stack)
      self.onException?(error)
    }
  }

  public func setGlobalObject(_ name: String, _ value: Any) {
    ctx.setObject(value, forKeyedSubscript: name as (NSCopying & NSObjectProtocol))
  }

  public func setGlobalFunction(_ name: String, _ fn: @escaping ([Any]) -> Any?) {
    let block: @convention(block) ([Any]) -> Any? = { fn($0) }
    ctx.setObject(block, forKeyedSubscript: name as (NSCopying & NSObjectProtocol))
  }

  public func evaluate(code: String) {
    _ = ctx.evaluateScript(code)
  }

  public func callGlobal(_ name: String, args: [Any]) -> Any? {
    ctx.objectForKeyedSubscript(name)?.call(withArguments: args)?.toObject()
  }

  public var rawContext: JSContext {
    ctx
  }
}
