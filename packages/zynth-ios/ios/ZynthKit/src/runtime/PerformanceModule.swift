import Foundation

class PerformanceModule: ZynthModule, ZynthSyncModule {
    let name: String = "Performance"

    func call(method: String, args: Any?) throws -> Any? {
        return nil
    }

    func callSync(method: String, args: Any?) throws -> Any? {
        switch method {
        case "getLastFrameStats":
            return PerformanceProfiler.shared.getFrameStats()
        default:
            return nil
        }
    }
}
