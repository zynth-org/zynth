import Foundation

private enum DevSupportKeys {
  static var devClient = "zynthai.comClient"
  static var devServerURL = "zynthai.comServerURL"
  static var devServerToken = "zynthai.comServerToken"
  static var latestDevHash = "zynth.latestDevHash"
  static var lastAppliedDevHash = "zynth.lastAppliedDevHash"
  static var isApplyingHotUpdate = "zynth.isApplyingHotUpdate"
  static var devRuntimeName = "zynthai.comRuntimeName"
}

@objc(ZynthDevSupport) public final class ZynthDevSupport: NSObject {
  @objc public static func configure(runtime: ZynthRuntime) {
    runtime.configureDevServer()
  }
}

extension ZynthRuntime {
  private var devClient: ZynthHMRClient? {
    get { objc_getAssociatedObject(self, &DevSupportKeys.devClient) as? ZynthHMRClient }
    set { objc_setAssociatedObject(self, &DevSupportKeys.devClient, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
  }

  private var devServerURL: URL? {
    get { objc_getAssociatedObject(self, &DevSupportKeys.devServerURL) as? URL }
    set { objc_setAssociatedObject(self, &DevSupportKeys.devServerURL, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
  }

  private var devServerToken: String? {
    get { objc_getAssociatedObject(self, &DevSupportKeys.devServerToken) as? String }
    set { objc_setAssociatedObject(self, &DevSupportKeys.devServerToken, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC) }
  }

  private var latestDevHash: String? {
    get { objc_getAssociatedObject(self, &DevSupportKeys.latestDevHash) as? String }
    set { objc_setAssociatedObject(self, &DevSupportKeys.latestDevHash, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC) }
  }

  private var lastAppliedDevHash: String? {
    get { objc_getAssociatedObject(self, &DevSupportKeys.lastAppliedDevHash) as? String }
    set { objc_setAssociatedObject(self, &DevSupportKeys.lastAppliedDevHash, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC) }
  }

  private var isApplyingHotUpdate: Bool {
    get {
      (objc_getAssociatedObject(self, &DevSupportKeys.isApplyingHotUpdate) as? NSNumber)?.boolValue ?? false
    }
    set {
      objc_setAssociatedObject(
        self,
        &DevSupportKeys.isApplyingHotUpdate,
        NSNumber(value: newValue),
        .OBJC_ASSOCIATION_RETAIN_NONATOMIC
      )
    }
  }

  private var devRuntimeName: String {
    get {
      (objc_getAssociatedObject(self, &DevSupportKeys.devRuntimeName) as? String)
        .flatMap { $0.isEmpty ? nil : $0 } ?? "app"
    }
    set {
      objc_setAssociatedObject(self, &DevSupportKeys.devRuntimeName, newValue, .OBJC_ASSOCIATION_COPY_NONATOMIC)
    }
  }

  @objc fileprivate func configureDevServer() {
    print("[ZynthRuntime] 🔧 configureDevServer")
    installHmrShim()

    let env = ProcessInfo.processInfo.environment
    if let runtimeOverride = env["ZYNTH_DEV_RUNTIME"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !runtimeOverride.isEmpty {
      devRuntimeName = runtimeOverride
    }

    let envUrlString = env["ZYNTH_DEV_SERVER_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    let plistUrlString = (Bundle.main.object(forInfoDictionaryKey: "ZynthDevServerURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let urlString = envUrlString?.isEmpty == false ? envUrlString : plistUrlString

    guard let urlString,
          !urlString.isEmpty,
          let rawURL = URL(string: urlString) else {
      print("[ZynthRuntime] ℹ️ ZYNTH_DEV_SERVER_URL not set; HMR disabled")
      return
    }

    let envToken = sanitizeToken(env["ZYNTH_DEV_SERVER_TOKEN"])
    let plistToken = sanitizeToken(Bundle.main.object(forInfoDictionaryKey: "ZynthDevServerToken") as? String)
    let token = envToken ?? plistToken
    print("[ZynthRuntime] 🌐 HMR dev server =", rawURL.absoluteString, "token?", token != nil)
    connectToDevServer(rawURL, token: token)
  }

  func connectToDevServer(_ url: URL, token: String? = nil) {
    devServerURL = url
    devServerToken = sanitizeToken(token)
    installDevServerGlobal(url: url, token: devServerToken)
    if devClient == nil {
      devClient = ZynthHMRClient(url: url, runtime: self, token: devServerToken)
    } else {
      devClient?.updateConfiguration(url: url, token: devServerToken)
    }
    devClient?.connect()
  }

  @objc func handleDevMessage(_ text: String) {
    guard
      let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data, options: []),
      let payload = object as? [String: Any],
      let type = payload["type"] as? String
    else {
      callGlobal("__zynth_receiveHMRMessage", args: [text])
      return
    }

    print("[ZynthRuntime] 📨 HMR message type:", type)
    if type == "update" || type == "ok" || type == "still-ok" || type == "built" || type == "sync" {
      dismissNativeErrorOverlayForHmr()
    }
    switch type {
    case "update":
      flashNativeHmrIndicator()
    case "errors":
      showNativeBuildErrorOverlay(payload)
    case "hash":
      if let hash = payload["data"] as? String {
        latestDevHash = hash
      }
    case "ok", "still-ok", "built", "sync":
      handleCompilationSuccess(trigger: type)
    default:
      break
    }

    callGlobal("__zynth_receiveHMRMessage", args: [text])
  }

  private func showNativeBuildErrorOverlay(_ payload: [String: Any]) {
    guard let managerClass = NSClassFromString("ZynthNativeErrorOverlayManager") as? NSObject.Type else {
      return
    }
    let sharedSelector = NSSelectorFromString("shared")
    let rawSelector = NSSelectorFromString("handleRawEventJSON:")
    guard managerClass.responds(to: sharedSelector),
          let unmanaged = managerClass.perform(sharedSelector) else {
      return
    }
    let manager = unmanaged.takeUnretainedValue() as AnyObject
    guard manager.responds(to: rawSelector) else { return }

    let data = payload["data"] as? [String: Any]
    let text = data?["text"] as? [String]
    let message = text?.first ?? "Build failed"
    let event: [String: Any] = [
      "topic": "error/build",
      "level": "error",
      "tag": "hmr",
      "data": [
        "message": message,
        "stack": text?.dropFirst().joined(separator: "\n") ?? "",
      ],
    ]
    guard JSONSerialization.isValidJSONObject(event),
          let jsonData = try? JSONSerialization.data(withJSONObject: event, options: []),
          let json = String(data: jsonData, encoding: .utf8) else {
      return
    }
    _ = manager.perform(rawSelector, with: json)
  }

  private func handleCompilationSuccess(trigger: String) {
    if isApplyingHotUpdate { return }
    guard devServerURL != nil else { return }
    guard let latestHash = latestDevHash else {
      return
    }
    if lastAppliedDevHash == nil {
      lastAppliedDevHash = latestHash
      return
    }
    lastAppliedDevHash = latestHash
  }

  private func installHmrShim() {
    let code =
      """
      if (typeof globalThis.__modules === 'object' && typeof globalThis.__modules.callSync !== 'function' && typeof globalThis.__zynthCallSync === 'function') {
        globalThis.__modules.callSync = globalThis.__zynthCallSync;
      }
      if (typeof globalThis.__zynth_receiveHMRMessage !== 'function') {
        globalThis.__zynth_receiveHMRMessage = function(payload) {
          try {
            if (typeof payload === 'string') {
              payload = JSON.parse(payload);
            }
          } catch (error) {
            console.error('[Zynth HMR] parse failed', error);
            return;
          }
          if (payload && typeof globalThis.__zynth_refresh === 'function') {
            globalThis.__zynth_refresh(payload);
          } else if (payload && typeof globalThis.__zynth_requestFullReload === 'function') {
            globalThis.__zynth_requestFullReload(payload);
          } else {
            console.warn('[Zynth HMR] No refresh handler available', payload && payload.type);
          }
        };
      }
      if (typeof globalThis.__zynth_refresh !== 'function') {
        globalThis.__zynth_refresh = function(payload) {
          // No-op default; JS HMR bootstrap will replace this.
        };
        Object.defineProperty(globalThis.__zynth_refresh, '__isZynthDefaultStub', {
          value: true,
          configurable: true,
          enumerable: false,
          writable: false,
        });
      }
      """
    _ = try? evaluateScript(code, sourceURL: "zynth-hmr-shim.js")
  }

  private func installDevServerGlobal(url: URL, token: String?) {
    let escaped = url.absoluteString
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
    _ = try? evaluateScript("globalThis.__ZYNTH_DEV_SERVER_URL = \"\(escaped)\";", sourceURL: nil)
    if let token {
      let escapedToken = token
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      _ = try? evaluateScript("globalThis.__ZYNTH_DEV_SERVER_TOKEN = \"\(escapedToken)\";", sourceURL: nil)
    } else {
      _ = try? evaluateScript("delete globalThis.__ZYNTH_DEV_SERVER_TOKEN;", sourceURL: nil)
    }
  }

  private func sanitizeToken(_ token: String?) -> String? {
    guard let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else { return nil }
    return trimmed
  }

  private func dismissNativeErrorOverlayForHmr() {
    guard let managerClass = NSClassFromString("ZynthNativeErrorOverlayManager") as? NSObject.Type else {
      return
    }
    let sharedSelector = NSSelectorFromString("shared")
    let dismissSelector = NSSelectorFromString("dismissForHmrUpdate")
    guard managerClass.responds(to: sharedSelector),
          let unmanaged = managerClass.perform(sharedSelector) else {
      return
    }
    let manager = unmanaged.takeUnretainedValue() as AnyObject
    if manager.responds(to: dismissSelector) {
      _ = manager.perform(dismissSelector)
    }
  }

  private func flashNativeHmrIndicator() {
    guard let managerClass = NSClassFromString("ZynthNativeErrorOverlayManager") as? NSObject.Type else {
      return
    }
    let sharedSelector = NSSelectorFromString("shared")
    let flashSelector = NSSelectorFromString("flashHmrIndicator")
    guard managerClass.responds(to: sharedSelector),
          let unmanaged = managerClass.perform(sharedSelector) else {
      return
    }
    let manager = unmanaged.takeUnretainedValue() as AnyObject
    if manager.responds(to: flashSelector) {
      _ = manager.perform(flashSelector)
    }
  }

  func refreshDevBundle() {
    guard let url = devServerURL else { return }
    do {
      let bundle = try ZynthDevBundleFetcher.fetch(baseURL: url, token: devServerToken)
      _ = try? evaluateScript(bundle.code, sourceURL: bundle.url.absoluteString)
      callGlobal("__startApp", args: [NSNumber(value: rootSurfaceId)])
    } catch {
      print("[ZynthRuntime] Dev bundle reload failed: \(error)")
    }
  }

  func applyHotUpdate() {
    if isApplyingHotUpdate { return }
    guard devServerURL != nil else { return }
    isApplyingHotUpdate = true
    flashNativeHmrIndicator()

    let manifestCandidates = hotUpdateManifestPaths()
    print("[ZynthRuntime] 🔥 applyHotUpdate, manifest candidates:", manifestCandidates)
    func attemptManifest(at index: Int) {
      guard index < manifestCandidates.count else {
        print("[ZynthRuntime] ❌ hot-update manifest not found (exhausted candidates)")
        self.isApplyingHotUpdate = false
        return
      }
      let relativePath = manifestCandidates[index]
      let manifestURL = tokenizedDevServerURL(for: relativePath)
      print("[ZynthRuntime] 📦 fetching manifest:", manifestURL.absoluteString)
      var request = URLRequest(url: manifestURL)
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      request.timeoutInterval = 10
      URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
        guard let self else { return }
        if let error {
          print("[ZynthRuntime] ❌ manifest fetch error:", error.localizedDescription)
          attemptManifest(at: index + 1)
          return
        }
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
          let status = (response as? HTTPURLResponse)?.statusCode ?? -1
          print("[ZynthRuntime] ❌ manifest bad status:", status, "path:", relativePath)
          attemptManifest(at: index + 1); return
        }
        guard let data else {
          print("[ZynthRuntime] ❌ manifest empty response:", relativePath)
          attemptManifest(at: index + 1); return
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          if let raw = String(data: data, encoding: .utf8) {
            print("[ZynthRuntime] ❌ manifest parse failed:", raw.prefix(200))
          } else {
            print("[ZynthRuntime] ❌ manifest parse failed (non-utf8)")
          }
          attemptManifest(at: index + 1); return
        }
        print("[ZynthRuntime] ✅ manifest loaded keys:", object.keys)

        var manifestHash: String?
        if let manifestValue = object["h"] as? String {
          manifestHash = manifestValue
          self.latestDevHash = manifestValue
        }
        if let runtimeName = object["name"] as? String,
           !runtimeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          self.devRuntimeName = runtimeName
        }

        let chunkIds: [String]
        if let cArray = object["c"] as? [String] {
          chunkIds = cArray
        } else if let cDict = object["c"] as? [String: Any] {
          chunkIds = Array(cDict.keys)
        } else if let singleId = object["id"] as? String {
          chunkIds = [singleId]
        } else {
          print("[ZynthRuntime] ❌ manifest has no chunks:", object)
          attemptManifest(at: index + 1)
          return
        }

        print("[ZynthRuntime] 📦 hot-update chunks:", chunkIds)
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

  private func fetchAndApplyHotUpdateChunks(
    chunkIds: [String],
    manifestHash: String?,
    manifestBaseHash: String?
  ) {
    guard !chunkIds.isEmpty else {
      isApplyingHotUpdate = false
      return
    }

    let group = DispatchGroup()
    let lock = NSLock()
    var chunkScripts: [String: String] = [:]

    func attemptFetch(_ chunkId: String, _ candidates: [String], _ index: Int) {
      guard index < candidates.count else {
        print("[ZynthRuntime] ❌ chunk not found:", chunkId)
        group.leave()
        return
      }
      let relativePath = candidates[index]
      let chunkURL = tokenizedDevServerURL(for: relativePath)
      print("[ZynthRuntime] 📥 fetching chunk:", chunkURL.absoluteString)
      var request = URLRequest(url: chunkURL)
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      request.timeoutInterval = 10

      URLSession.shared.dataTask(with: request) { data, response, error in
        if let error {
          print("[ZynthRuntime] ❌ chunk fetch error:", chunkId, error.localizedDescription)
          attemptFetch(chunkId, candidates, index + 1)
          return
        }
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
          let status = (response as? HTTPURLResponse)?.statusCode ?? -1
          print("[ZynthRuntime] ❌ chunk bad status:", chunkId, status, "path:", relativePath)
          attemptFetch(chunkId, candidates, index + 1)
          return
        }
        guard let data, let code = String(data: data, encoding: .utf8) else {
          print("[ZynthRuntime] ❌ chunk invalid data:", chunkId, "path:", relativePath)
          attemptFetch(chunkId, candidates, index + 1)
          return
        }
        print("[ZynthRuntime] ✅ chunk fetched:", chunkId, "bytes:", code.count)
        lock.lock()
        chunkScripts[chunkId] = code
        lock.unlock()
        group.leave()
      }.resume()
    }

    for chunkId in chunkIds {
      group.enter()
      let candidates = hotUpdateChunkPaths(for: chunkId, manifestBaseHash: manifestBaseHash, nextHash: manifestHash)
      attemptFetch(chunkId, candidates, 0)
    }

    group.notify(queue: .main) { [weak self] in
      guard let self else { return }
      for chunkId in chunkIds {
        guard let code = chunkScripts[chunkId] else { continue }
        _ = try? self.evaluateScript(code, sourceURL: "hot-update-\(chunkId).js")
        print("[ZynthRuntime] ⚡️ executed chunk:", chunkId)
      }
      if let manifestHash, !manifestHash.isEmpty {
        self.lastAppliedDevHash = manifestHash
      } else {
        self.lastAppliedDevHash = self.latestDevHash
      }
      self.isApplyingHotUpdate = false
    }
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
      if seen.insert(path).inserted { candidates.append(path) }
    }
    let defaultPath = "bundle/\(chunkId).hot-update.js"
    if seen.insert(defaultPath).inserted { candidates.append(defaultPath) }
    return candidates
  }

  private func manifestHashFromPath(_ relativePath: String) -> String? {
    guard let range = relativePath.range(of: ".hot-update.json") else { return nil }
    let prefix = relativePath[..<range.lowerBound]
    guard let dotIndex = prefix.lastIndex(of: ".") else { return nil }
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
        if seen.insert(hashed).inserted { candidates.append(hashed) }
      }
      let stable = "bundle/\(devRuntimeName).hot-update.json"
      if seen.insert(stable).inserted { candidates.append(stable) }
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
    guard let token = sanitizeToken(devServerToken) else { return url }
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
}
