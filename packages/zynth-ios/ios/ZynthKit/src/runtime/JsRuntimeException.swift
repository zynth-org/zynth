import Foundation

public struct JsRuntimeException {
  public let message: String
  public let stack: String?

  public init(message: String, stack: String?) {
    self.message = message
    self.stack = stack
  }
}
