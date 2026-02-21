# @zynth/gesture-handler

Gesture primitives for Zynth with a SolidJS-first API.

## Usage

```tsx
import { GestureDetector, createPanGesture } from "@zynth/gesture-handler";
import { createSharedValue, withTiming } from "@zynth/animate";

const position = createSharedValue(0);

const panGesture = createPanGesture({
  onUpdate: (event) => {
    position.value = event.translationX;
  },
  onDeactivate: () => {
    position.value = withTiming(0, { duration: 100 });
  },
});

<GestureDetector gesture={panGesture} style={{ width: 120, height: 120 }}>
  {/* content */}
</GestureDetector>;
```

## Included gesture factories

- `createTapGesture`
- `createLongPressGesture`
- `createRotationGesture`
- `createPinchGesture`
- `createFlingGesture`
- `createPanGesture`
