import Foundation

@objc(RuneComponentRegistry)
public class RuneComponentRegistry: NSObject {
    @objc public static let shared = RuneComponentRegistry()

    private var descriptors: [String: RuneComponentDescriptor] = [:]
    private let lock = NSLock()

    @objc public func register(_ descriptor: RuneComponentDescriptor) {
        lock.lock()
        defer { lock.unlock() }
        
        if descriptor.type.isEmpty {
            print("[RuneKit] Attempted to register component with empty type. Ignoring.")
            return
        }
        
        if let existing = descriptors[descriptor.type], existing !== descriptor {
            print("[RuneKit] Replacing existing component descriptor for type '\(descriptor.type)'.")
        }
        
        descriptors[descriptor.type] = descriptor
    }

    @objc public func getDescriptor(_ type: String) -> RuneComponentDescriptor? {
        lock.lock()
        defer { lock.unlock() }
        return descriptors[type]
    }

    @objc public func allDescriptors() -> [RuneComponentDescriptor] {
        lock.lock()
        defer { lock.unlock() }
        return Array(descriptors.values)
    }
    
    /// Create a shallow copy of the registry populated with current descriptors.
    /// Useful for creating isolated runtime registries that start with the global set.
    @objc public func copyRegistry() -> RuneComponentRegistry {
        let newRegistry = RuneComponentRegistry()
        lock.lock()
        defer { lock.unlock() }
        newRegistry.descriptors = self.descriptors
        return newRegistry
    }
}
