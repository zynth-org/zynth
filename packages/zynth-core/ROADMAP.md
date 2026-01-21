# Zynth Core Runtime Roadmap

This roadmap defines a phased plan to build a new minimalist native runtime renderer in `packages/zynth-core`, while preserving the legacy runtimes in `packages/zynth-ios` and `packages/zynth-android` behind an opt-in flag.

The focus is performance, clarity, SolidJS-native reactivity parity, and a runtime that is easy to audit.

---

## Guiding Principles

- Performance-first: every abstraction must earn its cost; all hot paths are visible and measurable.
- Native fidelity: the runtime uses platform-native primitives with no simulated behavior.
- SolidJS mindset: fine-grained updates, no component re-render assumptions, minimal runtime state.
- JSI-first: synchronous operations via Hermes/JSI; avoid serialized JSON bridges where possible.
- Minimal runtime: devtools, diagnostics, fetch, redbox, status bar, dimensions, and environment move to modules.
- HMR-safe registration: modules must survive HMR reloads and runtime restarts without leaks.
- Language pragmatism: use ObjC/ObjC++/C++ for hot paths; Swift is allowed when it does not impact critical paths.

---

## What Goes in Zynth Core

- New native runtime + renderer for iOS and Android
- Minimal runtime contract (`__ui`, `__modules`, and required scheduler hooks)
- Native signals + worklet execution (as an optional installable runtime capability)
- Performance instrumentation and benchmarking harness for renderer functions

Everything else remains in separate packages (legacy or future): devtools, status bar, dimensions, diagnosis, environment, dev client, fetch, redbox.
During the refactor, the new runtime should not reintroduce these APIs.

---

## Runtime Architecture Overview

### Layers

1. **Renderer Contract (JS)**
   - `@zynth/core` keeps the renderer API and batching semantics.
   - New runtime must implement `__ui` host functions.

2. **Runtime Kernel (Native, per platform)**
   - Thin surface manager: node lifecycle, property application, layout scheduling, event dispatch.
   - Owns Yoga nodes and platform views; no shared renderer base across platforms.

3. **Module Registry (Native, per platform)**
   - Standard module registry with explicit install/uninstall lifecycle.
   - Robust to HMR reloads and runtime restarts.

4. **Optional Runtime Features**
   - Native signals + worklets.
   - Animation driver (plugin-style, owned by `@zynth/animate`).

---

## Minimal Runtime Contract (JS ↔ Native)

The runtime must expose the following globals via JSI HostObjects:

- `__ui`:
  - `createNode(type: string): number`
  - `setProp(id: number, name: string, value: unknown): void`
  - `setText(id: number, text: string): void`
  - `insertChild(parentId: number, childId: number, index: number): void`
  - `removeChild(parentId: number, childId: number): void`
  - `setHandler(id: number, name: string, fn: Function): void`
  - `applyBatch(ops: BatchPayload): void`
  - `setSurface(surfaceId: number): void`
  - `flush(): void`

- `__modules`:
  - `call(module: string, method: string, args: unknown[], promiseId?: number): void`
  - `callSync(module: string, method: string, args: unknown[]): unknown`

- Scheduler hooks (if needed by `@zynth/core`):
  - `queueMicrotask`, `requestAnimationFrame`, `cancelAnimationFrame`.

### BatchPayload

- New runtime should avoid JSON for hot paths.
- Use a typed payload (e.g., string table + opcode buffer) to minimize parse overhead.
- The JS side should build this payload directly from the renderer queue.

---

## Module Registration (HMR-safe)

### Requirements

- Modules must be registered once per runtime instance.
- Modules must be detached on runtime shutdown or HMR reload.
- Modules must be idempotent and must not leak handlers or JNI/ObjC references.

### Proposed Pattern

- `RuntimeRegistry` (native) exposes:
  - `install(module: NativeModule): void`
  - `uninstall(moduleName: string): void`
  - `reset(): void` (for HMR/runtime restart)

- Each module implements:
  - `install(runtimeContext)`
  - `uninstall(runtimeContext)`
  - `getConstants()`

- JS runtime boot does:
  - `registry.reset()` on reload
  - `registry.install(defaultModules)`

---

## Build/Prebuild Selection Strategy

