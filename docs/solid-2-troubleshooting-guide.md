# SolidJS 2.0 Troubleshooting Guide

## Overview

This document is a comprehensive reference for the SolidJS 2.0 issues encountered during the Zynth framework migration. It covers breaking changes from SolidJS 1.x, the warnings and errors produced by `@solidjs/signals`, and the architectural patterns required to fix them.

This guide is written for **Zynth framework contributors** working on `packages/zynth-core`, `packages/zynth-components`, and `packages/zynth-apis`. It complements the existing [Solid 2 Components Migration Guide](./solid-2-components-migration-guide.md) by focusing on **runtime behavior, reactivity semantics, and diagnostic patterns** rather than component structure.

---

## Table of Contents

1. [SolidJS 2.0 Breaking Changes from 1.x](#1-solidjs-20-breaking-changes-from-1x)
2. [The `ownedWrite` Requirement](#2-the-ownedwrite-requirement)
3. [Error & Warning Reference](#3-error--warning-reference)
4. [Architectural Patterns](#4-architectural-patterns)
5. [Diagnosing New Issues](#5-diagnosing-new-issues)

---

## 1. SolidJS 2.0 Breaking Changes from 1.x

### 1.1. Mandatory 2-Argument `createEffect`

**SolidJS 1.x** allowed a single-argument `createEffect`:

```ts
// SolidJS 1.x — works
createEffect(() => {
  const value = someSignal();
  doSomething(value);
});
```

**SolidJS 2.0** deprecates the 1-argument form and throws `[MISSING_EFFECT_FN]` at runtime:

```ts
// SolidJS 2.0 — CRASHES
createEffect(() => {
  const value = someSignal();
  doSomething(value);
});
```

**Fix**: Always use the 2-argument signature. The first function (compute) runs in a tracking scope and returns a snapshot. The second function (effect) receives the snapshot and runs imperatively:

```ts
createEffect(
  () => ({ value: someSignal() }),   // compute — tracks someSignal()
  ({ value }) => doSomething(value)  // effect — uses the snapshot, no tracking
);
```

**Why this matters in Zynth**: Every `createEffect` call in `zynth-components` and `zynth-apis` must use the 2-arg form. There are 38 active calls across the primitives; all have been migrated.

---

### 1.2. `untrack()` Only Clears `tracking`, Not `context`

**SolidJS 1.x** `untrack()` prevented tracking but preserved the owner scope.

**SolidJS 2.0** `untrack()` sets `tracking = false` and optionally `strictRead = false`, but does **NOT** clear the `Owner` or `Context`:

```ts
// From @solidjs/signals/dist/dev.js:36537
function untrack(fn, strictReadLabel) {
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  tracking = false;
  strictRead = strictReadLabel || false;
  try {
    return fn();
  } finally {
    tracking = prevTracking;
    strictRead = prevStrictRead;
  }
}
```

**Implication**: Signal writes inside `untrack()` are still checked against the current owner scope. If the owner has `_config & CONFIG_OWNED_WRITE` unset, writes will throw `REACTIVE_WRITE_IN_OWNED_SCOPE`. To truly escape the owned scope, use `runWithOwner(null, fn)`.

---

### 1.3. `runWithOwner(null, fn)` Clears Both `Owner` and `Context`

`runWithOwner(null, fn)` is the only way to fully escape the owned scope. It sets both `Owner = null` and `Context = null` during the callback, which:

1. **Allows signal writes** — `Context = null` means the `REACTIVE_WRITE_IN_OWNED_SCOPE` check passes (the check requires `Context` to be non-null).
2. **Disables tracking** — `tracking` is not explicitly changed, but with no owner, signal reads are untracked.
3. **Suppresses `STRICT_READ_UNTRACKED` warnings** — Since `strictRead` is not modified by `runWithOwner`, it preserves whatever value was set before the call.

```ts
// From @solidjs/signals/dist/dev.js:2924
function runWithOwner(fn, owner) {
    var prevOwner = Owner;
    var prevContext = Context;
    Owner = owner;
    Context = owner ? owner._context : null;
    try {
        return fn();
    } finally {
        Owner = prevOwner;
        Context = prevContext;
    }
}
```

**Usage in Zynth**: `runWithOwner(null, fn)` is used in two critical scenarios:

1. **The `use()` function in `renderer.ts`** — Wraps ref callbacks to prevent `REACTIVE_WRITE_IN_OWNED_SCOPE` from any signal write inside the callback.
2. **Async callbacks inside effects** — `setTimeout`, `requestAnimationFrame`, and event listener callbacks that write signals must run outside the owned scope.

---

### 1.4. `onCleanup` Forbidden Inside `onSettled` / `createTrackedEffect`

`onSettled` is implemented as `createTrackedEffect`. Inside a `createTrackedEffect` callback, calling `onCleanup` throws an error because the effect's cleanup mechanism is managed by the framework.

**Fix**: Return a cleanup function instead:

```ts
// ❌ BAD — throws inside onSettled
onSettled(() => {
  const subscription = emitter.addListener("event", handler);
  onCleanup(() => subscription.remove());  // ERROR
});

// ✅ GOOD — return cleanup function
onSettled(() => {
  const subscription = emitter.addListener("event", handler);
  return () => subscription.remove();  // Framework calls this on cleanup
});
```

**Note**: `onCleanup` inside a 2-arg `createEffect`'s effect function IS allowed — it registers under the effect's owner.

---

### 1.5. `JSX.Element` — Namespace Removed

`JSX.Element` as a namespace type no longer exists in SolidJS 2.0. The `Element` type is still exported directly from `solid-js`:

```ts
// solid-js/types/types.d.ts
export type Element = RenderedElement | ArrayElement | (string & {}) | number | boolean | null | undefined;
```

If you were importing `JSX.Element`, switch to importing `Element` directly. The `as SolidElement` rename is optional — it's the same export, just renamed to avoid conflicts with the DOM's `Element` type:

```ts
// ❌ BAD — JSX namespace doesn't exist in Solid 2.0
import type { JSX } from "solid-js";
const x: JSX.Element = <div />;

// ✅ GOOD — Element is exported directly
import type { Element } from "solid-js";

// ✅ ALSO GOOD — renamed to avoid DOM Element conflict
import type { Element as SolidElement } from "solid-js";
```

---

## 2. The `ownedWrite` Requirement

### What It Is

SolidJS 2.0 added a restriction: writing to a signal inside an owned scope (a component, a computation, or a `createEffect` effect callback) is forbidden unless the signal was created with `{ ownedWrite: true }`.

The check happens in `setSignal` (`@solidjs/signals/dist/dev.js:36759`):

```ts
if (!(el._config & CONFIG_OWNED_WRITE) && context && el._firewall !== context) {
  // throws REACTIVE_WRITE_IN_OWNED_SCOPE
}
```

**This is a framework-level concern, not an end-user concern.** SolidJS 2.0 added this restriction to prevent accidental signal writes inside tracking scopes, which can cause subtle reactivity bugs. In normal SolidJS usage (effects, computations), users write signals freely — the framework manages the scope. But in Zynth's custom renderer architecture (`@solidjs/universal`), ref callbacks run inside the component's owned scope (the JSX compiler calls `use()` from within the component body), so signals written there need `{ ownedWrite: true }`.

### When You Need It (Framework Internals Only)

In Zynth, `refProp` callbacks are invoked inside the component's owned scope. Any signal written inside a `refProp` callback must use `{ ownedWrite: true }`:

```ts
// In a Zynth primitive component
const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

const refProp = (node: HostNode | null) => {
  if (node) {
    // setHostNode(node) runs inside the component's owned scope
    // Without { ownedWrite: true }, this throws REACTIVE_WRITE_IN_OWNED_SCOPE
    setHostNode(node);
  }
};
```

**End users building components never need to use `{ ownedWrite: true }`** — they use the standard `refProp` + `createEffect` pattern and the framework handles the rest.

### Where It's Applied in Zynth

All ref-written signals across the primitives have been updated:

| File | Signal | Line |
|------|--------|------|
| `View.tsx` | `hostNode` | 136 |
| `Text.tsx` | `hostNode` | — |
| `Button.tsx` | `hostNode` | 296 |
| `ScrollView.tsx` | `hostNode` | — |
| `Modal.tsx` | `hostNode` | — |
| `Pressable.tsx` | `hostNode` | — |
| `GestureDetector.tsx` | `hostNode` | — |
| `FlatList.tsx` | `scrollRef` | 243 |
| `VirtualList.tsx` | `scrollNode` | 352 |
| `WebView.tsx` | `hostNode` | 39 |
| `BottomSheet.tsx` | `hostNode` | — |
| `Image.tsx` | `hostNode` | — |
| `Input.tsx` | `hostNode` | — |
| `Select.tsx` | `hostNode` | — |
| `Buttons.tsx` (app) | `buttonRef` | 52 |

### How to Diagnose

If you see `REACTIVE_WRITE_IN_OWNED_SCOPE` or `REACTIVITY_HALTED`, check whether the signal being written was created with `{ ownedWrite: true }`. If not, add it.

---

## 3. Error & Warning Reference

### 3.1. `REACTIVE_WRITE_IN_OWNED_SCOPE`

**Severity**: Warning (dev mode only)

**Cause**: Writing to a signal inside an owned scope (component, computation, effect callback) without the signal having `{ ownedWrite: true }`.

**Symptom**: Logged as a warning, and if unhandled, escalates to `REACTIVITY_HALTED`.

**Common locations**:
- `refProp` callbacks that call `setHostNode(node)`
- Async callbacks (`setTimeout`, `requestAnimationFrame`) that write signals
- Event listener callbacks inside effects

**Fix**: Add `{ ownedWrite: true }` to the signal definition:
```ts
const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });
```

If the write happens inside an async callback, wrap it in `runWithOwner(null, ...)`:
```ts
runWithOwner(null, () => setMetrics(nextMetrics));
```

---

### 3.2. `REACTIVITY_HALTED`

**Severity**: Error (halts reactivity system)

**Cause**: A `REACTIVE_WRITE_IN_OWNED_SCOPE` error was not caught, causing the reactivity system to halt. The error object `{}` that appears in the console is the `cause` of the halt.

**Symptom**: `console.error({}, ...)` — the `{}` is a serialized Error object that doesn't display in Zynth's console.

**Fix**: Find the underlying `REACTIVE_WRITE_IN_OWNED_SCOPE` and fix it (see 3.1). The halt is a cascade, not the root cause.

**Diagnostic**: Temporarily add a `console.error` wrapper to `renderer.ts` to capture the full error:

```ts
if (typeof console !== "undefined" && console.error) {
  const _origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const formatted = args.map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack}`;
      }
      if (arg !== null && typeof arg === "object") {
        try {
          return JSON.stringify(arg, Object.getOwnPropertyNames(arg), 2);
        } catch {
          return String(arg);
        }
      }
      return arg;
    });
    _origError(...formatted);
  };
}
```

---

### 3.3. `STRICT_READ_UNTRACKED`

**Severity**: Warning (dev mode only)

**Cause**: Reading a signal inside a context where `strictRead` is set. This happens in two scenarios:

1. **Inside an effect callback** (2nd arg of `createEffect`) — SolidJS 2.0 sets `strictRead = "an effect callback"` before running the effect function. Any signal read inside the effect function triggers this warning.
2. **Inside a component body** — `devComponent` sets `strictRead` to the component name.

**Symptom**: `WARN [STRICT_READ_UNTRACKED] Reactive value read directly in <ComponentName> will not update.`

**Why it warns**: Signal reads inside the effect function are NOT tracked. The effect function only re-runs when the compute function returns a new value. Reading a signal directly in the effect function means that signal's changes won't trigger a re-run (unless the compute function also tracks it).

**Fix pattern 1 — Move reads to the compute function** (preferred for simple cases):

```ts
// ❌ BAD — hostNode() read in effect function triggers warning
createEffect(
  () => local.visible !== false,
  (shouldShow) => {
    const nodeId = hostNode()?.id;  // WARNING
    // ...
  }
);

