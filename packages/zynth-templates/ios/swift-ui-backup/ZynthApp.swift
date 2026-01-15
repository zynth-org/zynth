import SwiftUI

@main
struct ZynthApp: App {
  var body: some Scene {
    WindowGroup {
      ZynthRootView()
        .ignoresSafeArea()
    }
  }
}
