import Foundation
import RuneKit
import UIKit

@objc(RuneHypervisorView)
@objcMembers
public class RuneHypervisorView: UIView {
    private var runtime: RuneRuntime?
    private var guestRootView: UIView?
    private weak var manager: SNUIManager?
    private weak var node: SNNode?
    
    // Callbacks to JS
    @objc var onLoad: (() -> Void)?
    @objc var onError: ((NSDictionary) -> Void)?
    @objc var onMessage: ((NSDictionary) -> Void)? // For Phase 4
    
    @objc var source: NSDictionary? {
        didSet {
            // Only reload if source actually changed or if runtime is nil
            let oldDict = oldValue as? [AnyHashable: Any]
            let newDict = source as? [AnyHashable: Any]
            let changed = !(NSDictionary(dictionary: oldDict ?? [:]).isEqual(to: newDict ?? [:]))
            if runtime == nil || changed {
                loadGuest()
            }
        }
    }
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        setup()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }
    
    private func setup() {
        ensureGuestRoot()
    }
    
    func reload() {
        loadGuest()
    }
    
    func destroy() {
        print("[RuneHypervisor] Destroying RuneRuntime for Hypervisor View")
        destroyRuntime()
        guestRootView?.removeFromSuperview()
        guestRootView = nil
    }
    
    /// Destroys only the runtime, keeping the guest root view intact for reuse
    private func destroyRuntime() {
        if let runtime = runtime {
            NotificationCenter.default.removeObserver(self, name: .didReceiveGuestMessage, object: runtime)
        }
        runtime = nil
        // Clear subviews from guest root but keep the view itself
        guestRootView?.subviews.forEach { $0.removeFromSuperview() }
    }

    func bind(manager: SNUIManager, node: SNNode) {
        self.manager = manager
        self.node = node
    }
    
    private func loadGuest() {
        guard let source = source else {
            // If source is nil, ensure runtime is destroyed
            destroy()
            return
        }
        
        // Destroy existing runtime but keep the guest root view
        destroyRuntime()
        
        // Ensure guest root view exists
        ensureGuestRoot()
        guard let guestRoot = guestRootView else {
            notifyError("Guest root view not available")
            return
        }
        
        // Use isGuest: true to allocate a unique surface ID for this guest runtime
        let newRuntime = RuneRuntime(rootView: guestRoot, runtime: nil, enableDevServer: false, isGuest: true)
        
        // Register Hypervisor Module for Guest -> Host communication
        let hypervisorModule = RuneHypervisorModule(runtime: newRuntime)
        newRuntime.installModules([hypervisorModule])

        // Dynamically initialize standard modules if available (e.g. RuneSafeArea)
        if let safeAreaClass = NSClassFromString("RuneSafeAreaModule") as? NSObject.Type {
            let selector = Selector("initializeWith:")
            if safeAreaClass.responds(to: selector) {
                safeAreaClass.perform(selector, with: newRuntime)
            }
        }
        
        // Inject JS bridge for guest to communicate with native module
        newRuntime.evaluate(code: """
          globalThis.__RUNE_HYPERVISOR_BRIDGE__ = {
            postMessage: (message) => {
              // The native module expects an array of args
              globalThis.__modules.call('RuneHypervisor', 'postMessage', [JSON.parse(message)]);
            }
          };
        """)
        
        // Listen for messages from this specific runtime
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleGuestMessage(_:)),
            name: .didReceiveGuestMessage,
            object: newRuntime
        )
        
        self.runtime = newRuntime
        print("[RuneHypervisor] Guest runtime created with surfaceId: \(newRuntime.rootSurfaceId)")
        print("[RuneHypervisor] HypervisorView bounds: \(self.bounds), guestRoot bounds: \(guestRootView?.bounds ?? .zero)")
        
        if let uriString = source["uri"] as? String, let url = URL(string: uriString) {
            loadBundle(from: url, runtime: newRuntime)
        } else if let code = source["code"] as? String {
            DispatchQueue.main.async {
                newRuntime.evaluate(code: code)
                newRuntime.start(rootId: newRuntime.rootSurfaceId)
                self.notifyLoad()
            }
        } else {
            notifyError("Invalid source provided (neither uri nor code)")
        }
    }
    
    @objc private func handleGuestMessage(_ notification: Notification) {
        guard let message = notification.userInfo?["message"] else { return }
        // Wrap in a dictionary to pass to the callback if it expects one, or pass direct if simple type?
        // The `onMessage` signature in Registrar expects a dictionary.
        // If message is already a dictionary, pass it. Else wrap it.
            if let dict = message as? NSDictionary {
                onMessage?(dict)
                if let manager = manager, let node = node {
                    manager.rune_dispatchEvent("onMessage", payload: dict as? [AnyHashable: Any], to: node)
                }
            } else {
                let payload: NSDictionary = ["data": message]
                onMessage?(payload)
                if let manager = manager, let node = node {
                    manager.rune_dispatchEvent("onMessage", payload: payload as? [AnyHashable: Any], to: node)
                }
            }
        }
    
    func postMessage(_ message: Any) {
        // Host -> Guest communication
        // We emit an event on the guest's NativeEmitter
        runtime?.emitEvent(name: "RuneHypervisor:Message", payload: message)
    }
    
    public override func layoutSubviews() {
        super.layoutSubviews()
        // Update guestRootView frame when our bounds change
        guestRootView?.frame = self.bounds
        print("[RuneHypervisor] layoutSubviews - bounds: \(self.bounds), guestRoot frame: \(guestRootView?.frame ?? .zero)")
        // Trigger a flush on the runtime to recalculate layout with new bounds
        if self.bounds.width > 0 && self.bounds.height > 0 {
            runtime?.flush()
        }
    }
    
    deinit {
        print("[RuneHypervisor] Deallocating Hypervisor View")
        destroy() // Ensure runtime is destroyed when view is deallocated
    }

    private func ensureGuestRoot() {
        if guestRootView == nil {
            let guestRoot = UIView()
            guestRoot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            guestRoot.frame = self.bounds
            // Make sure the guest root can display content
            guestRoot.clipsToBounds = true
            self.addSubview(guestRoot)
            self.guestRootView = guestRoot
        }
    }

    private func loadBundle(from url: URL, runtime: RuneRuntime) {
        // Network load for http(s); file load for file URLs
        if url.isFileURL {
            do {
                let code = try String(contentsOf: url, encoding: .utf8)
                runtime.evaluate(code: code)
                runtime.start(rootId: runtime.rootSurfaceId)
                notifyLoad()
            } catch {
                print("[RuneHypervisor] Failed to load bundle from file URL: \(error)")
                notifyError("Failed to load bundle from file: \(error.localizedDescription)")
            }
            return
        }

        // Remote fetch
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: .default)
        let currentRuntime = runtime
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            guard self.runtime === currentRuntime else { return } // runtime changed
            if let error = error {
                self.notifyError("Failed to load bundle from URL: \(error.localizedDescription)")
                return
            }
            guard let data = data, let code = String(data: data, encoding: .utf8) else {
                self.notifyError("Empty bundle response")
                return
            }
            DispatchQueue.main.async {
                guard self.runtime === currentRuntime else { return }
                runtime.evaluate(code: code)
                runtime.start(rootId: runtime.rootSurfaceId)
                self.notifyLoad()
            }
        }.resume()
    }

    private func notifyError(_ message: String) {
        let payload: NSDictionary = ["message": message]
        onError?(payload)
        if let manager = manager, let node = node {
            manager.rune_dispatchEvent("onError", payload: payload as? [AnyHashable: Any], to: node)
        }
    }

    private func notifyLoad() {
        onLoad?()
        if let manager = manager, let node = node {
            manager.rune_dispatchEvent("onLoad", payload: [:], to: node)
        }
    }
}
