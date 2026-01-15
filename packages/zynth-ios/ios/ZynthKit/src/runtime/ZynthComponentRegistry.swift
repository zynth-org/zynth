import Foundation

@objc(ZynthComponentRegistry)
public class ZynthComponentRegistry: NSObject {
    @objc public static let shared = ZynthComponentRegistry()

    private var descriptors: [String: ZynthComponentDescriptor] = [:]
    private let lock = NSLock()

    @objc public func register(_ descriptor: ZynthComponentDescriptor) {
        lock.lock()
        defer { lock.unlock() }
        
        if descriptor.type.isEmpty {
            print("[ZynthKit] Attempted to register component with empty type. Ignoring.")
            return
        }
        
        if let existing = descriptors[descriptor.type], existing !== descriptor {
            print("[ZynthKit] Replacing existing component descriptor for type '\(descriptor.type)'.")
        }
        
        descriptors[descriptor.type] = descriptor
    }

    @objc public func getDescriptor(_ type: String) -> ZynthComponentDescriptor? {
        lock.lock()
        defer { lock.unlock() }
        return descriptors[type]
    }

    @objc public func allDescriptors() -> [ZynthComponentDescriptor] {
        lock.lock()
        defer { lock.unlock() }
        return Array(descriptors.values)
    }
    
    /// Create a shallow copy of the registry populated with current descriptors.
    /// Useful for creating isolated runtime registries that start with the global set.
    @objc public func copyRegistry() -> ZynthComponentRegistry {
        let newRegistry = ZynthComponentRegistry()
        lock.lock()
        defer { lock.unlock() }
        newRegistry.descriptors = self.descriptors
        return newRegistry
    }
}
