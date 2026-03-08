import SwiftUI
import Darwin

@main
struct ZynthApp: App {
  init() {
    #if DEBUG
    setenv("OS_ACTIVITY_MODE", "disable", 1)
    #endif
  }

  var body: some Scene {
    WindowGroup {
      ZynthRootView()
        .ignoresSafeArea()
    }
  }
}
