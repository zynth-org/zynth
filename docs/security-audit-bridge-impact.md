# Security Audit - Category 1: Impact & Remediation Scope

This document provides a quantitative assessment of the changes required to remediate the vulnerabilities identified in the Category 1 Bridge Communication audit.

| Vulnerability | Potentially At-Risk Files | Scope of Change | Complexity |
| :--- | :--- | :--- | :--- |
| **1. Unvalidated Type Confusion** | `ZynthModule.swift`, `ZynthModuleRegistry.kt`, and **ALL** native modules (e.g., `SampleModule.swift`, `FetchModule.kt`, `DeviceModule.swift`). | **Architectural Refactor**. Every native method implementation must be updated to use a new typed parameter extraction API. | High |
| **2. Resource Exhaustion** | `ZynthHermesRuntimeHost.mm`, `zynthkit.cpp`. | **Centralized Logic Change**. Localized to JSI Host Functions. Requires adding payload size guards and off-threading logic. | Medium |
| **3. Unauthorized Discovery** | `ZynthModuleRegistry` (iOS/Android), `ZynthModule` protocol/interface. | **Enforcement Update**. Adding mandatory method whitelisting to the base module definition and registry dispatch logic. | Low |
| **4. Verbose Error Leakage** | `ZynthModuleRegistry` (iOS/Android), `ZynthHermesRuntimeHost.mm`, `zynthkit.cpp`. | **Localized Sanitization**. Updating catch blocks in the bridge entry points to strip sensitive system information. | Low |
| **5. Message Replay** | `ZynthHermesRuntimeHost.mm`, `zynthkit.cpp`, `ZynthModuleRegistry` (iOS/Android). | **Feature Addition**. Implementing a nonce/session management layer within the bridge state machine. | Medium |

## Detailed Breakdown

### 1. Unvalidated Bridge Parameter Type Confusion
*   **Target Change**: Replace generic `Any?` (iOS) and `Array<Any?>` (Android) with a `ZynthArgs` wrapper that provides safe, typed getters (e.g., `args.getString("id")`).
*   **Impacted Files**: ~30+ files (scaling with the number of native modules).
*   **Metric**: ~15-20 lines of code change per native module.

### 2. Resource Exhaustion via Serialization Poisoning
*   **Target Change**: Implement `MAX_BRIDGE_PAYLOAD_SIZE` (e.g., 5MB) in `ZynthHermesRuntimeHost.mm` and `zynthkit.cpp`. Add a warning/error when the limit is exceeded.
*   **Impacted Files**: 2 files.
*   **Metric**: ~50 lines of C++ code total.

### 3. Unauthorized Native Method Discovery and Invocation
*   **Target Change**: Update `ZynthModule` to include `func exportedMethods() -> [String]`. Update registries to reject calls for methods not in this list.
*   **Impacted Files**: 4 core registry files.
*   **Metric**: ~100 lines of code across Swift/Kotlin.

### 4. Verbose Error Leakage across the Boundary
*   **Target Change**: Create an `ErrorSanitizer` utility. Update `ZynthModuleRegistry.call` to use this utility before returning the result dictionary to JS.
*   **Impacted Files**: 4 core registry files.
*   **Metric**: ~40 lines of code.

### 5. Bridge Message Interception and Replay
*   **Target Change**: Add a `bridgeSessionId` to the runtime. Require an incrementing `nonce` for sensitive calls. Verify nonces in the native registry state.
*   **Impacted Files**: JSI entry points (C++) and Native Registries (Swift/Kotlin).
*   **Metric**: ~200 lines of code; requires state management in the runtime.

## Performance & Rendering Hot Path Preservation

To ensure that security mitigations do not degrade the framework's rendering performance, the following implementation constraints are mandatory:

1.  **Bridge Bifurcation**: Specialized UI operations (`applyBatch`, `setProp`, `setText`) and Worklet signals must remain in their dedicated, high-speed JSI pathways. Security layers like Nonce verification or deep Type Validation should **NOT** be applied to these operations.
2.  **Zero-Cost Whitelisting**: Method whitelisting for native modules must use pre-computed HashSets (Kotlin) or Dictionaries (Swift) to ensure $O(1)$ lookup time during the dispatch phase.
3.  **Opt-in Sensitive Security**: Advanced protections (like Message Replay prevention) must be configurable per module. High-frequency modules (Sensors, Animations) will bypass these checks, while sensitive modules (Auth, SecureStore, Network) will opt-in.
4.  **Avoid Stringification in Hot Path**: The mitigation for "Resource Exhaustion" must only apply to generic `__modules.call` entries. UI batching using `ArrayBuffer` or `TypedArray` should bypass size-checks to avoid unnecessary byte-counting on the rendering thread.

