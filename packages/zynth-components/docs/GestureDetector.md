# GestureDetector

`GestureDetector` is a specialized component for coordinating complex, multi-touch gestures. It acts as a dedicated wrapper that ensures perfect synchronization between native recognizers and JSI-driven styles.

## Basic Usage

Pass one or more gesture definitions created with factories from `@zynthjs/core/gesture`.

```tsx
import { GestureDetector } from "@zynthjs/components";
import { createPanGesture } from "@zynthjs/core/gesture";

function Canvas() {
  const pan = createPanGesture({
    onUpdate: (e) => { /* handle pan */ }
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }} />
    </GestureDetector>
  );
}
```

## Native Signal Mapping

For maximum performance (0ms latency), `GestureDetector` can map panning directly to native `SharedSignals` on the UI thread.

```tsx
import { createSharedValue } from "@zynthjs/core/motion";

const offsetX = createSharedValue(0);

<GestureDetector 
  gesture={pan}
  panSharedSignalX={offsetX}
>
  <View style={createAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }]
  }))} />
</GestureDetector>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `gesture` | `GestureDefinition \| GestureDefinition[]` | The gesture(s) to recognize. |
| `panSharedSignalX`| `SharedSignal \| SharedValue` | Direct native binding for X panning. |
| `panSharedSignalY`| `SharedSignal \| SharedValue` | Direct native binding for Y panning. |
| `pointerEvents`| `auto` \| `none` \| `box-none` \| `box-only` | Controls touch propagation. |
| `style` | `StyleProp` | Optional container styles. |

