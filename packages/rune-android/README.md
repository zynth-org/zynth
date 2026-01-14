# `@rune/android`

This package contains the native Android SDK for the Rune framework. It provides the `RuneKit` module, which includes the Hermes JavaScript runtime, a JSI bridge, the Yoga layout engine, and a custom renderer that interfaces with Android's `View` system.

## Core Platform Support

This document tracks the implementation status of core features for the Android SDK.

### High-Level Feature Status

- **JS Engine (Hermes):** ✅ **Complete**. The Android runtime uses Hermes as its JavaScript engine, managed through `HermesAdapter.kt` and the C++ JSI layer in `Bridge.cpp`.
- **Bridge (JSI):** ✅ **Complete**. JSI is used to expose native functionality to JavaScript. The C++ layer (`Bridge.cpp`) registers host functions for `__ui`, `__modules`, timers (`setTimeout`/`clearTimeout`), and diagnostics, which are then called from Kotlin shims.
- **Layout (Yoga):** ✅ **Complete**. The `RuneUIManager` uses `YogaLayoutEngine` which integrates Yoga for layout. Text measurement is handled via a Yoga measure function for `TextView`.
- **Renderer:** ✅ **Complete**. The renderer batches UI updates and flushes them once per frame using Android's `Choreographer`. A manual `__ui.flush()` is also exposed for debugging.
- **Diagnostics:** ✅ **Complete**. A unified error pipeline is in place. `Bridge.cpp` catches JSI errors and forwards them to a Kotlin-side handler (`RuneDiagnostics`) that displays a RedBox.
- **Modules:** ✅ **Complete**. The `__modules.call` function is Promise-based. The `HermesModulesShim` executes module logic on a background `ExecutorService` to avoid blocking the JS or main threads.
- **Hermes Bytecode (HBC):** ✅ **Complete**. `HermesAdapter.kt`'s `loadMainBundle` method prefers `main.hbc` when enabled (default on in release via `BuildConfig.RUNE_USE_HBC`, overridable with `RUNE_USE_HBC`), and falls back to `main.js`.
- **Handler Hygiene:** ✅ **Complete**. The `RuneUIManager` correctly manages the lifecycle of click listeners, ensuring they are added and removed as `onPress` props change to prevent leaks or duplicate invocations.

---

### Core Pillars — Detailed Progress

#### 1. Runtime & Bridge

- **Single-thread discipline:** ✅ **Implemented**. `HermesAdapter.kt` creates and uses a dedicated `HandlerThread` ("RuneHermesJS") for all JavaScript execution, ensuring thread safety. UI and Yoga operations are dispatched to the main thread from `RuneUIManager`.
- **Promise-based `__modules.call`:** ✅ **Implemented**. The `installModules` function in `Bridge.cpp` creates a `__modules.call` host function that returns a JSI `Promise`. The native module logic is executed asynchronously on a background thread via `HermesModulesShim`.
- **Exception Propagation:** ✅ **Implemented**. JSI errors are caught in `Bridge.cpp` and routed through a unified reporting mechanism (`RuneReportJSIError`), which calls into the Kotlin-based `RuneDiagnostics` system to trigger the RedBox.
- **Timers MVP:** ✅ **Implemented**. `setTimeout` and `clearTimeout` are implemented in `Bridge.cpp` and `JSBridge.kt`. The `HandlerTimerShim` uses a `Handler` on the JS thread's `Looper` to schedule and cancel timers, ensuring callbacks execute on the correct thread.

#### 2. Layout & Measurement

- **Yoga MVP:** ✅ **Implemented**. `RuneUIManager` and `YogaLayoutEngine` show support for `flexDirection`, `justifyContent`, `alignItems`, `flex`, `width`, `height`, `padding`, `margin`, and `borderRadius`.
- **Text Measurement:** ✅ **Implemented**. `YogaLayoutEngine` correctly sets a Yoga measure function on nodes that are `TextView`s. This function uses `TextView.measure()` to accurately measure text, enabling proper text wrapping and sizing.

#### 3. Render Scheduling & Batching

- **One-flush-per-frame:** ✅ **Implemented**. `RuneUIManager` uses Android's `Choreographer` to post a frame callback, ensuring `flush()` is called at most once per frame.
- **Manual `__ui.flush()`:** ✅ **Implemented**. The `__ui.flush` host function is exposed via `JSBridge.kt` and `Bridge.cpp`, allowing for manual flushes from JavaScript.
- **Handler De-duplication:** ✅ **Implemented**. The logic in `RuneUIManager`'s `setHandler` method correctly removes old click listeners before attaching new ones, preventing multiple callbacks from being attached to the same view.

#### 4. Diagnostics & Dev UX

- **RedBox:** ✅ **Implemented**. The C++ bridge's `RuneReportJSIError` function calls into a Kotlin JNI function (`runeDiagnosticsReportJNI`) which then uses the `RuneDiagnostics` object to show a RedBox with a message and stack trace.
- **Unhandled Rejections:** ✅ **Implemented**. `installUnhandledPromiseReporting` in `Bridge.cpp` patches `Promise.prototype.then` to catch unhandled rejections and report them through the same diagnostics pipeline, ensuring they also trigger a RedBox.

#### 5. Module System

- **Stable JSON Envelope:** ✅ **Implemented**. The `__modules.call` bridge in `Bridge.cpp` stringifies the arguments to JSON before passing them to the Kotlin `HermesModulesShim`, which expects a JSON string back.
- **Background Execution:** ✅ **Implemented**. The `HermesModulesShim` uses a dedicated `ExecutorService` to run module logic on a background thread, preventing long-running native tasks from blocking the JS thread.

#### Module Features

- **Lifecycle Methods:** ✅ **Implemented**. Modules can implement `initialize()` and `invalidate()` for setup and teardown, invoked by the `HermesModulesShim`.
- **Native-to-JS Events:** ✅ **Implemented**. A standard event emitter (`JSBridge.emitEvent`) allows native Kotlin code to send events to JavaScript listeners.
- **Synchronous Constants:** ✅ **Implemented**. Modules can export constants via `getConstants()` that are synchronously available to JavaScript when the runtime loads.
- **`ArrayBuffer` Support:** ✅ **Implemented**. The bridge supports passing binary data directly from a JS `ArrayBuffer` to a Kotlin `java.nio.ByteBuffer`, optimizing large data transfers.

#### 6. Packaging & Templates

- **Yarn Workspaces & Packaging:** ✅ **Implemented**. The root `README.md` confirms the monorepo structure with packages like `@rune/core`, `@rune/android`, etc., managed by Yarn workspaces.
- **Consumption from `node_modules`:** ✅ **Implemented**. The `README.md` also mentions that apps consume SDKs from `node_modules` via prebuild scripts, which is consistent with the project's architecture.
