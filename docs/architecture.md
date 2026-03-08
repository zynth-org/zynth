# Zynth Architecture

This document covers how the Zynth framework works internally. It is intended to aid in understanding the code, understanding how Zynth achieves high performance on mobile devices using SolidJS, and enabling contributors to modify the core system.

Note that Zynth is an experimental framework that makes different design decisions than React Native or other hybrid frameworks. These decisions prioritize performance and "native feel" over backward compatibility or web-standard strictness.

- [Architecture](#architecture)
  - [Design principles](#design-principles)
- [Overview](#overview)
  - [The Reactive Graph](#the-reactive-graph)
  - [The Host Interface](#the-host-interface)
- [Notes about Rendering](#notes-about-rendering)
  - [SolidJS Universal Renderer](#solidjs-universal-renderer)
  - [Batching and Flushing](#batching-and-flushing)
  - [View Recycling](#view-recycling)
- [Notes about the Runtime (ZynthKit)](#notes-about-the-runtime-zynthkit)
  - [Hermes and JSI](#hermes-and-jsi)
  - [The Bridge (\_\_ui)](#the-bridge-__ui)
  - [Yoga Layout](#yoga-layout)
  - [Threading Model](#threading-model)
- [Notes about Navigation](#notes-about-navigation)
  - [Memory-based Routing](#memory-based-routing)
  - [Native Screen Integration](#native-screen-integration)
  - [The Hypervisor Pattern](#the-hypervisor-pattern)
- [Notes about Animation](#notes-about-animation)
  - [Shared Values](#shared-values)
  - [Worklets and UI Thread](#worklets-and-ui-thread)
- [Notes about Bundling](#notes-about-bundling)
  - [Rsbuild and Dual-Targeting](#rsbuild-and-dual-targeting)
  - [Skyhook (AI Generation)](#skyhook-ai-generation)

## Architecture

### Design principles

- **Fine-Grained Reactivity**

  Zynth uses [SolidJS](https://www.solidjs.com/) as its core engine. Unlike React Native, there is no Virtual DOM (VDOM). Updates are surgical: when a signal changes, only the specific property on the specific native node is updated. This eliminates the "render phase" entirely.

- **Synchronous Native Interop (JSI)**

  We avoid the asynchronous JSON bridge serialization found in older React Native architectures. All communication between JavaScript and Native (C++/Swift/Kotlin) happens synchronously via the JavaScript Interface (JSI). This allows for instant response times and shared memory access.

- **Platform Agnostic Core**

  The core renderer (`@zynth/core`) is completely decoupled from the OS. It speaks a generic protocol ("create node", "set prop"). This allows the same application code to drive iOS, Android, and Web backends (via a DOM adapter) without changing the business logic.

- **Native-First Navigation**

  While routing logic stays in JavaScript (for flexibility), screen transitions and lifecycle are delegated to the OS (`UINavigationController` on iOS, Fragments on Android). This ensures swipe-back gestures and transition physics feel 100% authentic.

## Overview

The Zynth pipeline can be visualized as a direct pipeline from a Reactive Signal to a Native View mutation.

### The Reactive Graph

When the application starts, SolidJS executes the components once. This execution constructs a dependency graph of Signals, Memos, and Effects. DOM nodes (in our case, `HostNode` objects) are created and returned.

### The Host Interface

Zynth implements the SolidJS `Universal Renderer` API. Instead of creating HTML elements, it creates lightweight JavaScript objects (HostNodes) that represent a reference to a native view.

```typescript
// Conceptual HostNode
type HostNode = {
  id: number;
  type: "view" | "text" | "image";
};
```

When a signal updates, Solid calls the renderer's `setProperty` or `insertNode` methods. These methods push operations into a queue managed by the Zynth Host (`src/host/ios.ts` or `src/host/android.ts`).

## Notes about Rendering

### SolidJS Universal Renderer

The file `packages/zynth-core/src/renderer.ts` creates the Solid renderer. It maps standard DOM operations to our Host API:

- `createElement` -> `__ui.createNode(type)`
- `setProperty` -> `__ui.setProp(id, key, val)`
- `insertNode` -> `__ui.insertChild(parentId, childId, index)`

Because Solid is compiled, the JSX `<View style={{ width: 100 }} />` compiles down to efficient instruction calls, skipping any diffing process.

### Batching and Flushing

To maximize performance, we do not cross the JSI boundary for every single property update. Instead, `zynth-core` implements an operation queue.

1.  **Queueing**: When a component renders, multiple `createNode` and `setProp` calls occur. These are pushed to a JS array.
2.  **Flushing**: We use `queueMicrotask` (or `requestAnimationFrame`) to flush this queue at the end of the JavaScript event loop tick.
3.  **Transmission**: The entire batch is serialized (or passed as a JSI array) to the native side in a single call (`__ui.applyBatch`), drastically reducing bridge overhead.

### View Recycling

Zynth implements a custom view recycling system in JavaScript (similar to `RecyclerView` or `UITableView`) for its `FlatList` component.

- **The Problem**: Creating native views is expensive. Destroying and recreating them during scrolling causes frame drops.
- **The Solution**: When a node is "removed" from the list, Zynth doesn't destroy the native view. It keeps the `HostNode` ID in a pool. When a new row is needed, Zynth reclaims an ID from the pool and updates its properties. This avoids the expensive `createNode` and layout initialization steps on the native side.

## Notes about the Runtime (ZynthKit)

The native runtimes (`packages/zynth-core/ios` and `packages/zynth-core/android`) are collectively known as **ZynthKit**.

### Hermes and JSI

We use the [Hermes engine](https://hermesengine.dev/) exclusively. Hermes is optimized for mobile:

- **Bytecode**: JS is precompiled, enabling instant startup.
- **JSI**: It exposes the C++ API required for our synchronous bridge.

### The Bridge (\_\_ui)

The `__ui` global object is the sole entry point for UI mutations. It is a C++ HostObject injected into the JS runtime.

- **iOS**: Implemented in `ZynthUIManager.mm`. It maps integer IDs to `UIView` instances / Yoga Nodes.
- **Android**: Implemented in `ZynthBridge.kt` (via JNI). It maps IDs to `Android.View` instances / Yoga Nodes.

# Bridge Architecture: Type-Safe Communication

The Zynth framework employs a structured boundary between the JavaScript runtime and the native OS layers (Android/iOS). This document explains the design principles behind our type-safe bridge.

## The Core Problem: Type Confusion

In many hybrid frameworks, data passed from JavaScript to Native is handled as generic, untyped objects. This forces native developers to perform manual type casting, which is error-prone. A single incorrect assumption (e.g., treating a `null` as a `String`) can lead to:

1.  **Native Crashes**: Unhandled exceptions in the main thread.
2.  **Logic Bypasses**: Bypassing security checks because a variable didn't cast as expected.
3.  **Information Leakage**: Verbose stack traces sent back to the JS context.

## Our Solution: `ZynthArgs`

We use a specialized wrapper—`ZynthArgs`—that acts as a security checkpoint at the bridge entry point.

### How it Works

Instead of receiving a raw array or dictionary, every native module receives a `ZynthArgs` instance.

- **iOS**: Uses `ZynthArgs.swift` to wrap `Any?`.
- **Android**: Uses `ZynthArgs.kt` to wrap `JSONObject/JSONArray`.

### Key Benefits

1.  **Fail-Fast Validation**: Methods like `args.string("key")` throw descriptive, caught exceptions immediately if the input doesn't match the expected schema.
2.  **Sanitized Errors**: The bridge catch-all ensures that only safe, high-level error codes are returned to JavaScript, never internal memory addresses or file paths.
3.  **Zero Hot-Path Impact**: This validation is applied to high-level "General Purpose" modules. High-performance rendering paths (UI Batching/Worklets) use a separate binary-first pipeline to maintain 120fps performance.
4.  **Developer Experience**: Standardized getters reduce boilerplate and prevent the "forced unwrap" anti-pattern in Swift and Kotlin.

## Secure Module Discovery

To prevent unauthorized access to internal native logic, Zynth implements an **Explicit Whitelist** model for module method exposure.

### The Vulnerability: Implicit Exposure
In traditional bridge architectures, any public method on a native module might be reachable from JavaScript if the routing logic is not carefully managed. This can lead to "Discovery Attacks" where a malicious script probes the bridge for undocumented or helper methods.

### The Solution: `exportedMethods`
Every native module in Zynth must explicitly declare its public API surface:

- **iOS**: `var exportedMethods: [String] { get }`
- **Android**: `val exportedMethods: List<String>`

### Enforcement Mechanism
The `ZynthModuleRegistry` (on both platforms) acts as a Gatekeeper. Before a call is dispatched to a module's `call` method, the registry verifies that the requested method name exists in the `exportedMethods` list.

1.  **Strict Rejection**: If a method is not whitelisted, the call is rejected with a `METHOD_NOT_EXPORTED` error.
2.  **O(1) Performance**: Whitelists are indexed into optimized HashSets during module initialization, ensuring that this security check has zero measurable impact on call latency.
3.  **Auditability**: Security auditors can verify the entire framework's attack surface by simply scanning for `exportedMethods` definitions across the codebase.

## Secure Session & Replay Protection

For sensitive operations (e.g., Secure Storage, Biometric Auth, File System writes), whitelisting alone is insufficient. If a JavaScript context is compromised, an attacker could capture a legitimate command and "replay" it later. Zynth prevents this via a nonce-based protection layer.

### 1. The `bridgeSessionId`
Upon initialization, each `ZynthRuntime` generates a cryptographically secure UUID known as the `bridgeSessionId`. This ID is:
- Kept in native memory within the `ZynthModuleRegistry`.
- Exposed to JavaScript via `NativeConstants.bridgeSessionId`.
- Unique to the current app execution; it is regenerated every time the app reloads.

### 2. Protected Methods
Modules can opt-in to heightened security by defining `protectedMethods`:
- **iOS**: `var protectedMethods: [String] { get }`
- **Android**: `val protectedMethods: List<String>`

### 3. Nonce Validation
When a protected method is called, the native registry enforces the following rules:
1.  **Session Match**: The `bridgeSessionId` passed in the arguments must exactly match the native session ID. This prevents cross-runtime or stale-session attacks.
2.  **Nonce Monotonicity**: The call must include a numeric `nonce`. The registry tracks the `lastUsedNonce`. If the incoming nonce is less than or equal to the previous one, the call is rejected as a replay attack.

### 4. Zero-Boilerplate Implementation
To ensure this protection is used consistently, `@zynth/core` provides centralized `callNative` and `callNativeSync` helpers. These helpers automatically:
- Retrieve the current `bridgeSessionId` from global constants.
- Manage an incrementing `nonce` counter in the JS environment.
- Inject these security tokens into the argument payload before it crosses the JSI boundary.

This "Secure by Default" approach means that individual module developers don't need to manually handle security tokens, while the system remains resilient against common bridge-based attack vectors.

### Yoga Layout

Zynth uses [Yoga](https://yogalayout.dev/) (the same layout engine as React Native) to implement Flexbox.

- Every `HostNode` created in JS has a corresponding `YGNode` in C++.
- Styles like `flex`, `padding`, `margin` are applied directly to the `YGNode`.
- Layout is calculated on a background thread (or the UI thread, depending on platform strategy) before rendering frames.

### Threading Model

1.  **JS Thread**: Runs the SolidJS graph, business logic, and networking.
2.  **UI Thread (Main)**: Handles rendering, touch events, and animations.

Zynth ensures that heavy JS work does not block the UI thread, except when synchronous layout measurement is explicitly requested.

## Notes about Navigation

### Memory-based Routing

`@zynth/router` is a pure JavaScript implementation of a navigation stack. It maintains the state of routes, parameters, and history.

We chose a router over a native-controller-based router (like `react-native-screens`' native stack) to support the **Hypervisor** architecture. In a Hypervisor setup, multiple independent Zynth apps might run on the same screen. If they all tried to control the single global `UINavigationController`, chaos would ensue. A router keeps navigation state isolated per-app.

### Native Screen Integration

While the _state_ is in memory, the _visuals_ use native primitives.

- `@zynth/screens` exposes `Screen` and `ScreenContainer`.
- On iOS, these map to `UIViewController` containment APIs.
- This allows us to perform "Push" and "Pop" animations using the OS's native transitions, even though the decision to push/pop originated in JS.

### The Hypervisor Pattern

`@zynth/hypervisor` allows a "Host" Zynth app to embed "Guest" Zynth apps.

- **Isolation**: Each Guest runs in its own `ZynthRuntime` (separate Hermes VM).
- **Sandboxing**: Guests cannot crash the Host.
- **Communication**: Host and Guest communicate via `postMessage`.

This is the foundation for Skyhook-generated apps, allowing dynamic loading of code bundles.

## Notes about Animation

### Shared Values

Animations in Zynth are physics-based and interruptible. To avoid the latency of the JS bridge during 60fps animations, we use **Shared Values**.

- A `SharedValue` is a value (like `opacity` or `transform`) that is tracked by the native animation driver.
- When you start an animation (e.g., `withSpring`), the native side runs a loop (driven by `CADisplayLink` on iOS or `Choreographer` on Android).
- The native driver updates the view's property directly on the UI thread for every frame.
- The JS thread is only notified when the animation finishes (or if it's polling).

### Worklets and UI Thread

Worklets are compiler-marked functions that can read shared signals without bridge hops. They are intended to run on the UI thread once a native worklet runtime is available, but are safe to execute on the JS thread as a fallback.

- `createSharedSignal(initial)` creates a Solid-style signal backed by a JSI shared value when available.
- `createWorklet(() => { "worklet"; ... })` strips the directive at compile time and attaches metadata.
- The native runtime exposes `__zynth_shared_signals` as an alias to the core native shared-value store. This is a runtime-level bridge so multiple systems can read the same native values without extra serialization.

#### Native Signals Mental Model

Native signals are the "spearhead" concept: Solid-style signals that live in shared native storage and can be read synchronously by the UI thread. This collapses the typical "JS -> bridge -> UI" latency into a direct read.

**The pipeline:**

1. **Create:** `createSharedSignal(0)` allocates a native shared slot and returns `[get, set]` in JS.
2. **Update:** Calling `set(42)` writes the value directly to the native slot via JSI.
3. **Run:** `createWorklet(() => { "worklet"; ... })` is compiled into a serializable payload (code + captured inputs).
4. **Bind:** The native runtime registers the worklet and maps captured shared signals to host functions that read the shared slot.
5. **Execute:** The UI thread runs the worklet, pulling values synchronously without waiting for JS.

**Why this is fast:**

- No JSON serialization or async message passing.
- UI thread reads a native memory value directly.
- Solid's fine-grained reactivity keeps updates narrowly scoped.

**Example:**

```ts
const [offset, setOffset] = createSharedSignal(0);

createWorklet(() => {
  "worklet";
  view.setTranslationX(offset());
});

setOffset(60);
```

## Notes about Bundling

### Rsbuild and Dual-Targeting

We use [Rsbuild](https://rsbuild.dev/) (based on Rspack) for blazing fast builds. The `@zynth/rsbuild-plugin` manages the complexity of targeting two very different environments:

1.  **Web**: Standard HTML/CSS/JS output. Used for development iteration in the browser.
2.  **Native**:
    - **Shimmed Environment**: We inject polyfills for HMR (Hot Module Replacement) because standard WebSocket clients don't work the same way inside Hermes.
    - **Universal JSX**: Solid's compiler is configured to generate `universal` create calls instead of `document.createElement`.
    - **Hermes Bytecode**: The final JS bundle is often compiled to bytecode using the `hermesc` tool before being packaged into the app.

**Feature ownership model:**

- `@zynth/rsbuild-plugin` stays agnostic and exposes generic build primitives (e.g. generated module features).
- Feature packages (such as `@zynth/router`) own domain-specific semantics and provide helpers that emit those generic features.
- This keeps bundling extensible without embedding router policy inside the bundler integration layer.

### Skyhook (AI Generation)

Skyhook is the backend service that powers Zynth's "Prompt-to-App" capability.

1.  **Prompt**: User sends "Create a todo app".
2.  **Agent**: Skyhook spins up a Docker container with the `app` template. It runs an LLM agent (Goose) to write the code.
3.  **Build**: It runs `zynth bundle` inside the container.
4.  **Deploy**: The resulting bundle is served to the client, which loads it via the Hypervisor.
