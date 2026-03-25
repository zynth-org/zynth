# Zynth Core Runtime

Zynth Core is the native runtime and renderer for the Zynth framework. It lives in `packages/zynth-core` and focuses only on high-performance native rendering and the minimal host contract used by `@zynth/core`.

---

## Goals

- Native-first, platform-specific renderers with no shared renderer base.
- JSI-first bridge (Hermes V1), avoiding serialized JSON where possible.
- Minimal runtime contract: small, auditable, and easy to benchmark.
- Clear module lifecycle that survives HMR and runtime restarts.
- SolidJS parity: fine-grained updates with zero re-render assumptions.
- Performance-first language choices: use ObjC/ObjC++/C++ for hot paths; Swift is allowed when it does not impact critical paths.

---

## Scope

Zynth Core only contains:

- Native runtime + renderer implementation for iOS and Android.
- The `__ui` host API required by `@zynth/core`.
- The `__modules` host API with a standardized native registry.
- Optional native signals and worklets (installed by `@zynth/animate`).
- Built-in performance instrumentation for renderer benchmarks.

Out of scope (moved to modules): devtools, status bar, dimensions, diagnosis, environment, dev client, fetch, redbox.
During the refactor, the new runtime should not reintroduce these APIs.

---

## Architecture (Refined)

### 1. Renderer Contract (JS)

`@zynth/core` drives the renderer via `__ui` operations. The runtime provides the minimum host contract and a high-performance batch path.

### 2. Native Runtime (Per Platform)

Each platform implements its own runtime and renderer:

- **iOS**: ObjC++ runtime that owns UIKit views and Yoga nodes.
- **Android**: Kotlin runtime that owns Android Views and Yoga nodes.

There is no shared renderer base between platforms. Shared logic is limited to conceptual parity and testing strategy.
Performance-critical paths should prefer ObjC/ObjC++ (iOS) and Kotlin/Java (Android). Swift is permitted when it does not impact hot paths.

### 3. Module Registry

A standardized native module registry provides:

- Deterministic install/uninstall per runtime instance.
- HMR-safe lifecycle reset with no leaks.
- Explicit module constants and sync/async calls.

### 4. Optional Runtime Features

- Native signals and worklets are treated as installable capabilities.
- Animation drivers live in `@zynth/animate` and install their runtime hooks.

---

## Minimal Runtime Contract

Globals installed by the runtime:

- `__ui`: native renderer operations (`createNode`, `setProp`, `setText`, `insertChild`, `removeChild`, `setHandler`, `applyBatch`, `setSurface`, `flush`).
- `__modules`: native module invocation (`call`, `callSync`).
- Scheduler hooks when required by `@zynth/core` (`queueMicrotask`, `requestAnimationFrame`, `cancelAnimationFrame`).

Batching must avoid JSON on hot paths. The preferred payload is a typed op buffer with a string table.

---

## Native Modules

For comprehensive documentation on creating, registering, and using Native Modules in Zynth Core, please refer to the [Native Module Template Documentation](../zynth-cli/src/templates/native-module/README.md).

---

## Build and Selection

Zynth Core is the default runtime:

- `yarn zynth dev ios --prebuild`
- `yarn zynth prebuild ios`

The CLI/template wiring must link to `packages/zynth-core/ios` and `packages/zynth-core/android` when the flag is set, and fall back to legacy runtimes otherwise.
Hermes configuration should remain aligned with the proven legacy setup in the Podfile and Android Gradle configuration.

---

## Performance Strategy

- Strict 14ms frame budget during layout/flush.
- Renderer benchmarks built into `apps/components`.
- Profile per batch: JS time, native time, layout time, and allocations.
- Minimal allocations in hot paths; reuse buffers and intern strings.
- Preserve proven utility/style systems from the legacy runtime when they are performant (e.g., existing `packages/zynth-core/ios/ZynthKit/src/utils` styling and parsers).

---

## Reference

- Roadmap: `packages/zynth-core/ROADMAP.md`
- Architecture baseline: `docs/architecture.md`
- Renderer host API: `packages/zynth-core/src`