// ✅ GOOD — hostNode() moved to compute function
createEffect(
  () => ({ show: local.visible !== false, nodeId: hostNode()?.id }),
  ({ show, nodeId }) => {
    // uses param, no warning
  }
);
```

**Fix pattern 2 — Wrap helper calls in `untrack()`** (for complex helpers that read many signals):

```ts
// ❌ BAD — applyButtonProps reads ~20 signals directly
createEffect(
  () => ({ node: hostNode(), variant: resolvedVariant() }),
  ({ node }) => {
    applyButtonProps(node);  // WARNING: reads resolvedVariant(), resolvedTone(), etc.
  }
);

// ✅ GOOD — compute already tracks driving signals, untrack suppresses warnings
createEffect(
  () => ({ node: hostNode(), variant: resolvedVariant() }),
  ({ node }) => {
    untrack(() => applyButtonProps(node));  // No warning
  }
);
```

**When pattern 2 is acceptable**: The compute function already tracks the signals that drive the effect's re-runs. The helper function reads the same signals (plus additional ones), but since the compute function already triggers re-runs, the untracked reads are just imperative applications. The helper won't re-run when the untracked signals change, but that's the intended behavior.

---

### 3.4. `[MISSING_EFFECT_FN]`

**Severity**: Error (crash)

**Cause**: Calling `createEffect` with only 1 argument (the old SolidJS 1.x pattern).

**Fix**: Convert to 2-arg form:

```ts
// ❌ BAD
createEffect(() => doWork(signal()));

