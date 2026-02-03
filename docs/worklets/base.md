# Worklets

This document describes the current worklet and native signal surface in Zynth,
including the UI runtime bridge used by primitives like `ScrollView`.

## Concepts

- Worklet: A function compiled with the `"worklet"` directive. It can run on the
  UI runtime and access native signals without JS thread latency.
- Native signals: Shared values stored in native memory and read synchronously
  by the UI runtime. Created via `createSharedSignal(...)`.
- UI runtime: A Hermes runtime that executes registered worklets on the UI
  thread. It exposes a limited, explicit API surface.

## Core API

These helpers live in `@zynth/core` and are JS-only.

```ts
import {
  createSignalRuntime,
  getRuntimeKind,
  isWorklet,
  scheduleOnUI,
  scheduleOnUIAfter,
  shareSignalRef,
  isSignalRef,
  getSignalRefId,
} from "@zynth/core";
```

### createSignalRuntime(kind)

Creates a lightweight runtime handle.

```ts
const ui = createSignalRuntime("ui");
const js = createSignalRuntime("js");
```

### getRuntimeKind(runtime)

Returns `"ui"` or `"js"` from a runtime handle.

### isWorklet(fn)

Returns `true` if a function has been marked by the worklet compiler plugin.

### scheduleOnUI(fn)

Registers and schedules a worklet to run on the UI runtime immediately. If the
UI worklet bridge is missing, it falls back to running on the JS thread.

### scheduleOnUIAfter(fn, delayMs)

Schedules a worklet on the UI runtime after a delay (ms). Falls back to JS
timers/microtasks when the UI bridge is unavailable.

### shareSignalRef(value, kind?)

Produces a shareable token that can be captured into a worklet closure.
Currently supported values:

- `HostNode` instances (uses `node.id`)
- numeric ids

The optional `kind` is `"node"` by default.

### isSignalRef(value)

Type guard for `SignalRef` tokens.

### getSignalRefId(value)

Returns the numeric id from a `SignalRef`, or `null` if the value is not a ref.

## UI Runtime Commands

The UI runtime exposes a minimal command surface through a global object:

```ts
globalThis.__zynth_ui_commands?.scrollTo(nodeId, x, y, animated);
```

This is intentionally small and explicit. It allows a worklet to trigger native
commands without exposing the full `__ui` bridge on the UI runtime.

### scrollTo

```ts
__zynth_ui_commands.scrollTo(nodeId: number, x?: number, y?: number, animated?: boolean)
```

Internally, this forwards to `__scrollCommand` on the native `ScrollView`.

## ScrollView UI Path

`ScrollView` exposes two command paths:

- `scrollTo`: JS thread command (existing behavior).
- `ui.scrollTo`: UI runtime command (new).

Example usage:

```ts
const controller = createScrollController();

controller.ui.scrollTo({
  y: 200,
  animated: true,
  delayMs: 500,
});
```

`ui.scrollTo`:

- Captures the `HostNode` as a `SignalRef`.
- Schedules a worklet with `scheduleOnUIAfter`.
- Calls `__zynth_ui_commands.scrollTo(...)` on the UI runtime.

## Fallback Behavior

If the UI runtime bridge is unavailable:

- `scheduleOnUI` and `scheduleOnUIAfter` fall back to JS execution.
- `ui.scrollTo` falls back to the JS `__ui.setProp` path.

## Debugging

Worklet registration emits devtools events via `emitDevtoolsEvent` when the
bridge is missing or when code metadata is not available.

## File Map

- Core helpers: `packages/zynth-core/src/nativeRuntime.ts`
- Signal refs: `packages/zynth-core/src/signalRef.ts`
- Worklet registration: `packages/zynth-core/src/worklet.ts`
- UI commands registry (iOS): `packages/zynth-core/ios/ZynthKit/src/runtime/ZynthUICommandsRegistry.mm`
- UI commands registry (Android): `packages/zynth-core/android/ZynthKit/src/main/cpp/UICommandsRegistry.cpp`
- ScrollView UI commands (iOS): `packages/zynth-components/ios/src/ScrollView/ScrollViewUICommands.mm`
- ScrollView UI commands (Android): `packages/zynth-core/android/ZynthKit/src/main/cpp/ScrollViewUICommands.cpp`
- ScrollView controller: `packages/zynth-components/src/primitives/ScrollView.tsx`
