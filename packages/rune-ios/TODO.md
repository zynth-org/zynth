# TODO

# Rune iOS Core Finalization

This file tracks the necessary core platform enhancements to ensure the iOS SDK is stable, predictable, and feature-complete before building additional UI components.

---

## 1. Bridge & Interoperability Enhancements

### ☑ Native-to-JS Event Emitter

**Why:** The framework needs a standard way for native code to send events to JS listeners (e.g., device orientation changes, keyboard visibility).

**Files Involved:**

- `RuneKit/Hermes/HermesRuntimeHost.mm`
- `RuneKit/HermesAdapter.swift`
- `packages/rune-core/src/RuneBridge.ts` (or equivalent JS-side entry point)

**Implementation Steps:**

1.  **Expose Emitter from Swift:** In `HermesAdapter.swift`, add a public method `emitEvent(name: String, body: Any?)`.
2.  **Bridge to C++:** This Swift method will call a new C++ function in `HermesRuntimeHost.mm` (e.g., `runeEmitEvent`).
3.  **Dispatch to JS Thread:** The `runeEmitEvent` function must be thread-safe. It will use `dispatch_async` to schedule a block on the JS thread's GCD queue.
4.  **Invoke JS Callback:** Inside the block on the JS thread, call a global JS function (e.g., `global.RuneNativeEmitter.emit(eventName, body)`).
5.  **Create JS Emitter:** In the core JS package, create a `NativeEventEmitter` class that defines `global.RuneNativeEmitter` and provides `addListener(eventName, callback)` and `removeListener` methods for app developers to use.

### ☐ Efficient Binary Data Transfer (`ArrayBuffer`)

**Why:** Passing large binary data (images, files) as base64-encoded JSON strings is inefficient. The bridge should support direct `ArrayBuffer` access.

**Files Involved:**

- `RuneKit/Hermes/HermesRuntimeHost.mm`

**Implementation Steps:**

1.  **Update Module Invocation:** In `HermesRuntimeHost.mm`, modify the `__modules.call` and the new `__modules.callSync` functions.
2.  **Detect `ArrayBuffer`:** When processing arguments from JS, check if a `jsi::Value` is an `ArrayBuffer` using `arg.isObject() && arg.asObject(rt).isArrayBuffer(rt)`.
3.  **Pass Raw Data:** If an `ArrayBuffer` is detected, instead of stringifying it, get its raw data pointer and size (`getArrayBuffer(rt).data(rt)`, `getArrayBuffer(rt).size(rt)`).
4.  **Update Module Protocol:** The `RuneModule` protocol will need a new method signature that can accept this raw data (e.g., as a Swift `Data` object or an `UnsafeRawBufferPointer`).

---

## 2. Module System Finalization

### ☐ Module Lifecycle and Instantiation

**Why:** Complex modules need state and a lifecycle for setup and teardown (e.g., initializing a Bluetooth manager and cleaning up connections).

**Files Involved:**

- `RuneKit/RuneModule.swift`
- `RuneKit/HermesAdapter.swift`

**Implementation Steps:**

1.  **Update `RuneModule` Protocol:** Add optional `initialize()` and `invalidate()` methods to the protocol.
2.  **Manage Instances:** In `HermesAdapter.swift`, ensure that when the runtime is initialized, it creates and holds strong references to all registered module instances.
3.  **Invoke Lifecycle Methods:**
    - Call `initialize()` on each module after it has been instantiated.
    - Call `invalidate()` on each module when the `RuneView` or runtime is being deallocated to allow for resource cleanup.

### ☐ Synchronous Constants Exporting

**Why:** Modules need a way to export constants that are immediately available to JS on load, without an async call.

**Files Involved:**

- `RuneKit/RuneModule.swift`
- `RuneKit/Hermes/HermesRuntimeHost.mm`

**Implementation Steps:**

1.  **Add `constantsToExport`:** Add an optional computed property `var constantsToExport: [String: Any]?` to the `RuneModule` protocol.
2.  **Collect Constants:** During initialization in `HermesRuntimeHost.mm`, iterate through all registered native modules.
3.  **Build Constants Object:** For each module, call `constantsToExport`, and merge the results into a single `NSDictionary`.
4.  **Inject into JS:** Serialize the final dictionary to a JSON string. On the JS thread, parse this JSON and inject it as a global object (e.g., `global.NativeConstants = ...`). This should happen before the main JS bundle is executed.

---

## 3. Core Performance & Diagnostics

### ☐ Core Performance Markers

**Why:** To diagnose future performance issues, we need the ability to measure the core primitives (JS thread vs. UI thread time, layout time, etc.).

**Files Involved:**

- `RuneKit/ui/SNUIManager.m`
- A new `Performance` native module.

**Implementation Steps:**

1.  **Create `PerformanceModule`:** Create a new native module that conforms to `RuneSyncModule`.
2.  **Add Markers:** In `SNUIManager.m`, use `CFAbsoluteTimeGetCurrent()` to record timestamps at the beginning and end of key operations, especially within `sn_performFlush` (e.g., `layout_start`, `layout_end`, `render_start`, `render_end`).
3.  **Store Metrics:** Store these timing metrics in a thread-safe way within the `SNUIManager`.
4.  **Expose Metrics:** The `PerformanceModule` will expose a synchronous method like `getLastFrameStats()`. This method will read the latest metrics from the `SNUIManager` and return them to JS.
