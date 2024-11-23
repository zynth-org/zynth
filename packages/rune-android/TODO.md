# Rune Android Core Finalization

This file tracks the necessary core platform enhancements to ensure the Android SDK is stable, predictable, and feature-complete before building additional UI components.

---

## 1. Bridge & Interoperability Enhancements

### ☑ Native-to-JS Event Emitter

**Why:** The framework needs a standard way for native code to send events to JS listeners (e.g., device orientation changes, keyboard visibility).

**Files Involved:**

- `src/main/cpp/Bridge.cpp`
- `src/main/java/com/sonnatas/rune/JSBridge.kt`
- `packages/rune-core/src/RuneBridge.ts` (or equivalent JS-side entry point)

**Implementation Steps:**

1.  **Expose Emitter from Kotlin:** In `JSBridge.kt`, add a public method `emitEvent(name: String, body: String?)`.
2.  **Bridge to C++:** This Kotlin method will call a new native JNI function in `Bridge.cpp` (e.g., `runeEmitEvent`).
3.  **Dispatch to JS Thread:** The `runeEmitEvent` function must be thread-safe. It will use the `jsThreadHandler_` to post a `Runnable` to the JS thread.
4.  **Invoke JS Callback:** The `Runnable` will execute on the JS thread and call a global JS function (e.g., `global.RuneNativeEmitter.emit(eventName, body)`).
5.  **Create JS Emitter:** In the core JS package, create a `NativeEventEmitter` class that defines `global.RuneNativeEmitter` and provides `addListener(eventName, callback)` and `removeListener` methods for app developers to use.

### ☑ Efficient Binary Data Transfer (`ArrayBuffer`)

**Why:** Passing large binary data (images, files) as base64-encoded JSON strings is inefficient. The bridge should support direct `ArrayBuffer` access.

**Files Involved:**

- `src/main/cpp/Bridge.cpp`
- `src/main/java/com/sonnatas/rune/HermesModulesShim.kt`

**Implementation Steps:**

1.  **Update Module Invocation:** In `Bridge.cpp`, modify the `__modules.call` and the new `__modules.callSync` functions.
2.  **Detect `ArrayBuffer`:** When processing arguments from JS, check if a `jsi::Value` is an `ArrayBuffer`.
3.  **Pass Raw Data:** If an `ArrayBuffer` is detected, get its raw data pointer and size. Pass this to a new JNI method on `HermesModulesShim` that accepts a `java.nio.ByteBuffer`.
4.  **Update Module Interface:** The `RuneModule` interface will need a new method signature that can accept a `ByteBuffer` for processing.

---

## 2. Module System Finalization

### ☑ Module Lifecycle and Instantiation

**Why:** Complex modules need state and a lifecycle for setup and teardown (e.g., initializing a Bluetooth manager and cleaning up connections).

**Files Involved:**

- `src/main/java/com/sonnatas/rune/RuneModule.kt`
- `src/main/java/com/sonnatas/rune/HermesModulesShim.kt`

**Implementation Steps:**

1.  **Update `RuneModule` Interface:** Add `initialize()` and `invalidate()` methods to the interface.
2.  **Manage Instances:** In `HermesModulesShim.kt`, ensure that it holds the instantiated module objects.
3.  **Invoke Lifecycle Methods:**
    - Call `initialize()` on each module after it has been instantiated.
    - Add a public `destroy()` method to `HermesModulesShim` that calls `invalidate()` on all modules. This should be called when the `RuneView` is detached or destroyed.

### ☐ Synchronous Constants Exporting

**Why:** Modules need a way to export constants that are immediately available to JS on load, without an async call.

**Files Involved:**

- `src/main/java/com/sonnatas/rune/RuneModule.kt`
- `src/main/java/com/sonnatas/rune/HermesModulesShim.kt`
- `src/main/cpp/Bridge.cpp`

**Implementation Steps:**

1.  **Add `getConstants`:** Add a method `getConstants(): Map<String, Any>?` to the `RuneModule` interface.
2.  **Collect Constants:** In `HermesModulesShim.kt`, add a method `collectConstants()` that iterates through all modules, calls `getConstants`, and merges the results into a single `Map`.
3.  **Inject into JS:** This method will serialize the map to a JSON string and return it. A new JNI function will call this method from `Bridge.cpp` during initialization. The C++ code will then parse this JSON and inject it as a global object (e.g., `global.NativeConstants = ...`) before the main JS bundle is executed.

---

## 3. Core Performance & Diagnostics

### ☐ Core Performance Markers

**Why:** To diagnose future performance issues, we need the ability to measure the core primitives (JS thread vs. UI thread time, layout time, etc.).

**Files Involved:**

- `src/main/java/com/sonnatas/rune/RuneUIManager.kt`
- A new `Performance` native module.

**Implementation Steps:**

1.  **Create `PerformanceModule`:** Create a new native module that implements `RuneSyncModule`.
2.  **Add Markers:** In `RuneUIManager.kt`, use `System.nanoTime()` to record timestamps at the beginning and end of key operations within the `flush()` method (e.g., `layout_start`, `layout_end`, `render_start`, `render_end`).
3.  **Store Metrics:** Store these timing metrics in thread-safe properties (e.g., using `@Volatile` or `AtomicLong`).
4.  **Expose Metrics:** The `PerformanceModule` will expose a synchronous method like `getLastFrameStats()`. This method will read the latest metrics from the `RuneUIManager` and return them to JS as a JSON string.
