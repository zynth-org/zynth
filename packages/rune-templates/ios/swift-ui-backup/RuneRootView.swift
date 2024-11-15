import SwiftUI
import UIKit
import JavaScriptCore
import RuneKit

struct RuneRootView: UIViewRepresentable {
  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeUIView(context: Context) -> UIView {
    context.coordinator.surface
  }

  func updateUIView(_ uiView: UIView, context: Context) {}

  final class Coordinator {
    let surface: UIView
    let uiManager: SNUIManager
    let jsContext: JSContext

    init() {
      surface = UIView(frame: UIScreen.main.bounds)
      surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      surface.backgroundColor = UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1.0)

      uiManager = SNUIManager(rootView: surface)

      jsContext = JSContext()
      jsContext.exceptionHandler = { _, exception in
        if let message = exception?.toString() {
          NSLog("JS Error: %@", message)
        }
      }

      SNInstallBindings(jsContext, uiManager)

      guard let path = Bundle.main.path(forResource: "main", ofType: "js") else {
        assertionFailure("main.js not found (build the JS bundle)")
        return
      }

      do {
        let code = try String(contentsOfFile: path, encoding: .utf8)
        jsContext.evaluateScript(code)
        jsContext.evaluateScript("console.log('JS bootstrap')")
        uiManager.flush()
      } catch {
        NSLog("[Rune] Failed to load main.js: %@", error.localizedDescription)
      }
    }
  }
}
