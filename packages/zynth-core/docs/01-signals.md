# Shared Signals

`SharedSignal` is the technological spearhead of the Zynth Framework. It is a high-performance reactive primitive that bridges the JavaScript thread and the Native JSI (JavaScript Interface) thread, serving as the backbone for all motion and gesture interactions.

## Overview

Traditional reactivity in mobile frameworks often suffers from "bridge lag" when trying to drive UI changes from JavaScript at 60 or 120 FPS. Zynth solves this by introducing **Shared Signals**.

A Shared Signal behaves like a standard SolidJS signal in JavaScript, but its value is also mirrored in a high-speed native memory slot accessible directly by the C++/Native rendering engine.

### Key Benefits

- **Zero-Latency Updates**: Native components can read signal values directly from JSI without crossing the asynchronous bridge.
- **Thread Safety**: Values are synchronized across threads with frame-perfect precision.
- **SolidJS Integration**: Fully compatible with SolidJS's fine-grained reactivity system.
- **Unified Backbone**: Powers `createSharedValue` (Animations) and `GestureDetector` (Interactions) through a single primitive.

## API

### `createSharedSignal<T>(initialValue: T)`

Creates a reactive signal that is synchronized with the native runtime.

```tsx
import { createSharedSignal } from "@zynth/core";

const [offset, setOffset] = createSharedSignal(0);

// In JS, it works like a normal signal
console.log(offset()); // 0

// Updating it automatically triggers native synchronization
setOffset(100);
```

### Technical Details

When a `SharedSignal` is created with a `number` value:
1. A unique **Native ID** is allocated via JSI.
2. The JS setter is patched to call `setNativeSharedSignal` whenever the value changes.
3. The JS accessor is patched to support **Capture Contexts**, allowing the Zynth renderer to "sniff" which shared signals are being used in a style calculation to establish native-to-native bindings.

## Capture Contexts

Capture contexts allow the framework to automatically detect dependencies on shared signals without explicit subscription.

```ts
import { captureSharedSignals } from "@zynth/core";

const { result, tokens } = captureSharedSignals(() => {
  return { opacity: opacitySignal() };
});

// tokens now contains the native IDs required to link this 
// style property natively to the signal.
```

## Performance Note

Shared Signals are most effective when used for properties that update frequently, such as transforms, opacity, and scroll offsets. For static or infrequently changed values, standard SolidJS signals are preferred to save native memory slots.

---

> [!TIP]
> For most animation use cases, you should use the higher-level `createSharedValue` API from `@zynth/core/motion`, which provides additional animation drivers like `withSpring` and `withTiming`.