- Add a `--new-runtime` flag to `zynth dev` and `zynth prebuild`.
- When enabled, templates should link to `packages/zynth-core/ios` and `packages/zynth-core/android` instead of `packages/zynth-ios` and `packages/zynth-android`.
- This allows side-by-side legacy and new runtime without breaking existing apps.
- Hermes configuration should remain aligned with the proven legacy setup in the Podfile and Android Gradle configuration.

---

## Phased Roadmap

### Phase 0: Grounding and Baselines

**Goals**

- Establish performance baselines and failure modes in the legacy runtime.
- Define the concrete surface for the new runtime contract and op format.

**Deliverables**

- Renderer benchmark harness in `apps/components` (mount, update, scroll).
- Profiling baseline: frame time, batch sizes, layout time, and JNI/ObjC call counts.
- Minimal runtime contract spec (this doc + tests).

**Exit Criteria**

- Baseline benchmarks reproducible.
- Contract locked and reviewed.

**Status**

- Skipped for now to prioritize scaffolding. We can return to benchmarking once the new runtime boots and renders.

---

### Phase 1: Zynth Core Package Scaffolding

**Goals**

- Create `packages/zynth-core` structure to host new iOS and Android runtimes.

**Deliverables**

- New package layout:
  - `packages/zynth-core/ios`
  - `packages/zynth-core/android`
  - `packages/zynth-core/README.md`
- CLI/build flag wired (new-runtime selection).
- Minimal bootstrapping in both platforms (load JS, install `__ui`, render a root view).

**Exit Criteria**

- Can run `yarn zynth dev --prebuild --new-runtime` and see a blank root view.

**Status**

- Completed. Both platforms boot via `--new-runtime` and render a minimal root.

---

### Phase 2: Minimal Renderer Path (iOS)

**Goals**

- Implement only the core rendering pipeline on iOS.
- Remove all non-renderer responsibilities from the runtime.

**Deliverables**

- JSI `__ui` host object implemented in ObjC++.
- `createNode`, `setProp`, `insertChild`, `removeChild`, `setText`, `setHandler` wired to UIKit views + Yoga nodes.
- Frame scheduler (CADisplayLink) with strict 14ms budget policy.
- No devtools, no fetch, no environment, no diagnostics.
- Reuse proven utilities/styles from the legacy runtime when they are performant (e.g., existing `packages/zynth-ios/ios/ZynthKit/src/utils`).

**Exit Criteria**

- `@zynth/components` renders basic UI via the new runtime.
- Benchmarks show parity or improvement vs legacy for mount/update cycles.

**Status**

- Core complete; benchmarks pending. Focus now shifts to Phase 3.
- Completed:
  - JSI `__ui` host object in ObjC++.
  - Typed batch path (`applyBatchTyped`) wired.
  - UIKit + Yoga node creation, layout pass, and text measurement.
  - `createNode`, `setProp`, `setText`, `insertChild`, `removeChild` working for `view` and `text`.
  - Native `queueMicrotask`/`setImmediate` hooks installed; JS shim removed.
- Pending for Phase 2 completion:
  - Benchmark harness integration and perf reporting for iOS.

---

### Phase 3: Minimal Renderer Path (Android)

**Goals**

- Mirror the minimal renderer pipeline on Android.
- Stick to Kotlin + Android View APIs for view management.

**Deliverables**

- JSI `__ui` host object via JNI and Kotlin `UIManager`.
- Yoga layout via current Java Yoga path.
- Choreographer-based frame scheduling and 14ms budget.
- Clean module registry separation.

**Exit Criteria**

- Same basic UI renders on Android using the new runtime.
- Comparable benchmark results to iOS.

**Status**

- Core complete; benchmarks pending.
- Completed:
  - JSI `__ui` host object via JNI + Kotlin.
  - Typed batch path (`applyBatchTyped`) wired.
  - Yoga layout pass and text measurement.
  - `createNode`, `setProp`, `setText`, `insertChild`, `removeChild` working for `view` and `text`.
  - Native `queueMicrotask`/`setImmediate` hooks installed; JS shim removed.
  - Choreographer frame scheduler with 14ms budget hooks.
  - Event dispatch + pointer/touch handling.
  - Surface management behavior (multi-root readiness).
  - Remove bridge-only helpers (e.g., `createNodeWithId`) once JS typed ops are final.
