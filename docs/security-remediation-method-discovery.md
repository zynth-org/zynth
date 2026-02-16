# Security Remediation Plan: Method Discovery & Whitelisting (Problem #3)

## Overview
This plan addresses the vulnerability where native modules might inadvertently expose private methods to the JavaScript context. By moving from an "implicit exposure" model to an "explicit whitelist" model, we ensure that only audited and intended functionality is reachable via the bridge.

### Why are we doing this?
Currently, method routing is handled via `switch/case` or direct string matching in the `call` function. While safer than reflection, it lacks a standardized enforcement layer. A malicious script could potentially probe the bridge to find undocumented methods if the routing logic is not strictly enforced at the registry level.

---

## Phase 1: Protocol & Registry Enforcement
**Goal**: Update the framework core to require method registration.

### 1.1 Interface Update
Add an `exportedMethods` requirement to the base module definitions:
- **iOS (`ZynthModule.swift`)**: Add `var exportedMethods: [String] { get }`.
- **Android (`ZynthModule.kt`)**: Add `val exportedMethods: List<String>`.

### 1.2 Registry Validation
Update `ZynthModuleRegistry` on both platforms to check the whitelist **before** invoking the module's `call` method. If a method is not in the list, the registry will reject the call with a `METHOD_NOT_EXPORTED` error without ever touching the module logic.

---

## Phase 2: Core & Secure Module Migration
**Goal**: Apply whitelisting to the most sensitive areas of the framework.

### 2.1 Impacted Files & Risk Assessment
| Module | Sensitivity | Impacted Files |
| :--- | :--- | :--- |
| **SecureStore** | Critical | `ZynthSecureStoreModule` (iOS/Android) |
| **FileSystem** | Critical | `ZynthFileSystemModule` (iOS/Android) |
| **Network** | High | `FetchModule` (iOS/Android) |
| **Hypervisor** | High | `ZynthHypervisorView` (iOS/Android) |

### 2.2 Migration Steps
Each module will now explicitly declare its API surface:
```swift
// Example iOS Migration
var exportedMethods: [String] {
    return ["getItem", "setItem", "deleteItem"]
}
```

---

## Phase 3: Automated Auditing & Tooling
**Goal**: Prevent future regressions and automate security checks.

### 3.1 Static Analysis (Linter)
Introduce a simple check in the build process to ensure that every `case "methodName":` in a module's `call` function has a corresponding entry in the `exportedMethods` list.

### 3.2 Documentation Generation
The `exportedMethods` list will serve as the "Source of Truth" for our public API documentation, ensuring that our security posture and our documentation are always in sync.

---

## Performance Considerations
- **O(1) Lookup**: Whitelists will be converted to HashSets/Sets during module initialization to ensure that the security check adds negligible overhead (sub-microsecond) to the bridge call.
- **Lazy Initialization**: The whitelist is only computed once per module lifecycle.
