import Foundation

@objc
public final class PerformanceProfiler: NSObject {
    @objc public static let shared = PerformanceProfiler()

    @objc public var layoutStart: CFAbsoluteTime = 0
    @objc public var layoutEnd: CFAbsoluteTime = 0
    @objc public var renderStart: CFAbsoluteTime = 0
    @objc public var renderEnd: CFAbsoluteTime = 0

    private override init() {}

    @objc public func recordLayoutStart() {
        layoutStart = CFAbsoluteTimeGetCurrent()
    }

    @objc public func recordLayoutEnd() {
        layoutEnd = CFAbsoluteTimeGetCurrent()
    }

    @objc public func recordRenderStart() {
        renderStart = CFAbsoluteTimeGetCurrent()
    }

    @objc public func recordRenderEnd() {
        renderEnd = CFAbsoluteTimeGetCurrent()
    }

    @objc public func getFrameStats() -> [String: Any] {
        let layoutTime = (layoutEnd - layoutStart) * 1000
        let renderTime = (renderEnd - renderStart) * 1000
        return [
            "layoutTime": layoutTime,
            "renderTime": renderTime
        ]
    }
}
