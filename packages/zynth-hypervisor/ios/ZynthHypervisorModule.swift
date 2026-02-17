import Foundation
import ZynthKit

@objc(ZynthHypervisorModule)
class ZynthHypervisorModule: NSObject, ZynthModule, ZynthSyncModule {
    var name: String = "ZynthHypervisor"
    
    var exportedMethods: [String] {
        return ["postMessage"]
    }

    var protectedMethods: [String] {
        return ["postMessage"]
    }
    
    private weak var runtime: ZynthRuntime?
    
    init(runtime: ZynthRuntime) {
        self.runtime = runtime
    }
    
    func call(method: String, args: ZynthArgs) throws -> Any? {
        switch method {
        case "postMessage":
            // Guest sending message to Host
            // Try extracting from "message" key if it's a dict, or first index if it's an array
            let message = (try? args.string("message")) ?? (try? args.getString(0))
            if let message = message {
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
            throw ZynthModuleError.methodNotExported(module: name, method: method)
        }
    }
    
    func callSync(method: String, args: ZynthArgs) throws -> Any? {
        return nil
    }
}

extension Notification.Name {
    static let didReceiveGuestMessage = Notification.Name("ZynthHypervisorDidReceiveGuestMessage")
}
