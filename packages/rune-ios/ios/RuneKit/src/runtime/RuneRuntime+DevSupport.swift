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
      static var devServerToken = "devServerToken"
      static var lastDevBundle = "lastDevBundle"
      static var statusBar = "statusBar"
      static var latestDevHash = "latestDevHash"
      static var lastAppliedDevHash = "lastAppliedDevHash"
      static var isApplyingHotUpdate = "isApplyingHotUpdate"
      static var devRuntimeName = "devRuntimeName"
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

    var devServerToken: String? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.devServerToken) as? String
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.devServerToken, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC)
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

    var latestDevHash: String? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.latestDevHash) as? String
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.latestDevHash, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC)
      }
    }

    var lastAppliedDevHash: String? {
      get {
        objc_getAssociatedObject(self, &AssociatedKeys.lastAppliedDevHash) as? String
      }
      set {
        objc_setAssociatedObject(
          self, &AssociatedKeys.lastAppliedDevHash, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC)
      }
    }

    var isApplyingHotUpdate: Bool {
      get {
        (objc_getAssociatedObject(self, &AssociatedKeys.isApplyingHotUpdate) as? NSNumber)
          .map { $0.boolValue } ?? false
      }
      set {
        objc_setAssociatedObject(
          self,
          &AssociatedKeys.isApplyingHotUpdate,
          NSNumber(value: newValue),
          .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )
      }
    }

    var devRuntimeName: String {
      get {
        (objc_getAssociatedObject(self, &AssociatedKeys.devRuntimeName) as? String)
          .flatMap { $0.isEmpty ? nil : $0 } ?? "app"
      }
      set {
        objc_setAssociatedObject(
          self,
          &AssociatedKeys.devRuntimeName,
          newValue,
          .OBJC_ASSOCIATION_COPY_NONATOMIC
        )
      }
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
              console.warn('[Rune HMR1] Refresh invoked with no runtime listener', payload && payload.type);
            };
            Object.defineProperty(globalThis.__rune_refresh, '__isRuneDefaultStub', {
              value: true,
              configurable: true,
              enumerable: false,
              writable: false,
            });
          }
          console.log('[Rune HMR] Runtime hooks installed');
          """
      )

      // Auto-connect to dev server if RUNE_DEV_SERVER_URL is set
      let env = ProcessInfo.processInfo.environment
      if let runtimeOverride = env["RUNE_DEV_RUNTIME"]?.trimmingCharacters(
        in: .whitespacesAndNewlines),
        !runtimeOverride.isEmpty
      {
        devRuntimeName = runtimeOverride
      } else {
        devRuntimeName = "app"
      }
      if let urlString = env["RUNE_DEV_SERVER_URL"], let rawURL = URL(string: urlString) {
        let url = normalizeDevServerURL(rawURL)
        devServerURL = url
        let tokenEnv = sanitizedToken(env["RUNE_DEV_SERVER_TOKEN"])
        devServerToken = tokenEnv
        installDevServerGlobal(url: url, token: tokenEnv)
        print("[RuneRuntime] 🌐 Connecting to dev server at \(url.absoluteString)")
        connectToDevServer(url, token: tokenEnv)
      } else {
        print("[RuneRuntime] ℹ️ RUNE_DEV_SERVER_URL not set, skipping auto-connect")
      }
    }

    /// Disconnects from dev server during cleanup.
    /// Called from `deinit` in DEBUG builds only.
    func disconnectDevServer() {
      devClient?.disconnect()
      devServerToken = nil
    }
  }

  // MARK: - Dev Server Connection

  extension RuneRuntime {

    /// Connects to a dev server for HMR support.
    /// - Parameter url: The dev server URL (e.g., http://localhost:8081)
    public func connectToDevServer(_ url: URL, token: String? = nil) {
      let normalizedURL = normalizeDevServerURL(url)
      devServerURL = normalizedURL
      let cleanedToken = sanitizedToken(token) ?? devServerToken
      devServerToken = cleanedToken
      installDevServerGlobal(url: normalizedURL, token: cleanedToken)
      if devClient == nil {
        devClient = RuneDevClient(url: normalizedURL, runtime: self, token: cleanedToken)
      } else {
        devClient?.updateConfiguration(url: normalizedURL, token: cleanedToken)
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
        ensureMain { self.statusBar.showUpdateAvailable() }
        handleUpdateMessage(payload)

      case "hash":
        // New build hash - store it for reference
        if let hash = payload["data"] as? String {
          print("[RuneRuntime] 🔑 Build hash updated: \(hash)")
          latestDevHash = hash
        }

      case "ok", "still-ok", "built", "sync":
        handleCompilationSuccess(trigger: type)

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

    private func handleCompilationSuccess(trigger: String) {
      if isApplyingHotUpdate {
        print("[RuneRuntime] ⏳ Ignoring \(trigger) message; hot update is already in flight")
        return
      }

      guard devServerURL != nil else {
        print("[RuneRuntime] ℹ️ Received \(trigger) without dev server URL; skipping")
        return
      }

      guard lastDevBundle != nil else {
        print("[RuneRuntime] ℹ️ Received \(trigger) before initial dev bundle loaded; waiting")
        return
      }

      guard let latestHash = latestDevHash else {
        print("[RuneRuntime] ℹ️ \(trigger) message arrived without a hash; performing full reload")
        DispatchQueue.main.async {
          self.refreshDevBundle()
        }
        return
      }

      if lastAppliedDevHash == nil {
        print("[RuneRuntime] ℹ️ Recording initial hash \(latestHash); skipping hot update trigger")
        lastAppliedDevHash = latestHash
        return
      }

      if let appliedHash = lastAppliedDevHash, appliedHash == latestHash {
        print("[RuneRuntime] ℹ️ Hash \(latestHash) already applied; skipping hot update trigger")
        return
      }

      print("[RuneRuntime] ♻️ Triggering hot update after \(trigger) message (hash: \(latestHash))")
      applyHotUpdate()
    }

    private func installDevServerGlobal(url: URL, token: String?) {
      let escaped = url.absoluteString
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      runtime.evaluate(
        code: "globalThis.__RUNE_DEV_SERVER_URL = \"\(escaped)\";"
      )
      if let token {
        let escapedToken =
          token
          .replacingOccurrences(of: "\\", with: "\\\\")
          .replacingOccurrences(of: "\"", with: "\\\"")
        runtime.evaluate(
          code: "globalThis.__RUNE_DEV_SERVER_TOKEN = \"\(escapedToken)\";"
        )
      } else {
        runtime.evaluate(code: "delete globalThis.__RUNE_DEV_SERVER_TOKEN;")
      }
    }
  }

  // MARK: - Dev Bundle Loading

  extension RuneRuntime {

    /// Attempts to load a JavaScript bundle from the dev server.
    /// - Returns: `true` if bundle was loaded successfully, `false` otherwise
    func loadDevBundleIfAvailable() -> Bool {
      guard let devURL = devServerURL else { return false }

      print("[RuneRuntime] 📦 loadDevBundleIfAvailable called")
      ensureMain { self.statusBar.showBundleLoading() }

      do {
        let bundle = try RuneDevBundleFetcher.fetch(baseURL: devURL, token: devServerToken)
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
        ensureMain { self.statusBar.showError("Bundle Load Failed") }
        self.redBox.show(title: "Dev Bundle Error", message: message, stack: nil)
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
      if let latestHash = latestDevHash {
        lastAppliedDevHash = latestHash
      }
    }

    /// Manually triggers a dev bundle refresh from the server.
    /// Called when user requests reload or HMR update is received.
    public func refreshDevBundle() {
      guard devServerURL != nil else {
        NSLog("[RuneRuntime] refreshDevBundle called without devServerURL")
        return
      }
      print("[RuneRuntime] ⚡️ refreshDevBundle called from thread: \(Thread.current)")
      ensureMain { self.statusBar.showUpdating() }
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
      if isApplyingHotUpdate {
        print("[RuneRuntime] ⏳ Hot update request ignored; another update is in progress")
        return
      }

      guard let devServerURL else {
        print("[RuneRuntime] Hot update requested without dev server URL, doing full reload")
        DispatchQueue.main.async {
          self.refreshDevBundle()
        }
        return
      }

      isApplyingHotUpdate = true
      print("[RuneRuntime] 🔥 Applying hot update...")
      ensureMain { self.statusBar.showUpdating() }

      let manifestCandidates = hotUpdateManifestPaths()
      print("[RuneRuntime] 📦 Manifest candidates: \(manifestCandidates)")

      func attemptManifest(at index: Int) {
        guard index < manifestCandidates.count else {
          print("[RuneRuntime] ❌ Manifest unavailable after trying all candidates")
          DispatchQueue.main.async {
            self.fallbackToFullReload()
          }
          return
        }

        let relativePath = manifestCandidates[index]
        let manifestURL = tokenizedDevServerURL(for: relativePath)
        print("[RuneRuntime] 📦 Fetching manifest: \(manifestURL.absoluteString)")

        var request = URLRequest(url: manifestURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
          guard let self else { return }

          if let error {
            print(
              "[RuneRuntime] ❌ Manifest fetch failed from \(relativePath): \(error.localizedDescription)"
            )
            attemptManifest(at: index + 1)
            return
          }

          guard let httpResponse = response as? HTTPURLResponse else {
            print("[RuneRuntime] ❌ Manifest response was not HTTP URL response")
            attemptManifest(at: index + 1)
            return
          }

          guard httpResponse.statusCode == 200 else {
            print(
              "[RuneRuntime] ❌ Manifest status \(httpResponse.statusCode) from \(relativePath)"
            )
            attemptManifest(at: index + 1)
            return
          }

          guard let data else {
            print("[RuneRuntime] ❌ Manifest returned empty body from \(relativePath)")
            attemptManifest(at: index + 1)
            return
          }

          guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
          else {
            print("[RuneRuntime] ❌ Manifest JSON parse failed from \(relativePath)")
            if let str = String(data: data, encoding: .utf8) {
              print("[RuneRuntime] Raw response: \(str.prefix(200))")
            }
            attemptManifest(at: index + 1)
            return
          }

          print("[RuneRuntime] ✅ Manifest loaded: \(object.keys)")

          var manifestHash: String?
          if let manifestValue = object["h"] as? String {
            manifestHash = manifestValue
            self.latestDevHash = manifestValue
          }

          if let runtimeName = object["name"] as? String,
            !runtimeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          {
            self.devRuntimeName = runtimeName
          }

          // Extract chunk IDs from the manifest
          let chunkIds: [String]
          if let cArray = object["c"] as? [String] {
            chunkIds = cArray
          } else if let cDict = object["c"] as? [String: Any] {
            chunkIds = Array(cDict.keys)
          } else if let singleId = object["id"] as? String {
            chunkIds = [singleId]
          } else {
            print("[RuneRuntime] ❌ No chunks found in manifest payload: \(object)")
            attemptManifest(at: index + 1)
            return
          }

          let baseHash = self.manifestHashFromPath(relativePath)
          self.fetchAndApplyHotUpdateChunks(
            chunkIds: chunkIds,
            manifestHash: manifestHash,
            manifestBaseHash: baseHash
          )
        }.resume()
      }

      attemptManifest(at: 0)
    }

    private func fallbackToFullReload() {
      isApplyingHotUpdate = false
      print("[RuneRuntime] 🔄 Falling back to full bundle reload")
      self.refreshDevBundle()
    }

    private func fetchAndApplyHotUpdateChunks(
      chunkIds: [String],
      manifestHash: String?,
      manifestBaseHash: String?
    ) {
      guard !chunkIds.isEmpty else {
        print("[RuneRuntime] ⚠️ No hot-update chunks to fetch, falling back to full reload")
        DispatchQueue.main.async {
          self.fallbackToFullReload()
        }
        return
      }

      guard devServerURL != nil else {
        print("[RuneRuntime] ❌ No dev server URL available")
        return
      }

      print("[RuneRuntime] 📥 Fetching \(chunkIds.count) hot-update chunk(s): \(chunkIds)")

      let group = DispatchGroup()
      let lock = NSLock()
      var chunkScripts: [String: String] = [:]
      var fetchErrors: [String: String] = [:]

      func attemptFetch(
        _ chunkId: String,
        _ candidates: [String],
        _ index: Int
      ) {
        guard index < candidates.count else {
          let attempted =
            candidates
            .map { tokenizedDevServerURL(for: $0).absoluteString }
            .joined(separator: ", ")
          let errorMsg = "Chunk \(chunkId) not found (attempted: \(attempted))"
          print("[RuneRuntime] ❌ \(errorMsg)")
          lock.lock()
          fetchErrors[chunkId] = errorMsg
          lock.unlock()
          group.leave()
          return
        }

        let relativePath = candidates[index]
        let chunkURL = tokenizedDevServerURL(for: relativePath)

        var request = URLRequest(url: chunkURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 10

        print(
          "[RuneRuntime]   Fetching (\(index + 1)/\(candidates.count)): \(chunkURL.absoluteString)")

        URLSession.shared.dataTask(with: request) { data, response, error in
          if let error {
            let errorMsg =
              "Failed to fetch chunk \(chunkId) from \(relativePath): \(error.localizedDescription)"
            print("[RuneRuntime] ❌ \(errorMsg)")
            if index + 1 < candidates.count {
              attemptFetch(chunkId, candidates, index + 1)
            } else {
              lock.lock()
              fetchErrors[chunkId] = errorMsg
              lock.unlock()
              group.leave()
            }
            return
          }

          guard let httpResponse = response as? HTTPURLResponse,
            httpResponse.statusCode == 200
          else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            let errorMsg =
              "Chunk \(chunkId) returned status \(statusCode) from \(relativePath)"
            print("[RuneRuntime] ❌ \(errorMsg)")
            if index + 1 < candidates.count {
              attemptFetch(chunkId, candidates, index + 1)
            } else {
              lock.lock()
              fetchErrors[chunkId] = errorMsg
              lock.unlock()
              group.leave()
            }
            return
          }

          guard let data, let code = String(data: data, encoding: .utf8) else {
            let errorMsg =
              "Chunk \(chunkId) returned invalid data from \(relativePath)"
            print("[RuneRuntime] ❌ \(errorMsg)")
            if index + 1 < candidates.count {
              attemptFetch(chunkId, candidates, index + 1)
            } else {
              lock.lock()
              fetchErrors[chunkId] = errorMsg
              lock.unlock()
              group.leave()
            }
            return
          }

          print(
            "[RuneRuntime] ✅ Chunk \(chunkId) fetched from \(relativePath) (\(code.count) bytes)")
          lock.lock()
          chunkScripts[chunkId] = code
          lock.unlock()
          group.leave()
        }.resume()
      }

      for chunkId in chunkIds {
        group.enter()
        let candidates = hotUpdateChunkPaths(
          for: chunkId,
          manifestBaseHash: manifestBaseHash,
          nextHash: manifestHash
        )
        attemptFetch(chunkId, candidates, 0)
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

        if successCount > 0 {
          if let manifestHash, !manifestHash.isEmpty {
            self.lastAppliedDevHash = manifestHash
          } else {
            self.lastAppliedDevHash = self.latestDevHash
          }
        }
        self.isApplyingHotUpdate = false
        print("[RuneRuntime] 🎉 Hot update applied successfully!")
        self.statusBar.showBundleLoaded()
      }
    }

    private func ensureMain(_ work: @escaping () -> Void) {
      if Thread.isMainThread {
        work()
      } else {
        DispatchQueue.main.async(execute: work)
      }
    }

    private func sanitizedToken(_ token: String?) -> String? {
      guard
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines),
        !trimmed.isEmpty
      else {
        return nil
      }
      return trimmed
    }

    private func hotUpdateChunkPaths(
      for chunkId: String,
      manifestBaseHash: String?,
      nextHash: String?
    ) -> [String] {
      var seen = Set<String>()
      var candidates: [String] = []

      let hashSources = [manifestBaseHash, lastAppliedDevHash, nextHash, latestDevHash].compactMap {
        (hash: String?) -> String? in
        guard let value = hash, !value.isEmpty else { return nil }
        return value
      }

      for hash in hashSources {
        let path = "bundle/\(chunkId).\(hash).hot-update.js"
        if seen.insert(path).inserted {
          candidates.append(path)
        }
      }

      let defaultPath = "bundle/\(chunkId).hot-update.js"
      if seen.insert(defaultPath).inserted {
        candidates.append(defaultPath)
      }

      return candidates
    }

    private func manifestHashFromPath(_ relativePath: String) -> String? {
      guard let range = relativePath.range(of: ".hot-update.json") else {
        return nil
      }
      let prefix = relativePath[..<range.lowerBound]
      guard let dotIndex = prefix.lastIndex(of: ".") else {
        return nil
      }
      let hashStart = prefix.index(after: dotIndex)
      let hash = prefix[hashStart...]
      return hash.isEmpty ? nil : String(hash)
    }

    private func hotUpdateManifestPaths() -> [String] {
      var seen = Set<String>()
      var candidates: [String] = []

      let preferredHashes = [lastAppliedDevHash, latestDevHash].compactMap { hash -> String? in
        guard let value = hash, !value.isEmpty else { return nil }
        return value
      }

      if !devRuntimeName.isEmpty {
        for hash in preferredHashes {
          let hashed = "bundle/\(devRuntimeName).\(hash).hot-update.json"
          if seen.insert(hashed).inserted {
            candidates.append(hashed)
          }
        }

        let stable = "bundle/\(devRuntimeName).hot-update.json"
        if seen.insert(stable).inserted {
          candidates.append(stable)
        }
      }

      return candidates
    }

    private func tokenizedDevServerURL(for relativePath: String) -> URL {
      guard let base = devServerURL else {
        return URL(fileURLWithPath: relativePath)
      }
      let combined = base.appendingPathComponent(relativePath)
      return appendTokenIfNeeded(to: combined)
    }

    private func appendTokenIfNeeded(to url: URL) -> URL {
      guard let token = sanitizedToken(devServerToken) else {
        return url
      }
      guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return url
      }

      var items = components.queryItems ?? []
      let tokenItem = URLQueryItem(name: "token", value: token)
      if !items.contains(where: { $0.name == tokenItem.name }) {
        items.append(tokenItem)
      }

      components.queryItems = items
      return components.url ?? url
    }

    private func normalizeDevServerURL(_ url: URL) -> URL {
      guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return url
      }

      if let host = components.host?.lowercased(), host == "localhost" {
        components.host = "127.0.0.1"
      }

      return components.url ?? url
    }
  }

#endif