// ✅ GOOD
createEffect(
  () => ({ val: signal() }),
  ({ val }) => doWork(val)
);
```

---

## 4. Architectural Patterns

### 4.1. The `use()` Function in `renderer.ts`

The `use()` function is called by the SolidJS 2.0 JSX compiler for intrinsic elements (`<view>`, `<text>`, etc.). It applies ref callbacks and attribute effects to host nodes.

```ts
export const use = (fn: any, element: any, arg?: any) => {
  if (typeof fn === "function") {
    runWithOwner(null, () => untrack(() => fn(element, arg)));
  } else if (fn && typeof fn === "object" && "current" in fn) {
    fn.current = element;
  }
};
```

**Why `runWithOwner(null, ...)`**: Ref callbacks write signals (like `setHostNode(node)`). Without clearing the owner scope, these writes trigger `REACTIVE_WRITE_IN_OWNED_SCOPE`.

**Why `untrack(...)`**: The `runWithOwner(null, ...)` clears `Owner` and `Context` but does NOT clear `strictRead`. If `strictRead` was set by `devComponent` (the caller), signal reads inside the ref callback would trigger `STRICT_READ_UNTRACKED` warnings. `untrack()` clears `strictRead` for the duration of the callback.

**Key insight**: `runWithOwner(null, ...)` only restores `Owner` and `Context` in its `finally` block — it does NOT restore `strictRead` or `tracking`. This is why `untrack()` is needed as a nested wrapper.

---

### 4.2. The `callWithOwner` Pattern for Event Handlers

Event handlers (press, focus, blur, etc.) are imperative code that should NOT run inside owned scopes. The `callWithOwner` function invokes callbacks directly without wrapping them in `runWithOwner(owner, ...)`:

```ts
// ✅ GOOD — direct call, no owner scope
const handlePress = () => {
  if (resolvedDisabled()) return;
  const result = local.onPress?.();
  flush();
};
```

**Why NOT `runWithOwner(owner, ...)`**: Restoring the owner context makes signal writes forbidden again (the `REACTIVE_WRITE_IN_OWNED_SCOPE` check fires). Event handlers are imperative — they should write signals freely.

**Where `callWithOwner` IS used**: For user-provided callbacks like `local.onPress`, `local.onFocus`, etc. These are called with `callWithOwner(local.onPress, payload)` which invokes the callback directly without restoring the owner scope.

---

### 4.3. The `refProp` + `createEffect` Pattern

Every Zynth primitive follows this pattern:

```ts
const MyComponent = (props) => {
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  // 1. Apply initial properties SYNCHRONOUSLY in refProp
  const refProp = (node: HostNode | null) => {
    if (node) {
      const st = resolvedStyle();
      if (st != null) setProperty(node, "style", st);
      // ... apply all initial props
    }
    setHostNode(node);
    (props.ref ?? noopRef)(node);
  };

  // 2. Reactive updates via 2-arg createEffect
  createEffect(
    () => ({
      node: hostNode(),
      st: resolvedStyle(),
      // ... all driving signals
    }),
    ({ node, st }) => {
      if (!node) return;
      if (st != null) setProperty(node, "style", st);
    }
  );

  // 3. Keep intrinsic tag clean
  return <view ref={refProp}>{props.children}</view>;
};
```

**Why this works**: `refProp` runs synchronously when the host node is created, applying all initial properties immediately. The `createEffect` handles subsequent reactive updates. The compute function tracks all driving signals, and the effect function applies them imperatively.

---

### 4.4. Helper Functions Inside Effect Callbacks

When a helper function reads signals inside an effect callback, it triggers `STRICT_READ_UNTRACKED`. There are two approaches:

**Approach A — Pass all values through the compute function** (cleanest):

```ts
const applyProps = (node: HostNode, opts: { variant: string; tone: string }) => {
  setProperty(node, "variant", opts.variant);
  setProperty(node, "tone", opts.tone);
};