- Pending for Phase 3 completion:
  - Benchmark harness integration and perf reporting for Android.

---

### Phase 4: Compatibility Pass

**Goals**

- Match essential behavior expected by `@zynth/core` and core components.

**Deliverables**

- SolidJS host semantics: text handling, event dispatch, pointer events, layout events.
- Surface management parity (multi-surface or hypervisor-ready, if needed).
- View recycling hooks for `FlatList`.
- Native component registry + module/event compatibility layer so `@zynth/components` can plug in (Text/View descriptors, module constants, event dispatch).

**Exit Criteria**

- Core primitives and demo app work in `apps/components` using new runtime.
- `@zynth/components` native descriptors can be discovered and used by the new runtime (Text/View working end-to-end).

**Known Style Gaps (Yoga/Style Parity)**

Core support now covers the Phase 4 style list with a few remaining caveats:

- `backgroundImage` supports `linear-gradient(...)` strings only (no bitmap/image URLs yet).
- `boxShadow` is first-layer only; Android maps to elevation/text shadow.
- `paragraphSpacing` is a no-op on Android.
- `transform` ignores `skew*` and `perspective` on Android for now.

---

### Phase 5: Native Signals + Worklets

**Goals**

- Integrate native signals and worklet execution as first-class runtime features.

**Deliverables**

- JSI shared value store and worklet registry per runtime.
- UI-thread worklet execution with synchronous shared value reads.
- `@zynth/animate` installs this feature as a plugin.

**Exit Criteria**

- Shared values and worklets match or exceed legacy performance.

---

### Phase 6: Performance Hardening

**Goals**

- Tighten hot paths, reduce allocations, and remove any remaining JSON parsing.

**Deliverables**

- Typed op buffers in `applyBatch`.
- String interning for prop keys and event names.
- Merged property application where possible (e.g., layout and transform batching).
- Clear profile reports for each flush: JS time, native time, layout time.

**Exit Criteria**

- Renderer operations consistently under 14ms on baseline devices.

**Status**

- Not started.
- Performance blockers to track:
  - Replace JS object batches with a typed opcode buffer + string table (no JSON).
  - String interning for prop keys/event names across the JSI boundary.
  - Native microtask scheduler is installed, but needs profiling/latency targets (no JS fallback).
  - Layout batching and minimal allocations per flush (reuse buffers, avoid per-op object creation).

---

### Phase 7: Migration and Legacy Coexistence

**Goals**

- Provide a stable migration path and allow legacy runtime to remain as fallback.

**Deliverables**

- Documentation for `--new-runtime` workflow.
- Compatibility notes for any behavioral changes.
- Module install guidelines for teams.

**Exit Criteria**

- New runtime usable by default in internal apps with opt-out to legacy.

---

## Testing and Benchmarking Strategy

### Renderer Benchmarks

- Mount: render a deep tree (1000 nodes) and measure time to first frame.
- Update: update 1000 props on existing nodes.
- Scroll: `FlatList` scroll with 1000 rows; measure frame stability.

### Metrics to Capture

- JS render time per batch
- Native op execution time per batch
- Layout calculation time
- Frame budget exceed counts
- JNI/ObjC call counts and allocations

### Testing Tools

- In-app performance overlay (optional dev module)
- CLI benchmark runner in `apps/components`

---

## Risks and Mitigations

- **HMR reloads causing leaks**: enforce module lifecycle reset and strict ownership rules.
- **JSI regression on large batches**: typed op buffers and minimal allocation in hot paths.
- **Parity gaps**: publish a minimal compatibility matrix and cover it with tests.

---

## Open Decisions to Resolve

- Whether to move Android Yoga to C++ for more control (likely not needed initially).
- Whether native signals should be required in the base runtime or optional via `@zynth/animate`.
- Whether multi-surface support is required in phase 4 or deferred.

---

## Immediate Next Actions (Suggested)

- Create `packages/zynth-core/README.md` with scope and design summary.
- Add `--new-runtime` flag to `@zynth/cli` and `@zynth/rsbuild-plugin`.
- Define the first benchmark harness in `apps/components`.
