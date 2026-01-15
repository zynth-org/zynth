import Foundation
import ZynthKit

@objc(ZynthHypervisorModule)
class ZynthHypervisorModule: NSObject, ZynthModule, ZynthSyncModule {
    var name: String = "ZynthHypervisor"
    
    private weak var runtime: ZynthRuntime?
    
    init(runtime: ZynthRuntime) {
        self.runtime = runtime
    }
    
    func call(method: String, args: Any?) throws -> Any? {
        switch method {
        case "postMessage":
            // Guest sending message to Host
            // args[0] is the message
            if let argsArray = args as? [Any], let message = argsArray.first {
                // How do we get the host?
                // The guest runtime is owned by the ZynthHypervisorView.
                // We need a way to bubble this event up to the view.
                
                // Option: Emit a specific event on the runtime that the view listens to?
                // No, the view owns the runtime.
                
                // Let's use NotificationCenter for decoupling, or a delegate pattern if we could access it.
                // Since ZynthModule is initialized by ZynthRuntime, we might need to pass a delegate.
                // But modules are registered via the registry.
                
                // ALTERNATIVE: The Hypervisor View can inject a callback into the runtime/module?
                // Or we can use the `ZynthNativeEmitter` mechanism in reverse?
                // No, `ZynthNativeEmitter` is Native -> JS.
                
                // Let's post a notification that the HypervisorView listens to.
                // We need a unique ID to identify *which* guest sent it.
                // The runtime doesn't have a unique ID by default exposed easily here, 
                // but we can use ObjectIdentifier(runtime).
                
                if let runtime = runtime {
                    NotificationCenter.default.post(
                        name: .didReceiveGuestMessage,
                        object: runtime,
                        userInfo: ["message": message]
                    )
                }
            }
            return nil
        default:
             return ["error": "unknown_method", "method": method]
        }
    }
    
    func callSync(method: String, args: Any?) throws -> Any? {
        return nil
    }
}

extension Notification.Name {
    static let didReceiveGuestMessage = Notification.Name("ZynthHypervisorDidReceiveGuestMessage")
}
