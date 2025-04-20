# Android Surfaces Refactor Plan

## Goal
Give each native surface (Activity root, Fragment host, modal, etc.) its own isolated rendering stack—mirroring React Native Fabric—so push/pop transitions render entirely in native views without mutating the primary root.

## Current Pain Points
- **Single Yoga tree**: All nodes share the Activity root. Fragment nodes collide or overwrite existing nodes, so new screens never appear.
- **Main-thread blocking**: JS evaluation for secondary surfaces can still block UI because we call into Hermes synchronously.
- **No host awareness**: The `__ui` bridge assumes `rootId = 0`, so new surfaces are invisible to the JS host and layout engine.
- **Leaky lifecycle**: Surfaces register nodes but do not tear down Yoga trees, pending queues, or recycler state when fragments unmount.

## Proposed Architecture
1. **Surface Coordinator**
   - `RuneUIManager` becomes a lightweight router that tracks `SurfaceController` instances keyed by surface id.
   - Each controller manages its own `SparseArray<Node>`, pending operations, `RuneLayoutFlush`, `FrameScheduler`, and `YogaLayoutEngine`.
   - Nodes store `surfaceId`; helpers route JS operations to the correct controller using node ids or parent ids.

2. **Per-Surface Controllers**
   - Controller lifecycle:
     1. Create a `RuneRootView` + Yoga root node.
     2. Provide APIs `registerSurface(surfaceId, rootView)`, `unregisterSurface(surfaceId)`, `setActiveSurface(surfaceId)`.
     3. Tear down all nodes + layout state when a surface is removed.
   - Controllers ensure top-level children are inserted under the Yoga root, not the measured `RuneRootView`, eliminating the "measure node" crash.

3. **Bridge & Host Updates**
   - Extend `JSBridge.UIShim` and the C++ bridge with `registerSurface`, `unregisterSurface`, `setSurface`.
   - Update `packages/rune-core/src/host/android.ts` to track multiple root containers (PARENTS/CHILDREN/TYPES maps per surface or keyed by `surfaceId`).
   - Add JS-facing helpers in `@rune/core` (`registerSurface`, `unregisterSurface`) so the runtime can announce new roots before rendering.

4. **Runtime/Fragment Integration**
   - `RuneScreenFragment` flow:
     1. Create `RuneRootView` → call `runtime.registerSurface(rootView)`.
     2. Notify JS host (`__ui.registerSurface(rootId)` via evaluate).
     3. Call `runtime.setActiveSurface(rootId)` **before** invoking `__renderRouterScreen`.
     4. On destroy, call `__disposeRouterScreen`, `runtime.unregisterSurface(rootId)`, and `__ui.unregisterSurface`.
   - `RuneRuntime.evaluateAsync` stays non-blocking to avoid ANRs.

5. **Testing Strategy**
   - Manual flows: base screen only, push/push/push, pop via JS, pop via Android back, rotate device.
   - Logging: per-surface node counts, flush timings, memory usage.
   - Automated: add integration tests in `apps/components` that push/push/pop while asserting logs for register/unregister.

## Work Breakdown
1. **Surface Controller abstractions** (`RuneUIManager`, `RuneLayoutFlush`, `RuneNodeFactory`).
2. **Yoga/host bridging** (C++ bridge, Kotlin bridge, JS host).
3. **Runtime + Fragment wiring** (register/unregister + JS notifications).
4. **Regression tests & metrics**.

## Risks & Mitigations
- **Increased memory usage**: Multiple Yoga trees—mitigate by aggressively unregistering surfaces on pop.
- **Bridge churn**: Any API change requires matching JS updates—keep backward compatibility by defaulting to surface 0 when new APIs are absent.
- **Scheduling bugs**: Each controller has its own flush scheduler—add debug logging and `adb shell dumpsys` hooks to inspect queues per surface.

---
Status: pending implementation. This document tracks the refactor scope so we can prioritize the remaining native work.
