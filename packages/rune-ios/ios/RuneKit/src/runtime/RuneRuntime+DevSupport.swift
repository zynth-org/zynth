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
      print("[RuneRuntime] 🔧 Configuring dev server support...")

      // Install HMR shim for hot module replacement
      runtime.evaluate(
        code:
          """
          if (typeof globalThis.__modules === 'object' && typeof globalThis.__modules.callSync !== 'function' && typeof globalThis.__runeCallSync === 'function') {
            globalThis.__modules.callSync = globalThis.__runeCallSync;
          }
          """
      )

      // Install the HMR message receiver
      runtime.evaluate(
        code:
          """
          if (typeof globalThis.__rune_receiveHMRMessage !== 'function') {
            globalThis.__rune_receiveHMRMessage = function(payload) {
              console.log('[Rune HMR] Received message:', typeof payload);
              try {
                if (typeof payload === 'string') {
                  payload = JSON.parse(payload);
                }
              } catch (error) {
                console.error('[Rune HMR] parse failed', error);
                return;
              }
              if (payload && typeof globalThis.__rune_refresh === 'function') {
                console.log('[Rune HMR] Calling __rune_refresh with type:', payload.type);
                globalThis.__rune_refresh(payload);
              } else if (payload && typeof globalThis.__rune_requestFullReload === 'function') {
                console.log('[Rune HMR] Calling __rune_requestFullReload');
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
          console.log('[Rune HMR] Runtime hooks installed');
          """
      )

      // Auto-connect to dev server if RUNE_DEV_SERVER_URL is set
      if let urlString = ProcessInfo.processInfo.environment["RUNE_DEV_SERVER_URL"],
        let url = URL(string: urlString)
      {
        devServerURL = url
        installDevServerGlobal(url: url)
        print("[RuneRuntime] 🌐 Connecting to dev server at \(url.absoluteString)")
        connectToDevServer(url)
      } else {
        print("[RuneRuntime] ℹ️ RUNE_DEV_SERVER_URL not set, skipping auto-connect")
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
      guard
        let data = text.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data, options: []),
        let payload = object as? [String: Any],
        let type = payload["type"] as? String
      else {
        print("[RuneRuntime] HMR message is not valid JSON, ignoring")
        return
      }

      print("[RuneRuntime] 📨 Processing HMR message type: \(type)")

      switch type {
      case "update":
        // This is the actual hot update message from rsbuild
        statusBar.showUpdateAvailable()
        handleUpdateMessage(payload)

      case "hash":
        // New build hash - store it for reference
        if let hash = payload["data"] as? String {
          print("[RuneRuntime] 🔑 Build hash updated: \(hash)")
        }

      default:
        // Forward unknown messages to JS runtime
        _ = runtime.callGlobal("__rune_receiveHMRMessage", args: [text])
      }
    }

    private func handleUpdateMessage(_ payload: [String: Any]) {
      print("[RuneRuntime] 🔥 Hot update message received")

      // Try to extract chunk information from the update payload
      // Rsbuild/rspack sends updates with chunk IDs that need to be fetched
      if let data = payload["data"] as? [String: Any] {
        print("[RuneRuntime] Update data: \(data.keys)")
      }

      // Apply the hot update by fetching the manifest
      applyHotUpdate()
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

    public func applyHotUpdate() {
      guard let devServerURL else {
        print("[RuneRuntime] Hot update requested without dev server URL, doing full reload")
        DispatchQueue.main.async {
          self.refreshDevBundle()
        }
        return
      }

      print("[RuneRuntime] 🔥 Applying hot update...")
      statusBar.showUpdating()

      // Fetch the hot-update manifest from rsbuild
      let manifestURL = devServerURL.appendingPathComponent("bundle/app.hot-update.json")
      print("[RuneRuntime] 📦 Fetching manifest: \(manifestURL.absoluteString)")

      var request = URLRequest(url: manifestURL)
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      request.timeoutInterval = 10

      URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
        guard let self else { return }

        if let error {
          print("[RuneRuntime] ❌ Manifest fetch failed: \(error.localizedDescription)")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        guard let httpResponse = response as? HTTPURLResponse else {
          print("[RuneRuntime] ❌ Invalid response type")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        guard httpResponse.statusCode == 200 else {
          print("[RuneRuntime] ❌ Manifest fetch returned status \(httpResponse.statusCode)")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        guard let data else {
          print("[RuneRuntime] ❌ Manifest fetch returned no data")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          print("[RuneRuntime] ❌ Manifest JSON decode failed")
          if let str = String(data: data, encoding: .utf8) {
            print("[RuneRuntime] Raw response: \(str.prefix(200))")
          }
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        print("[RuneRuntime] ✅ Manifest loaded: \(object.keys)")

        // Extract chunk IDs from the manifest
        // Rsbuild can send chunks in different formats
        let chunkIds: [String]
        if let cArray = object["c"] as? [String] {
          chunkIds = cArray
        } else if let cDict = object["c"] as? [String: Any] {
          chunkIds = Array(cDict.keys)
        } else if let h = object["h"] as? String {
          // Sometimes only a hash is provided - use it to construct chunk name
          chunkIds = ["app"]
        } else {
          print("[RuneRuntime] ❌ No chunks found in manifest: \(object)")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        self.fetchAndApplyHotUpdateChunks(chunkIds: chunkIds)
      }.resume()
    }

    private func fallbackToFullReload() {
      print("[RuneRuntime] 🔄 Falling back to full bundle reload")
      self.refreshDevBundle()
    }

    private func fetchAndApplyHotUpdateChunks(chunkIds: [String]) {
      guard !chunkIds.isEmpty else {
        print("[RuneRuntime] ⚠️ No hot-update chunks to fetch, falling back to full reload")
        DispatchQueue.main.async {
          self.fallbackToFullReload()
        }
        return
      }

      guard let devServerURL else {
        print("[RuneRuntime] ❌ No dev server URL available")
        return
      }

      print("[RuneRuntime] 📥 Fetching \(chunkIds.count) hot-update chunk(s): \(chunkIds)")

      let group = DispatchGroup()
      let lock = NSLock()
      var chunkScripts: [String: String] = [:]
      var fetchErrors: [String: String] = [:]

      for chunkId in chunkIds {
        group.enter()
        let chunkURL = devServerURL.appendingPathComponent("bundle/\(chunkId).hot-update.js")

        var request = URLRequest(url: chunkURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 10

        print("[RuneRuntime]   Fetching: \(chunkURL.absoluteString)")

        URLSession.shared.dataTask(with: request) { data, response, error in
          defer { group.leave() }

          if let error {
            let errorMsg = "Failed to fetch chunk \(chunkId): \(error.localizedDescription)"
            print("[RuneRuntime] ❌ \(errorMsg)")
            lock.lock()
            fetchErrors[chunkId] = errorMsg
            lock.unlock()
            return
          }

          guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200
          else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            let errorMsg = "Chunk \(chunkId) returned status \(statusCode)"
            print("[RuneRuntime] ❌ \(errorMsg)")
            lock.lock()
            fetchErrors[chunkId] = errorMsg
            lock.unlock()
            return
          }

          guard let data, let code = String(data: data, encoding: .utf8) else {
            let errorMsg = "Chunk \(chunkId) returned invalid data"
            print("[RuneRuntime] ❌ \(errorMsg)")
            lock.lock()
            fetchErrors[chunkId] = errorMsg
            lock.unlock()
            return
          }

          print("[RuneRuntime] ✅ Chunk \(chunkId) fetched (\(code.count) bytes)")
          lock.lock()
          chunkScripts[chunkId] = code
          lock.unlock()
        }.resume()
      }

      group.notify(queue: .main) { [weak self] in
        guard let self else { return }

        // Check if we got any chunks
        let successCount = chunkScripts.count
        let errorCount = fetchErrors.count

        print(
          "[RuneRuntime] 📊 Chunk fetch complete: \(successCount) succeeded, \(errorCount) failed")

        if successCount == 0 {
          print("[RuneRuntime] ❌ No chunks fetched successfully, performing full reload")
          self.fallbackToFullReload()
          return
        }

        if errorCount > 0 {
          print("[RuneRuntime] ⚠️ Some chunks failed to fetch, but proceeding with available chunks")
        }

        // Execute chunks in order
        for chunkId in chunkIds {
          guard let code = chunkScripts[chunkId] else {
            print("[RuneRuntime] ⏭️ Skipping chunk \(chunkId) (not fetched)")
            continue
          }

          print("[RuneRuntime] ⚡️ Executing hot-update chunk: \(chunkId)")

          do {
            self.runtime.evaluate(code: code)
            print("[RuneRuntime] ✅ Chunk \(chunkId) executed successfully")
          } catch {
            print("[RuneRuntime] ❌ Failed to execute chunk \(chunkId): \(error)")
          }
        }

        print("[RuneRuntime] 🎉 Hot update applied successfully!")
        self.statusBar.showBundleLoaded()
      }
    }
  }

#endif
