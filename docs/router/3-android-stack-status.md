## Android Stack Status

### Purpose

This document captures the current architecture of the minimal Android router stack, the recent surface-aware changes inside `RuneUIManager`, and how the native/JS layers cooperate to keep multiple surfaces isolated while handling transitions. It is meant to serve as a living reference for anyone working on navigation, fragment lifecycle, or surface cleanup in Rune’s Android stack.

### Architecture Overview

1. **Fragment-driven navigation** – Each navigation operation (`pushScreen`/`popScreen`) is a Kotlin `FragmentTransaction`. A `RuneScreenFragment` hosts a `RuneRootView` and attaches it to a dedicated surface id.
2. **One runtime, many surfaces** – There is a single `RuneRuntime`, but every fragment registers its own `RuneRootView` with that runtime. The runtime keeps one active surface id so that JS actions target the correct tree.
3. **Native animations + JS render** – The fragment transition carries the Android slide animation. Once the fragment’s view is created, it evaluates `__renderRouterScreen(rootId, screenName, params)` so Solid renders the component into the native surface. Disposal calls `__disposeRouterScreen`.
4. **Surface metadata** – `RuneNavigationContainer` tracks each `RuneScreenFragment` by surface id in a registry so callbacks from the runtime can wake the correct fragment (e.g., surface ready/disposed).

### RuneUIManager Surface Changes

#### Per-surface state

- `RuneUIManager` now stores surface information in a `ConcurrentHashMap<Int, SurfaceState>`.
- Each `SurfaceState` owns its own flavor of the original runner: `RuneLayoutFlush`, `YogaLayoutEngine`, `FrameScheduler`, node cache, pending operation queues, prop applier, and event manager.
- Surfaces retain `firstFrameListeners` to notify consumers when their first layout/paint cycle completes.

#### `RuneLayoutFlush` updates

- A first-frame callback can now be supplied via `setOnFirstFrameCallback`. It fires after a flush produces at least one renderable child so fragments know when to start postponed transitions.
- The flush scheduler still uses the same `FrameScheduler`, batching model, and performance tracking, but this callback hook plugs into the new per-surface lifecycle.

#### Runtime helpers

- `RuneRuntime` exposes `addSurfaceFirstFrameListener`/`removeSurfaceFirstFrameListener`, letting native code subscribe without poking the UI manager directly.
- In addition, `getRootSurfaceId()` exposes the activity root id so fragments can reactivate the base surface when detail surfaces are torn down.

### Router Surface Flow

1. **Surface creation**
   - `RuneScreenFragment` allocates a new root id (`RuneRootView.allocateRootId()`), registers the fragment and surface with `RuneNavigationContainer`, and tells `RuneRuntime` about the new surface via `registerSurface`.
   - The fragment also requests the runtime to set the new surface active before calling `__renderRouterScreen`, ensuring Solid writes to the correct layout tree.
2. **First-frame signal**
   - `RuneLayoutFlush` executes the first-frame callback once the JS tree has flushed a layout with visible children.
   - The fragment registers a listener that ultimately calls `RuneNavigationContainer.notifySurfaceReady`, which resumes the postponed enter transition and fades in the surface.
   - There is still a 600 ms fallback in case JS never calls back, but the native listener provides the reliable signal.
3. **Disposal**
   - When a fragment pops, it evaluates `__disposeRouterScreen` and immediately triggers `__modules.call("RuneAndroidRouter", "surfaceDisposed", [rootId])`.
   - The bridge calls `RuneNavigationContainer.notifySurfaceDisposed`, allowing Kotlin to unregister the surface, cancel timeouts, set the active surface back to the base, and clean the registry.
   - A log via `surfaceDisposed` ensures we can track mismatched ids and guard against duplicate disposals.

### Suppression of cross-surface mutations

- The Android host (`packages/rune-core/src/host/android.ts`) now toggles a `__runeSuppressNativeMutations` flag. When that flag is set:
  - All queued host operations (setProp, setText, insertChild, removeChild, etc.) are dropped.
  - Batches honor the flag, so Solid flushes keep quiet until the flag is cleared.
- `nativeRenderer.ts` suppresses mutations during `dispose()` by incrementing/decrementing the same global counter. That keeps the Details surface from issuing `removeNode` calls that would accidentally clear the Home surface.
- This simple guard prevents the “destroy node 1, 3, 7…” logs that previously interfered with the root surface while detail views tear down.

### Bridge Hooks

- `RuneAndroidRouterBridge` exposes `surfaceReady` and `surfaceDisposed`, unwrapping nested arrays to keep the existing module system (Hermes + modules shim) happy.
- The router module now logs each bridge call for easier debugging and reuses the same unwrapped args logic for all surface callbacks.

### Logging & debugging notes

- Logs starting with `[RuneScreenFragment]` indicate lifecycle events like creation, JS evaluation, and transition starts.
- Enabling the system property `rune.router.perfLogs=true` (or simply attaching a debugger) turns on per-iteration RuneLayoutFlush warnings when an iteration exceeds 12 ms; each warning includes the native/text/layout breakdown so you can pinpoint the bottleneck for that surface.
- Set `globalThis.__ROUTER_PERF_LOGS = true/false` at runtime to toggle JS render instrumentation (see `RouterMinimal` for an example using `withPerfSection`), which prints how long each screen’s render tree takes to build.
- `[nativeRenderer]` logs reveal component registration, first-frame render, and disposal.
- Watch for `surfaceId=10` (or any incrementing id) to ensure the fragment matches the right surface; the numeric id should correlate with the `RuneRootView` root id.
- When the Home UI disappears, check the log for `[Host/removeNode]`, which now should not fire against the root when details dispose.
