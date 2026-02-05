# Screen Reader Native Introspection (iOS + Android)

## Goal

Add a **read-only native screen snapshot primitive** that reports what is actually rendered right now, including:

- parent/child hierarchy
- dimensions and position (local and absolute)
- layout-affecting styles (padding/margin/position/flex values)
- resolved native state when possible (text, alpha, visibility, input-specific internals)

Primary purpose is **testing and auditing JS intent vs native reality**.  
Secondary purpose is foundation for external tooling (Flipper/Maestro-style integration).

Scope here is **iOS and Android only** (no web).

---

## What Already Exists

## Android (current state)

Native runtime already stores most required data in `ZynthUIManager`:

- tree/state:
  - `nodes`, `nodeStates`, `parents`, `children`, `nodeSurfaces`
- style/layout caches:
  - `yogaStyleCache`, `styleStates`, `textStyleStates`
  - `layoutFrames`, `styleLayoutFrames`
- surface model:
  - `surfaceRoots`, `surfaceYoga`, `activeSurfaceId`

Relevant files:

- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManager.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerSurface.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/core/ZynthUIManagerStyle.kt`
- `packages/zynth-core/android/ZynthKit/src/main/java/com/zynth/kit/layout/ZynthYogaLayout.kt`

Bridge support exists for sync modules (`__modules.callSync`), but return conversion requires care:

- JNI converts Java return values to JS via `toString()` + `JSON.parse` for non-strings.
- Returning plain `Map` is fragile (`{a=b}` is not valid JSON).
- Use `JSONObject`/`JSONArray` (or a JSON string) for reliable sync payloads.

Relevant file:

- `packages/zynth-core/android/ZynthKit/src/main/cpp/zynthkit.cpp`

## iOS (current state)

Native runtime also stores most required data in `ZynthUIManager`:

- tree/state:
  - `_nodes`, `_nodeStates`, `_parents`, `_nodeSurfaces`
  - `ZynthNode.children`
- style/layout caches:
  - `_yogaStyleCache`, `_styleStates`, `_textStyleStates`, `_layoutFrames`
- surface model:
  - `_surfaceRoots`, `_surfaceYoga`, `_activeSurfaceId`

Relevant files:

- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Private.h`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Surface.m`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUIManager+Style.m`
- `packages/zynth-core/ios/ZynthKit/include/ZynthNode.h`

Sync modules are supported on iOS via `__modules.callSync`.

Relevant files:

- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthHermesRuntimeHost.mm`
- `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthModule.swift`

## JS host side (current state)

JS host keeps logical graph maps (`PARENTS`, `CHILDREN`, `TYPES`, `TEXTS`) which are useful for diffing intent vs native.

Relevant files:

- `packages/zynth-core/src/host/android.ts`
- `packages/zynth-core/src/host/ios.ts`

---

## Why This Is Needed (confirmed by current behavior)

`TextInput` is a concrete case where JS style and final native render can diverge:

- Android `text-input` applies padding and gravity via component-specific logic/state, not only Yoga defaults.
- iOS text inputs sync insets from Yoga during `layoutSubviews` and apply control-specific rect overrides.

Relevant files:

- `packages/zynth-components/android/ZynthComponents/src/main/java/com/zynth/components/textinput/TextInputComponentRegistrar.kt`
- `packages/zynth-components/android/ZynthComponents/src/main/java/com/zynth/components/textinput/ZynthTextInputView.kt`
- `packages/zynth-components/ios/src/TextInput/ZynthTextInputView.m`
- `packages/zynth-components/ios/src/TextInput/ZynthSecureTextInputView.m`

This validates the need for an authoritative “what is actually on screen now” snapshot.

---

## Architecture Recommendation

Implement as a **new native module** (not `__ui`) with sync + async entry points.

Recommended module name: `ScreenReader`

Reasons:

- fits existing APIs/module architecture (`Dimensions`, `SafeArea`, etc.)
- keeps `__ui` focused on mutations
- easier to gate in debug/test only
- easier to version payloads independently

---

## Proposed JS API (V1)

```ts
type ScreenReaderOptions = {
  surfaceId?: number;
  rootNodeId?: number;
  maxDepth?: number;
  includeYogaStyles?: boolean;     // from yogaStyleCache
  includeResolvedStyles?: boolean; // from style states / view layer
  includeText?: boolean;
  includeAttachments?: boolean;    // debug only, filtered
  includeGlobalFrame?: boolean;    // default true
};

type ScreenReader = {
  readSync(options?: ScreenReaderOptions): NativeScreenSnapshot;
  read(options?: ScreenReaderOptions): Promise<NativeScreenSnapshot>;
};
```

Module methods:

- sync: `callSync("ScreenReader", "read", options)`
- async: `call("ScreenReader", "read", options)` (optional for very large trees)

---

## Snapshot Schema (V1)

```ts
type NativeScreenSnapshot = {
  version: 1;
  platform: "android" | "ios";
  timestampMs: number;
  density: number; // Android density / iOS scale
  surfaces: SurfaceSnapshot[];
  warnings?: string[];
};

