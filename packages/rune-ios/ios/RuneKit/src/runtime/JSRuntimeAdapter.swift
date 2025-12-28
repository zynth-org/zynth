import Foundation

public protocol JSRuntimeAdapter: AnyObject {
  var onException: ((JsRuntimeException) -> Void)? { get set }
  func setGlobalObject(_ name: String, _ value: Any)
  func setGlobalFunction(_ name: String, _ fn: @escaping ([Any]) -> Any?)
  func evaluate(code: String)
  func callGlobal(_ name: String, args: [Any]) -> Any?
}
