//
//  RuneRuntime+DevSupport.swift
//  RuneKit
//
//  Dev-only extension for HMR and dev server support.
//  This file is only included in DEBUG builds.
//

#if DEBUG
  import Foundation

  // MARK: - Dev Server Properties & Initialization

  extension RuneRuntime {

    /// Storage for dev-only properties using associated objects
    private struct AssociatedKeys {
      static var devClient = "devClient"
      static var devServerURL = "devServerURL"
      static var lastDevBundle = "lastDevBundle"
      static var statusBar = "statusBar"
    }

    var devClient: RuneDevClient? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.devClient) as? RuneDevClient
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.devClient, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      }
    }

    var devServerURL: URL? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.devServerURL) as? URL
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.devServerURL, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      }
    }

    var lastDevBundle: RuneDevBundle? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.lastDevBundle) as? RuneDevBundle
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.lastDevBundle, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      }
    }

    var statusBar: RuneDevStatusBar {
      if let existing = objc_getAssociatedObject(self, &AssociatedKeys.statusBar)
        as? RuneDevStatusBar
      {
        return existing
      }
      let newStatusBar = RuneDevStatusBar()
      objc_setAssociatedObject(
        self, &AssociatedKeys.statusBar, newStatusBar, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      return newStatusBar
    }
  }

  // MARK: - Dev Server Configuration

  extension RuneRuntime {

    /// Configures dev server support during runtime initialization.
    /// Called from `configureRuntime()` in DEBUG builds only.
    func configureDevServer() {
      // Install HMR shim for hot module replacement
      runtime.evaluate(
        code:
          """
          if (typeof globalThis.__modules === 'object' && typeof globalThis.__modules.callSync !== 'function' && typeof globalThis.__runeCallSync === 'function') {
            globalThis.__modules.callSync = globalThis.__runeCallSync;
          }
          """
      )

      runtime.evaluate(
        code:
          """
          if (typeof globalThis.__rune_receiveHMRMessage !== 'function') {
            globalThis.__rune_receiveHMRMessage = function(payload) {
              try {
                if (typeof payload === 'string') {
                  payload = JSON.parse(payload);
                }
              } catch (error) {
                console.error('[Rune HMR] parse failed', error);
                return;
              }
              if (payload && typeof globalThis.__rune_refresh === 'function') {
                globalThis.__rune_refresh(payload);
              } else if (payload && typeof globalThis.__rune_requestFullReload === 'function') {
                globalThis.__rune_requestFullReload(payload);
              } else {
                console.warn('[Rune HMR] No refresh handler available', payload && payload.type);
              }
            };
          }
          if (typeof globalThis.__rune_refresh !== 'function') {
            globalThis.__rune_refresh = function(payload) {
              console.warn('[Rune HMR] Refresh invoked with no runtime listener', payload && payload.type);
            };
          }
          """
      )

      // Auto-connect to dev server if RUNE_DEV_SERVER_URL is set
      if let urlString = ProcessInfo.processInfo.environment["RUNE_DEV_SERVER_URL"],
        let url = URL(string: urlString)
      {
        devServerURL = url
        installDevServerGlobal(url: url)
        print("[RuneRuntime] Connecting to dev server at \(url.absoluteString)")
        connectToDevServer(url)
      }
    }

    /// Disconnects from dev server during cleanup.
    /// Called from `deinit` in DEBUG builds only.
    func disconnectDevServer() {
      devClient?.disconnect()
    }
  }

  // MARK: - Dev Server Connection

  extension RuneRuntime {

    /// Connects to a dev server for HMR support.
    /// - Parameter url: The dev server URL (e.g., http://localhost:8081)
    public func connectToDevServer(_ url: URL) {
      devServerURL = url
      installDevServerGlobal(url: url)
      if devClient == nil {
        devClient = RuneDevClient(url: url, runtime: self)
      }
      devClient?.connect()
    }

    /// Handles incoming HMR messages from the dev server.
    /// - Parameter text: The raw message payload (typically JSON)
    func handleDevMessage(_ text: String) {
      // Show update notification when HMR message received
      if text.contains("\"type\":\"update\"") || text.contains("'type':'update'") {
        statusBar.showUpdateAvailable()
      }
      _ = runtime.callGlobal("__rune_receiveHMRMessage", args: [text])
    }

    private func installDevServerGlobal(url: URL) {
      let escaped = url.absoluteString
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      runtime.evaluate(
        code: "globalThis.__RUNE_DEV_SERVER_URL = \"\(escaped)\";"
      )
    }
  }

  // MARK: - Dev Bundle Loading

  extension RuneRuntime {

    /// Attempts to load a JavaScript bundle from the dev server.
    /// - Returns: `true` if bundle was loaded successfully, `false` otherwise
    func loadDevBundleIfAvailable() -> Bool {
      guard let devURL = devServerURL else { return false }

      print("[RuneRuntime] 📦 loadDevBundleIfAvailable called")
      statusBar.showBundleLoading()

      do {
        let bundle = try RuneDevBundleFetcher.fetch(baseURL: devURL)
        lastDevBundle = bundle
        evaluateDevBundle(bundle.code, description: bundle.url.absoluteString)
        print("[RuneRuntime] ✅ Bundle loaded successfully, showing status")
        DispatchQueue.main.async {
          self.statusBar.showBundleLoaded()
        }
        return true
      } catch {
        let message = "Dev bundle fetch failed: \(error.localizedDescription)"
        print("[RuneRuntime] ❌ \(message)")
        statusBar.showError("Bundle Load Failed")
        DevRedBox.show(title: "Dev Bundle Error", message: message, stack: nil)
        if let cached = lastDevBundle {
          print("[RuneRuntime] 💾 Falling back to cached dev bundle")
          evaluateDevBundle(cached.code, description: "cached bundle")
          DispatchQueue.main.async {
            self.statusBar.showBundleLoaded()
          }
          return true
        }
        return false
      }
    }

    private func evaluateDevBundle(_ code: String, description: String) {
      // For dev reloads, we need to reset the runtime to avoid corruption
      // This creates a fresh JS environment AND clears the old UI
      if lastDevBundle != nil {
        print("[RuneRuntime] Resetting runtime and clearing UI for dev reload")

        // Ensure UI cleanup happens on main thread
        if Thread.isMainThread {
          manager.clearAllNodes()
        } else {
          DispatchQueue.main.sync {
            self.manager.clearAllNodes()
          }
        }

        configureRuntime()
      }

      runtime.evaluate(code: code)
      print("[RuneRuntime] Evaluated dev bundle from \(description)")
    }

    /// Manually triggers a dev bundle refresh from the server.
    /// Called when user requests reload or HMR update is received.
    public func refreshDevBundle() {
      guard devServerURL != nil else {
        NSLog("[RuneRuntime] refreshDevBundle called without devServerURL")
        return
      }
      print("[RuneRuntime] ⚡️ refreshDevBundle called from thread: \(Thread.current)")
      statusBar.showUpdating()
      if loadDevBundleIfAvailable() {
        restartAfterReload()
      }
    }

    private func restartAfterReload() {
      guard let rootId = lastRootId else { return }
      print("[RuneRuntime] Restarting app after dev reload with rootId", rootId)
      _ = runtime.callGlobal("__startApp", args: [rootId])
    }
  }

#endif