createEffect(
  () => ({
    node: hostNode(),
    variant: resolvedVariant(),
    tone: resolvedTone(),
  }),
  ({ node, variant, tone }) => {
    if (node) applyProps(node, { variant, tone });
  }
);
```

**Approach B — Wrap in `untrack()`** (for helpers with many signals):

```ts
createEffect(
  () => ({
    node: hostNode(),
    variant: resolvedVariant(),
    tone: resolvedTone(),
  }),
  ({ node }) => {
    if (node) untrack(() => applyButtonProps(node));  // reads ~20 signals
  }
);
```

**When to use which**: Use Approach A when the helper reads fewer than ~5 signals. Use Approach B when the helper reads many signals and the compute function already tracks the driving signals. The compute function's return value drives re-runs; the helper just applies the values.

---

## 5. Diagnosing New Issues

### 5.1. The `console.warn` Interceptor for Tracing

The `STRICT_READ_UNTRACKED` warning does not include a stack trace by default, making it impossible to identify which component is causing it. Add a temporary `console.warn` interceptor to `renderer.ts`:

```ts
if (typeof console !== "undefined" && console.warn) {
  const _origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === "string" ? args[0] : "";
    if (msg.includes("STRICT_READ_UNTRACKED")) {
      const trace = new Error().stack
        ?.split("\n")
        .slice(2, 10)
        .map((l) => l.trim())
        .join("\n    ");
      _origWarn(...args, "\n    [TRACE]", trace ?? "(no stack)");
      return;
    }
    _origWarn(...args);
  };
}
```

This will produce output like:

```
WARN [STRICT_READ_UNTRACKED] Reactive value read directly in an effect callback...
    [TRACE]
        at applyScrollViewProps (ScrollView.tsx:552)
        at anonymous (ScrollView.tsx:617)
        at runEffect (@solidjs/signals:37780)
