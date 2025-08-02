import Foundation
import RuneKit
import UIKit

class RuneHypervisorView: UIView {
    private var runtime: RuneRuntime?
    private var guestRootView: UIView?
    
    // Callbacks to JS
    @objc var onLoad: (() -> Void)?
    @objc var onError: ((NSDictionary) -> Void)?
    @objc var onMessage: ((NSDictionary) -> Void)? // For Phase 4
    
    @objc var source: NSDictionary? {
        didSet {
            // Only reload if source actually changed or if runtime is nil
            if oldValue == nil || (source != nil && !(oldValue as NSDictionary).isEqual(to: source as! [AnyHashable : Any])) {
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
        let guestRoot = UIView()
        guestRoot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        guestRoot.frame = self.bounds
        self.addSubview(guestRoot)
        self.guestRootView = guestRoot
    }
    
    func reload() {
        loadGuest()
    }
    
    func destroy() {
        print("[RuneHypervisor] Destroying RuneRuntime for Hypervisor View")
        runtime?.destroy()
        runtime = nil
    }
    
    private func loadGuest() {
        guard let source = source else {
            // If source is nil, ensure runtime is destroyed
            destroy()
            return
        }
        guard let guestRoot = guestRootView else {
            onError?(["message": "Guest root view not available"])
            return
        }
        
        // Destroy existing runtime before creating a new one
        destroy()
        
        let newRuntime = RuneRuntime(rootView: guestRoot)
        self.runtime = newRuntime
        
        var loadError: Error?
        if let uriString = source["uri"] as? String, let url = URL(string: uriString) {
            do {
                try newRuntime.loadInitialBundle(jsBundleURL: url)
                newRuntime.start(rootId: newRuntime.rootSurfaceId)
                onLoad?()
            } catch {
                print("[RuneHypervisor] Failed to load bundle from URI: \(error)")
                loadError = error
            }
        } else if let code = source["code"] as? String {
            do {
                newRuntime.evaluate(code: code)
                newRuntime.start(rootId: newRuntime.rootSurfaceId)
                onLoad?()
            } catch {
                print("[RuneHypervisor] Failed to evaluate inline code: \(error)")
                loadError = error
            }
        } else {
            loadError = NSError(domain: "RuneHypervisor", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid source provided"])
        }
        
        if let error = loadError {
            onError?(["message": error.localizedDescription])
        }
    }
    
    override func layoutSubviews() {
        super.layoutSubviews()
        // Here we could propagate layout changes to the runtime's Yoga node if needed,
        // but for now, the autoresizingMask for guestRoot handles basic sizing.
        // A more advanced solution would involve updating the runtime's root node size
        // and triggering a Yoga layout recalculation.
    }
    
    deinit {
        print("[RuneHypervisor] Deallocating Hypervisor View")
        destroy() // Ensure runtime is destroyed when view is deallocated
    }
}
