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
    private var isDestroyed: Bool = false
    
    // Callbacks to JS
    @objc var onLoad: (() -> Void)?
    @objc var onError: ((NSDictionary) -> Void)?
    @objc var onMessage: ((NSDictionary) -> Void)?
    
    @objc var source: NSDictionary? {
        didSet {
            if isDestroyed { return }
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
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }
    
    func reload() {
        isDestroyed = false
        loadGuest()
    }
    
    func destroy() {
        print("[RuneHypervisor] Destroying RuneRuntime for Hypervisor View")
        isDestroyed = true
        destroyRuntime()
    }
    
    private func destroyRuntime() {
        if let runtime = runtime {
            NotificationCenter.default.removeObserver(self, name: .didReceiveGuestMessage, object: runtime)
        }
        runtime = nil
        guestRootView?.removeFromSuperview()
        guestRootView = nil
    }

    func bind(manager: SNUIManager, node: SNNode) {
        self.manager = manager
        self.node = node
    }
    
    private func loadGuest() {
        isDestroyed = false
        guard let source = source else {
            destroy()
            return
        }
        
        destroyRuntime()
        
        // Create Guest Root View
        let root = UIView(frame: self.bounds)
        root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.backgroundColor = .clear
        self.addSubview(root)
        self.guestRootView = root
        
        // Use isGuest: true to allocate a unique surface ID for this guest runtime
        // The runtime constructor expects a view to attach the "Root Surface" (id=1) to.
        let newRuntime = RuneRuntime(
          rootView: root,
          runtime: nil,
          enableDevServer: false,
          isGuest: true
        )
        
        // Register Hypervisor Module for Guest -> Host communication
        let hypervisorModule = RuneHypervisorModule(runtime: newRuntime)
        newRuntime.installModules([hypervisorModule])

        // Dynamic module auto-discovery via RuneNativeModules.json
        if let configURL = Bundle.main.url(forResource: "RuneNativeModules", withExtension: "json"),
           let data = try? Data(contentsOf: configURL),
           let modules = try? JSONSerialization.jsonObject(with: data, options: []) as? [[String: String]] {
            
            for moduleConfig in modules {
                guard let className = moduleConfig["className"],
                      let methodName = moduleConfig["method"],
                      let moduleClass = NSClassFromString(className) as? NSObject.Type else {
                    continue
                }
                
                let selector = Selector(methodName)
                if moduleClass.responds(to: selector) {
                    print("[RuneHypervisor] Auto-installing module: \(className)")
                    moduleClass.perform(selector, with: newRuntime)
                }
            }
        }

        // Inject JS bridge for guest to communicate with native module
        newRuntime.evaluate(code: """
          globalThis.__RUNE_HYPERVISOR_BRIDGE__ = {
            postMessage: (message) => {
              globalThis.__modules.call('RuneHypervisor', 'postMessage', [JSON.parse(message)]);
            }
          };
        """)
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleGuestMessage(_:)),
            name: .didReceiveGuestMessage,
            object: newRuntime
        )
        
        self.runtime = newRuntime
        print("[RuneHypervisor] Guest runtime created with surfaceId: \(newRuntime.rootSurfaceId)")
        
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
        runtime?.emitEvent(name: "RuneHypervisor:Message", payload: message)
    }
    
    public override func layoutSubviews() {
        super.layoutSubviews()
        guestRootView?.frame = self.bounds
        if self.bounds.width > 0 && self.bounds.height > 0 {
            runtime?.flush()
        }
    }
    
    deinit {
        print("[RuneHypervisor] Deallocating Hypervisor View")
        destroy()
    }

    private func loadBundle(from url: URL, runtime: RuneRuntime) {
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

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: .default)
        let currentRuntime = runtime
        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            guard self.runtime === currentRuntime else { return }
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
