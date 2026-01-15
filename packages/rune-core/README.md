# @rune/core

The core renderer and bridge interface for the Rune framework.

This package connects SolidJS's fine-grained reactivity to the native Rune runtime (iOS and Android). It implements a custom SolidJS universal renderer that translates reactive updates into optimized native commands.

## Architecture

`@rune/core` acts as the "Host" in the SolidJS Universal Renderer architecture. It is responsible for:

1.  **Reactivity Adapter**: `createRuneRenderer` (in `src/renderer.ts`) maps SolidJS primitives (`createNode`, `insertNode`, `setProperty`, etc.) to the platform-specific host.
2.  **Bridge Interface**: Defines the contract (`src/bridge.ts`) that the native environment must provide.
    *   `global.__ui`: The UI mutation bridge (create nodes, update props).
    *   `global.__modules`: The native module invocation bridge.
3.  **Host Implementation**: Platform-specific implementations (`src/host/android.ts`, `src/host/ios.ts`) that manage the command queue.

## Features

### Batched Updates
To minimize the overhead of the JavaScript-to-Native bridge (JSI), `@rune/core` aggregates multiple DOM operations into a single batch.
*   **Queueing**: Operations like `setProp` or `insertNode` are pushed to a microtask queue or managed via `requestAnimationFrame`.
*   **Flushing**: The queue is flushed at the end of the JavaScript event loop, sending a single JSON payload or performing a block of JSI calls via `applyBatch`.

### Node Recycling
Rune implements a JS-side recycling mechanism to handle large lists efficiently, similar to Android's `RecyclerView` or iOS `UITableView`.
*   **Pools**: Removed nodes are kept in a pool instead of being destroyed.
*   **Rehydration**: When a new item is rendered (e.g., in a `<For>` loop), a node is claimed from the pool and re-bound with new data, avoiding expensive native view creation.

### Platform Agnostic
While primarily designed for Native, `rune-core` includes a Web host (`src/host/web.ts`) allowing Rune components to run in standard web browsers by mapping to the DOM.