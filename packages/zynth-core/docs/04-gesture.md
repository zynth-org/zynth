# Gesture Overview

The Zynth Gesture system provides high-performance gesture recognition primitives. It abstracts native recognizers (UIKit on iOS and the View system on Android) into a unified, declarative API.

## Key Concepts

- **Native Precision**: Leverages native recognizers for platform-specific constants like touch slop and velocity thresholds.
- **Unified Integration**: Gestures are attached via a simple `gesture` prop on components.
- **Reactive Composition**: Gesture configurations are reactive and can be changed dynamically.

## Basic Usage

To handle gestures, create a gesture definition using one of the factory functions and pass it to a component.

```tsx
import { View } from "@zynth/components";
import { createTapGesture, createPanGesture } from "@zynth/core/gesture";

const App = () => {
  const tap = createTapGesture({
    onStart: () => console.log("Pressed!"),
    onEnd: () => console.log("Released!"),
  });

  const pan = createPanGesture({
    onUpdate: (event) => {
      console.log(`Panned to: ${event.translationX}, ${event.translationY}`);
    },
  });

  return (
    <View 
      gesture={[tap, pan]} 
      style={{ width: 100, height: 100, backgroundColor: 'blue' }} 
    />
  );
};
```
## Gesture Factories

### `createTapGesture(config)`
Recognizes one or more taps.
- `numberOfTaps`: (default: 1)
- `maxDelayMs`: (default: 250)

### `createPanGesture(config)`
Recognizes dragging/panning motion.
- `minDistance`: (default: 2)

### `createPinchGesture(config)`
Recognizes multi-touch pinching.
- Returns `scale`, `velocity`, `focalX`, and `focalY`.

### `createLongPressGesture(config)`
Recognizes a sustained press.
- `minDurationMs`: (default: 500)

---

## Interaction with Motion

Gestures and animations are both powered by **Shared Signals**. You can update a Shared Value directly from a gesture callback to drive high-performance interactions.

```tsx
import { createSharedValue, createAnimatedStyle, withSpring } from "@zynth/core/motion";
import { createPanGesture } from "@zynth/core/gesture";

const tx = createSharedValue(0);
const ty = createSharedValue(0);

const pan = createPanGesture({
  onUpdate: (e) => {
    // "worklet" direct update for maximum performance
    tx.value = e.translationX;
    ty.value = e.translationY;
  },
  onEnd: () => {
    tx.value = withSpring(0);
    ty.value = withSpring(0);
  }
});

const style = createAnimatedStyle(() => ({
  transform: [{ translateX: tx.value }, { translateY: ty.value }]
}));

<View gesture={pan} style={style} />
```

## Advanced Configuration

### Simultaneous Recognition
By default, all gestures provided in an array to the `gesture` prop can recognize simultaneously. This allows you to combine a `PanGesture` and a `PinchGesture` for complex canvas interactions.

### Pointer Events
You can control touch propagation using the `pointerEvents` prop:
- `"auto"`: View and children receive touches.
- `"none"`: View does not receive touches.
- `"box-none"`: View does not receive touches, but children do.
- `"box-only"`: View receives touches, but children do not.