type SurfaceSnapshot = {
  surfaceId: number;
  rootViewFrameGlobal: Rect;
  rootChildren: number[]; // logical children mounted under parent=0 for that surface
  nodes: Record<number, NodeSnapshot>;
};

type NodeSnapshot = {
  id: number;
  type: string;
  surfaceId: number;
  parentId: number | null;
  childIds: number[];
  viewClass: string;
  frameLocal: Rect;   // x/y relative to parent
  frameGlobal: Rect;  // x/y in window coords
  visibility: "visible" | "invisible" | "gone/hidden";
  alpha: number;
  zIndex?: number;
  yogaStyles?: Record<string, unknown>;      // cached style inputs
  resolvedStyles?: Record<string, unknown>;  // style state + native view values
  text?: string;
  componentState?: Record<string, unknown>;  // inspector extension point
};

type Rect = { x: number; y: number; width: number; height: number };
```

Important normalization:

- iOS root surface id is `0`; Android root surface id is `rootView.rootId` (>= `1 << 20`).
- Payload should preserve real ids but also expose `rootChildren` per surface so consumers do not depend on internal root-id semantics.

---

## Implementation Plan (phased)

## Phase 1: Minimal Read-Only Tree + Frames

Output:

- node hierarchy (id/type/parent/children/surface)
- local + global frames
- visibility + alpha + class name

Data source:

- Android: `nodes`, `nodeStates`, `parents`, `children`, `nodeSurfaces`, `View` frame APIs
- iOS: `_nodes`, `_nodeStates`, `_parents`, `ZynthNode.children`, `_nodeSurfaces`, `UIView` frame APIs

Threading:

- always collect on UI/main thread
- if call comes from JS thread, hop to main thread synchronously for snapshot capture

## Phase 2: Style Intent + Resolved Core Styles

Add:

- `yogaStyles` from `yogaStyleCache`
- selected resolved style fields from `styleStates` / `textStyleStates`
- common resolved view fields (`alpha`, `clipsToBounds`, `elevation/shadow`, etc.)

Note:

- start with shared cross-platform subset
- do not try to dump every possible field in v1

## Phase 3: Component Inspector Extension

Add optional per-component exporter for internals that generic core cannot infer.

Examples:

- TextInput: effective content insets, gravity/alignment, placeholder state, secure/multiline flags
- Image: loading state, resize mode

Recommended extension points:

- Android: extend `ZynthComponentDescriptor` with optional inspector callback
- iOS: extend `ZynthComponentDescriptor` with optional inspection block

## Phase 4: JS Diff + Tooling Integration

Add JS utility to diff:

- host logical map (`PARENTS`/`CHILDREN`/`TYPES`) vs native snapshot
- expected style subset vs resolved native subset

Use this as the base for:

- test assertions
- debug overlays
- external transport (Flipper plugin / Maestro adapter)

---

## Platform-Specific Risks

## Android

- `callSync` return marshaling is strict; prefer `JSONObject`/`JSONArray`.
- very large snapshots can be expensive; add filters (`surfaceId`, `rootNodeId`, `maxDepth`).
- capture must run on main thread for consistent `View` state.

## iOS

- for root-level children on surface `0`, rely on parent mapping + node lists consistently.
- some resolved values are in `CALayer`/state objects and need explicit serializer code.
- capture must run on main thread for consistent UIKit state.

---

## Testing Strategy

## Unit/serialization

- deterministic serializer tests for snapshot schema
- ensure numbers/nullable fields serialize consistently across platforms

## Integration

- render known tree, capture snapshot, assert:
  - hierarchy
  - frames
  - key style fields
- include targeted TextInput regression case (`paddingVertical` + `paddingHorizontal`)

## Stress/perf

- synthetic trees (100 / 1k / 5k nodes) with timing budget checks
- verify no dropped frames when called occasionally in debug mode

---

## Security / Product Gating

Recommended for v1:

- enable only in `DEBUG`/dev by default
- explicit runtime flag for release builds if needed for E2E automation
- redact sensitive text fields optionally (`includeText: false` by default in prod-like mode)

---

## Future: Write Actions (after read-only stabilizes)

A write channel already exists via `__zynth_ui_commands` (currently used by `scrollTo`).

Potential future commands:

- `tap(nodeId)`
- `longPress(nodeId, durationMs)`
- `typeText(nodeId, value)`
- `swipe(...)`

But these should come **after** snapshot reliability is strong.

---

## Recommended First Build Scope (concrete)

1. New `ScreenReader` module on both platforms with `readSync/read`.
2. Snapshot fields: hierarchy + frames + visibility + alpha + yoga style cache.
3. Filters: `surfaceId`, `rootNodeId`, `maxDepth`.
4. JS helper in test tooling package to call module and assert tree.
5. One end-to-end regression test for TextInput padding mismatch scenario.

