import Foundation

@objc public final class ZynthDiagnostics: NSObject {
  @objc public static func report(_ phase: String, message: String, stack: String) {
    print("[Zynth][\(phase)]", message, "\n", stack)
    let stackValue = stack.isEmpty ? nil : stack
    DevRedBox.showGlobal(title: "[\(phase)] \(message)", message: message, stack: stackValue)
  }
}

@_cdecl("ZynthDiagnosticsReport")
public func ZynthDiagnosticsReport(_ phaseC: UnsafePointer<CChar>, _ msgC: UnsafePointer<CChar>, _ stackC: UnsafePointer<CChar>) {
  let phase = String(cString: phaseC)
  let message = String(cString: msgC)
  let stack = String(cString: stackC)
  ZynthDiagnostics.report(phase, message: message, stack: stack)
}
