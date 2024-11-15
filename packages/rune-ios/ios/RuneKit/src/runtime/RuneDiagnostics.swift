import Foundation

@objc public final class RuneDiagnostics: NSObject {
  @objc public static func report(_ phase: String, message: String, stack: String) {
    print("[Rune][\(phase)]", message, "\n", stack)
    let stackValue = stack.isEmpty ? nil : stack
    DevRedBox.show(title: "[\(phase)] \(message)", stack: stackValue)
  }
}

@_cdecl("RuneDiagnosticsReport")
public func RuneDiagnosticsReport(_ phaseC: UnsafePointer<CChar>, _ msgC: UnsafePointer<CChar>, _ stackC: UnsafePointer<CChar>) {
  let phase = String(cString: phaseC)
  let message = String(cString: msgC)
  let stack = String(cString: stackC)
  RuneDiagnostics.report(phase, message: message, stack: stack)
}