```

**Remove this interceptor after debugging** — it adds overhead to every `console.warn` call.

### 5.2. The `console.error` Interceptor for `REACTIVITY_HALTED`

The `REACTIVITY_HALTED` error prints `{}` in Zynth's console because Error objects don't serialize. Add a temporary interceptor:

```ts
if (typeof console !== "undefined" && console.error) {
  const _origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const formatted = args.map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack}`;
      }
      if (arg !== null && typeof arg === "object") {
        try {
          return JSON.stringify(arg, Object.getOwnPropertyNames(arg), 2);
        } catch {
          return String(arg);
        }
      }
      return arg;
    });
    _origError(...formatted);
  };
}
```

**Remove this interceptor after debugging** — it changes the behavior of all `console.error` calls.

### 5.3. Quick Diagnostic Checklist

When a new SolidJS 2.0 issue appears:

1. **Check the error/warning message** — Is it `REACTIVE_WRITE_IN_OWNED_SCOPE`, `STRICT_READ_UNTRACKED`, or `REACTIVITY_HALTED`?
2. **For `REACTIVE_WRITE_IN_OWNED_SCOPE`**: Find the signal being written. Was it created with `{ ownedWrite: true }`? If not, add it. If it's in an async callback, wrap in `runWithOwner(null, ...)`.
3. **For `STRICT_READ_UNTRACKED`**: Add the `console.warn` interceptor to get a stack trace. Identify which effect callback reads the signal. Move the read to the compute function, or wrap the helper call in `untrack()`.
4. **For `REACTIVITY_HALTED`**: Add the `console.error` interceptor. Find the underlying `REACTIVE_WRITE_IN_OWNED_SCOPE`.
5. **For `[MISSING_EFFECT_FN]`**: Convert the 1-arg `createEffect` to 2-arg form.

---

## Appendix: Key Source Locations in `@solidjs/signals`

These are the relevant lines in `node_modules/@solidjs/signals/dist/dev.js` for understanding the runtime behavior:

| Line | What |
|------|------|
| 183-192 | `warnStrictReadUntracked` — emits `STRICT_READ_UNTRACKED` |
| 2535-2563 | `signal()` factory — applies `ownedWrite` to `_config` |
| 2610-2622 | `untrack()` — sets `tracking = false`, `strictRead = false` |
| 2781-2786 | `read()` — checks `strictRead` and emits warning |
| 2832-2849 | `setSignal()` — owned-scope write check |
| 2924-2948 | `runWithOwner()` — saves/restores `Owner` and `Context` only |
| 36537-36550 | `untrack()` implementation detail |
| 36759-36776 | `setSignal()` with `CONFIG_OWNED_WRITE` check |
| 3870 | `setStrictRead("an effect callback")` — set before effect callbacks |
| 562-580 | `haltReactivity()` — logs `REACTIVITY_HALTED` |
| 7306 | `setStrictRead(options.name)` — set in `devComponent` for component bodies |
