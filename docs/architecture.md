# Zynth Architecture

This document covers how the Zynth framework works internally. It is intended to aid in understanding the code, understanding how Zynth achieves high performance on mobile devices using SolidJS, and enabling contributors to modify the core system.

Note that Zynth is an experimental framework that makes different design decisions than React Native or other hybrid frameworks. These decisions prioritize performance and "native feel" over backward compatibility or web-standard strictness.

*   [Architecture](#architecture)
    *   [Design principles](#design-principles)
*   [Overview](#overview)
    *   [The Reactive Graph](#the-reactive-graph)
    *   [The Host Interface](#the-host-interface)
*   [Notes about Rendering](#notes-about-rendering)
    *   [SolidJS Universal Renderer](#solidjs-universal-renderer)
    *   [Batching and Flushing](#batching-and-flushing)
    *   [View Recycling](#view-recycling)
*   [Notes about the Runtime (ZynthKit)](#notes-about-the-runtime-zynthkit)
    *   [Hermes and JSI](#hermes-and-jsi)
    *   [The Bridge (__ui)](#the-bridge-__ui)
    *   [Yoga Layout](#yoga-layout)
    *   [Threading Model](#threading-model)
*   [Notes about Navigation](#notes-about-navigation)
    *   [Memory-based Routing](#memory-based-routing)
    *   [Native Screen Integration](#native-screen-integration)
    *   [The Hypervisor Pattern](#the-hypervisor-pattern)
*   [Notes about Animation](#notes-about-animation)
    *   [Shared Values](#shared-values)
    *   [Worklets and UI Thread](#worklets-and-ui-thread)
*   [Notes about Bundling](#notes-about-bundling)
    *   [Rsbuild and Dual-Targeting](#rsbuild-and-dual-targeting)
    *   [Skyhook (AI Generation)](#skyhook-ai-generation)

## Architecture

### Design principles

*   **Fine-Grained Reactivity**

    Zynth uses [SolidJS](https://www.solidjs.com/) as its core engine. Unlike React Native, there is no Virtual DOM (VDOM). Updates are surgical: when a signal changes, only the specific property on the specific native node is updated. This eliminates the "render phase" entirely.

*   **Synchronous Native Interop (JSI)**

    We avoid the asynchronous JSON bridge serialization found in older React Native architectures. All communication between JavaScript and Native (C++/Swift/Kotlin) happens synchronously via the JavaScript Interface (JSI). This allows for instant response times and shared memory access.

*   **Platform Agnostic Core**

    The core renderer (`@zynth/core`) is completely decoupled from the OS. It speaks a generic protocol ("create node", "set prop"). This allows the same application code to drive iOS, Android, and Web backends (via a DOM adapter) without changing the business logic.

*   **Native-First Navigation**

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
}
```

When a signal updates, Solid calls the renderer's `setProperty` or `insertNode` methods. These methods push operations into a queue managed by the Zynth Host (`src/host/ios.ts` or `src/host/android.ts`).

## Notes about Rendering

### SolidJS Universal Renderer

The file `packages/zynth-core/src/renderer.ts` creates the Solid renderer. It maps standard DOM operations to our Host API:

*   `createElement` -> `__ui.createNode(type)`
*   `setProperty` -> `__ui.setProp(id, key, val)`
*   `insertNode` -> `__ui.insertChild(parentId, childId, index)`

Because Solid is compiled, the JSX `<View style={{ width: 100 }} />` compiles down to efficient instruction calls, skipping any diffing process.

### Batching and Flushing

To maximize performance, we do not cross the JSI boundary for every single property update. Instead, `zynth-core` implements an operation queue.

1.  **Queueing**: When a component renders, multiple `createNode` and `setProp` calls occur. These are pushed to a JS array.
2.  **Flushing**: We use `queueMicrotask` (or `requestAnimationFrame`) to flush this queue at the end of the JavaScript event loop tick.
3.  **Transmission**: The entire batch is serialized (or passed as a JSI array) to the native side in a single call (`__ui.applyBatch`), drastically reducing bridge overhead.

### View Recycling

Zynth implements a custom view recycling system in JavaScript (similar to `RecyclerView` or `UITableView`) for its `FlatList` component.

*   **The Problem**: Creating native views is expensive. Destroying and recreating them during scrolling causes frame drops.
*   **The Solution**: When a node is "removed" from the list, Zynth doesn't destroy the native view. It keeps the `HostNode` ID in a pool. When a new row is needed, Zynth reclaims an ID from the pool and updates its properties. This avoids the expensive `createNode` and layout initialization steps on the native side.

## Notes about the Runtime (ZynthKit)

The native runtimes (`packages/zynth-ios` and `packages/zynth-android`) are collectively known as **ZynthKit**.

### Hermes and JSI

We use the [Hermes engine](https://hermesengine.dev/) exclusively. Hermes is optimized for mobile:
*   **Bytecode**: JS is precompiled, enabling instant startup.
*   **JSI**: It exposes the C++ API required for our synchronous bridge.

### The Bridge (__ui)

The `__ui` global object is the sole entry point for UI mutations. It is a C++ HostObject injected into the JS runtime.

*   **iOS**: Implemented in `ZynthUIManager.mm`. It maps integer IDs to `UIView` instances / Yoga Nodes.
*   **Android**: Implemented in `ZynthBridge.kt` (via JNI). It maps IDs to `Android.View` instances / Yoga Nodes.

### Yoga Layout

Zynth uses [Yoga](https://yogalayout.dev/) (the same layout engine as React Native) to implement Flexbox.
*   Every `HostNode` created in JS has a corresponding `YGNode` in C++.
*   Styles like `flex`, `padding`, `margin` are applied directly to the `YGNode`.
*   Layout is calculated on a background thread (or the UI thread, depending on platform strategy) before rendering frames.

### Threading Model

1.  **JS Thread**: Runs the SolidJS graph, business logic, and networking.
2.  **UI Thread (Main)**: Handles rendering, touch events, and animations.

Zynth ensures that heavy JS work does not block the UI thread, except when synchronous layout measurement is explicitly requested.

## Notes about Navigation

### Memory-based Routing

`@zynth/memory-router` is a pure JavaScript implementation of a navigation stack. It maintains the state of routes, parameters, and history.

We chose a memory router over a native-controller-based router (like `react-native-screens`' native stack) to support the **Hypervisor** architecture. In a Hypervisor setup, multiple independent Zynth apps might run on the same screen. If they all tried to control the single global `UINavigationController`, chaos would ensue. A memory router keeps navigation state isolated per-app.

### Native Screen Integration

While the *state* is in memory, the *visuals* use native primitives.
*   `@zynth/screens` exposes `Screen` and `ScreenContainer`.
*   On iOS, these map to `UIViewController` containment APIs.
*   This allows us to perform "Push" and "Pop" animations using the OS's native transitions, even though the decision to push/pop originated in JS.

### The Hypervisor Pattern

`@zynth/hypervisor` allows a "Host" Zynth app to embed "Guest" Zynth apps.
*   **Isolation**: Each Guest runs in its own `ZynthRuntime` (separate Hermes VM).
*   **Sandboxing**: Guests cannot crash the Host.
*   **Communication**: Host and Guest communicate via `postMessage`.

This is the foundation for Skyhook-generated apps, allowing dynamic loading of code bundles.

## Notes about Animation

### Shared Values

Animations in Zynth are physics-based and interruptible. To avoid the latency of the JS bridge during 60fps animations, we use **Shared Values**.

*   A `SharedValue` is a value (like `opacity` or `transform`) that is tracked by the native animation driver.
*   When you start an animation (e.g., `withSpring`), the native side runs a loop (driven by `CADisplayLink` on iOS or `Choreographer` on Android).
*   The native driver updates the view's property directly on the UI thread for every frame.
*   The JS thread is only notified when the animation finishes (or if it's polling).

## Notes about Bundling

### Rsbuild and Dual-Targeting

We use [Rsbuild](https://rsbuild.dev/) (based on Rspack) for blazing fast builds. The `@zynth/rsbuild-plugin` manages the complexity of targeting two very different environments:

1.  **Web**: Standard HTML/CSS/JS output. Used for development iteration in the browser.
2.  **Native**:
    *   **Shimmed Environment**: We inject polyfills for HMR (Hot Module Replacement) because standard WebSocket clients don't work the same way inside Hermes.
    *   **Universal JSX**: Solid's compiler is configured to generate `universal` create calls instead of `document.createElement`.
    *   **Hermes Bytecode**: The final JS bundle is often compiled to bytecode using the `hermesc` tool before being packaged into the app.

### Skyhook (AI Generation)

Skyhook is the backend service that powers Zynth's "Prompt-to-App" capability.

1.  **Prompt**: User sends "Create a todo app".
2.  **Agent**: Skyhook spins up a Docker container with the `app` template. It runs an LLM agent (Goose) to write the code.
3.  **Build**: It runs `zynth bundle` inside the container.
4.  **Deploy**: The resulting bundle is served to the client, which loads it via the Hypervisor.
