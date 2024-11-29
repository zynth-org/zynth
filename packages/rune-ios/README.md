# `@rune/ios`

This package contains the native iOS SDK for the Rune framework. It provides the `RuneKit` module, which includes the Hermes JavaScript runtime, JSI bridge, Yoga layout engine, and a custom renderer that interfaces with `UIKit`.

## Core Platform Support

This document tracks the implementation status of core features for the iOS SDK.

### High-Level Feature Status

- **JS Engine (Hermes):** ✅ **Complete**. The iOS runtime uses Hermes as its JavaScript engine, managed through `HermesRuntimeHost.mm` and the `HermesAdapter.swift` wrapper.
- **Bridge (JSI):** ✅ **Complete**. JSI is used to expose native functionality to JavaScript. Host functions for `__ui`, `__modules`, timers (`setTimeout`/`clearTimeout`), and diagnostics are all registered in `HermesRuntimeHost.mm`.
- **Layout (Yoga):** ✅ **Complete**. `SNUIManager.m` integrates Yoga for layout. It correctly uses Yoga's C API to manage layout nodes and applies styles. Text measurement is handled via a Yoga measure function (`SNMeasureLabelFunc`) for `UILabel`.
- **Renderer:** ✅ **Complete**. The renderer batches UI updates and flushes them once per frame using `CADisplayLink`. A manual `__ui.flush()` is also exposed for debugging.
- **Diagnostics:** ✅ **Complete**. A unified error pipeline is in place. `HermesRuntimeHost.mm` catches JSI errors, standard exceptions, and unhandled promise rejections, forwarding them to a Swift-side handler that can display a RedBox.
- **Modules:** ✅ **Complete**. The `__modules.call` function is Promise-based and executes module logic on a background GCD queue to avoid blocking the JS or main threads.
- **Hermes Bytecode (HBC):** ✅ **Complete**. The `HermesRuntimeHost` can evaluate pre-compiled Hermes bytecode (`.hbc` files) and includes a fallback to interpret the data as UTF-8 source code if it's not valid bytecode.
- **Handler Hygiene:** ✅ **Complete**. `SNUIManager.m` and `HermesRuntimeHost.mm` correctly manage the lifecycle of tap gesture handlers, ensuring they are added and removed as `onPress` props change to prevent leaks or duplicate invocations.

---

### Core Pillars — Detailed Progress

#### 1. Runtime & Bridge

- **Single-thread discipline:** ✅ **Implemented**. `HermesRuntimeHost.mm` uses a serial GCD queue (`com.rune.hermes.js`) for all JavaScript execution, ensuring thread safety. UI and Yoga operations are dispatched to the main thread from `SNUIManager.m`.
- **Promise-based `__modules.call`:** ✅ **Implemented**. The `installModulesBridge` function in `HermesRuntimeHost.mm` creates a `__modules.call` host function that returns a JSI `Promise`. The native module logic is executed asynchronously on a background queue.
- **Exception Propagation:** ✅ **Implemented**. JSI errors, `std::exception`, and `NSException` are caught and routed through a unified reporting mechanism (`RuneReportJSIError`, `reportStdException:`), which ultimately triggers the RedBox.
- **Timers MVP:** ✅ **Implemented**. `setTimeout` and `clearTimeout` are polyfilled in JavaScript by calling `__hostSetTimeout` and `__hostClearTimeout`. These host functions use `dispatch_source_t` timers that execute their callbacks on the JS thread, respecting the single-thread model.

#### 2. Layout & Measurement

- **Yoga MVP:** ✅ **Implemented**. `SNUIManager.m`'s `sn_applyStyleDictionary:toNode:` method shows support for `flexDirection`, `justifyContent`, `alignItems`, `flex`, `width`, `height`, `padding`, `margin`, and `borderRadius`.
- **Text Measurement:** ✅ **Implemented**. `SNUIManager.m` correctly sets a Yoga measure function (`SNMeasureLabelFunc`) on nodes that are `UILabel`s. This function uses `-[UILabel sizeThatFits:]` to accurately measure text, enabling proper text wrapping and sizing.

#### 3. Render Scheduling & Batching

- **One-flush-per-frame:** ✅ **Implemented**. `SNUIManager.m` uses a `CADisplayLink` to trigger `sn_performFlush` at most once per frame. UI operations mark the manager as "dirty" (`sn_markNeedsFlush`), which schedules the flush.
- **Manual `__ui.flush()`:** ✅ **Implemented**. The `__ui.flush` host function is exposed, allowing for manual flushes from JavaScript.
- **Handler De-duplication:** ✅ **Implemented**. The logic in `setPropCallback:name:callback:` and `setHandler:name:` in `SNUIManager.m` correctly removes old gesture recognizers before attaching new ones, preventing multiple callbacks from being attached to the same view.

#### 4. Diagnostics & Dev UX

- **RedBox:** ✅ **Implemented**. The `HermesRuntimeHost` has a robust exception handling mechanism that reports errors to a Swift-side `exceptionHandler`. This handler is responsible for showing the RedBox with a message and stack trace.
- **Unhandled Rejections:** ✅ **Implemented**. `installUnhandledPromiseReporting` in `HermesRuntimeHost.mm` patches `Promise.prototype.then` to catch unhandled rejections and report them through the same diagnostics pipeline, ensuring they also trigger a RedBox.

#### 5. Module System

- **Stable JSON Envelope:** ✅ **Implemented**. The `__modules.call` bridge in `HermesRuntimeHost.mm` stringifies the arguments to JSON before passing them to the native side and expects a JSON string back.
- **Background Execution:** ✅ **Implemented**. The `installModulesBridge` function uses `dispatch_async` to run the module handler on a concurrent GCD queue, preventing long-running native tasks from blocking the JS thread.

#### Module Features

- **Lifecycle Methods:** ✅ **Implemented**. Modules can implement optional `initialize()` and `invalidate()` methods for setup and teardown logic, managed by the `HermesAdapter`.
- **Native-to-JS Events:** ✅ **Implemented**. A standardized event emitter allows native Swift or Objective-C code to send events to JavaScript listeners, enabling communication for device events like orientation or keyboard status.
- **Synchronous Constants:** ✅ **Implemented**. Modules can export constants that are synchronously available to JavaScript upon initialization, avoiding the need for an async bridge call for static data.
- **`ArrayBuffer` Support:** ⚠️ **Partially Implemented**. The bridge supports passing binary data from JS to native (`ArrayBuffer` -> Swift `Data`). However, returning `Data` from native back to a JS `ArrayBuffer` is not yet supported and will result in an empty object.

#### 6. Packaging & Templates

- **Yarn Workspaces & Packaging:** ✅ **Implemented**. The root `README.md` confirms the monorepo structure with packages like `@rune/core`, `@rune/ios`, etc., managed by Yarn workspaces.
- **Consumption from `node_modules`:** ✅ **Implemented**. The `README.md` also mentions that apps consume SDKs from `node_modules` via prebuild scripts, which is consistent with the project's architecture.
