# Gesture Handler

`Gesture Handler` provides a suite of high-performance gesture recognition primitives for Zynth. It abstracts native gesture recognizers (UIKit on iOS and the View system on Android) into a unified, declarative API.

By leveraging native recognizers, it ensures that interactions like pinching, rotating, and panning feel responsive and adhere to platform-specific constants, such as touch slop and velocity thresholds. The package seamlessly integrates with SolidJS reactivity, allowing gesture configurations to be updated dynamically without losing recognizer state.

Basic platform support is provided for iOS and Android. Web support is currently partial and mapped to standard pointer events.

## Basic usage

Wrap any component that needs gesture recognition with the `GestureDetector` and provide one or more gesture definitions.

```tsx
import { createSignal } from "solid-js";
import { View } from "@zynth/components";
import {
  GestureDetector,
  createTapGesture,
  createPanGesture,
} from "@zynth/gesture-handler";

const App = () => {
  const [pressed, setPressed] = createSignal(false);

  const tap = createTapGesture({
    onStart: () => setPressed(true),
    onEnd: () => setPressed(false),
    onDeactivate: () => setPressed(false),
  });

  const pan = createPanGesture({
    onUpdate: (e) => {
      console.log(`Translating: ${e.translationX}, ${e.translationY}`);
    },
  });

  return (
    <GestureDetector gesture={[tap, pan]}>
      <View
        style={{
          width: 200,
          height: 200,
          backgroundColor: pressed() ? "darkblue" : "blue",
          borderRadius: 20,
        }}
      />
    </GestureDetector>
  );
};
```

## Advanced examples

### Reactive gesture composition

Since `GestureDetector` accepts a reactive `gesture` prop, you can use SolidJS primitives to compose or enable/disable gestures based on application state.

```tsx
import { createMemo, createSignal } from "solid-js";
import { View } from "@zynth/components";
import {
  GestureDetector,
  createPanGesture,
  createPinchGesture,
} from "@zynth/gesture-handler";

const InteractiveLayer = (props) => {
  const [isLocked, setIsLocked] = createSignal(false);

  const gestures = createMemo(() => {
    if (isLocked()) return [];

    return [
      createPanGesture({
        onUpdate: (e) => props.onTranslate(e.translationX, e.translationY),
      }),
      createPinchGesture({
        onUpdate: (e) => props.onScale(e.scale),
      }),
    ];
  });

  return (
    <GestureDetector gesture={gestures()}>{props.children}</GestureDetector>
  );
};
```

### Elastic Interaction (Animation Integration)

Gestures and animations in Zynth are both powered by the same underlying reactive primitive: **Shared Signals**. This allows `createSharedValue` from `@zynth/animate` to be updated seamlessly from gesture callbacks to drive complex interactions like the "snap-back" effect below.

```tsx
import { View, Text } from "@zynth/components";
import {
  Animated,
  createSharedValue,
  createAnimatedStyle,
  withSpring,
} from "@zynth/animate";
import { GestureDetector, createPanGesture } from "@zynth/gesture-handler";

export function GestureElasticCard() {
  const tx = createSharedValue(0);
  const ty = createSharedValue(0);
  const scale = createSharedValue(1);

  const pan = createPanGesture({
    onStart: () => {
      // Direct update to shared value triggers high-performance native scale change
      scale.value = withSpring(1.05, { stiffness: 200, damping: 18 });
    },
    onUpdate: (event) => {
      tx.value = event.translationX;
      ty.value = event.translationY;
    },
    onDeactivate: () => {
      // Elastic snap-back on release
      tx.value = withSpring(0, { stiffness: 220, damping: 20 });
      ty.value = withSpring(0, { stiffness: 220, damping: 20 });
      scale.value = withSpring(1, { stiffness: 220, damping: 18 });
    },
  });

  const cardStyle = createAnimatedStyle(() => ({
    width: 180,
    height: 120,
    borderRadius: 22,
    backgroundColor: "#4a8df7",
    // Standard Zynth transform array of objects
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={cardStyle}>
        <Text style={{ color: "#ffffff", fontWeight: "700" }}>Drag me</Text>
      </Animated.View>
    </GestureDetector>
  );
}
```

## Special cases and notes

- **Simultaneous Recognition**: All gestures passed in the `gesture` array are configured to recognize simultaneously by default. If a `PanGesture` and a `PinchGesture` are active, both callbacks will fire during a multi-touch interaction.
- **Gesture Phases**: Every gesture event includes a `phase` field: `start`, `update`, `end`, or `deactivate`. The `deactivate` phase is guaranteed to fire when a gesture is completed, cancelled, or interrupted by another gesture or system event.
- **Coordinate Systems**: The `x` and `y` coordinates in the event payload are relative to the bounds of the `GestureDetector` component. Use `absoluteX` and `absoluteY` for screen-space coordinates.
- **Pointer Events**: Control touch propagation using the `pointerEvents` prop: `"auto" | "none" | "box-none" | "box-only"`.

## API Reference

**Exports:** GestureDetector, createTapGesture, createLongPressGesture, createRotationGesture, createPinchGesture, createFlingGesture, createPanGesture.

**GestureDetector** (Component)

- `gesture` — A single gesture, an array of gestures, or an accessor returning them.
- `style` — Layout and visual styles for the detector container.
- `pointerEvents` — `"auto" | "none" | "box-none" | "box-only"`.
- `panSharedSignalX` / `panSharedSignalY` — Native `SharedValue` or ID for direct UI-thread pan updates.
- `ref` — Access to the underlying HostNode.

**Gesture Factories**

All factory functions accept a config object with optional callbacks: `onStart`, `onUpdate`, `onEnd`, and `onDeactivate`.

- `createTapGesture(config)`
  - `numberOfTaps` (default: 1)
  - `maxDelayMs` (default: 250)
- `createLongPressGesture(config)`
  - `minDurationMs` (default: 500)
- `createPanGesture(config)`
  - `minDistance` (default: 2)
- `createPinchGesture(config)`
  - `minScaleDelta` (default: 0)
- `createRotationGesture(config)`
  - `minRotation` (default: 0)
- `createFlingGesture(config)`
  - `minVelocity` (default: 800)

**Event Payload** (Base)

- `phase`: `"start" | "update" | "end" | "deactivate"`
- `timestamp`: Number (ms)
- `x` / `y`: Local coordinates.
- `absoluteX` / `absoluteY`: Screen coordinates.

**Specific Event Fields**

- **Tap**: `numberOfTaps`
- **Long Press**: `durationMs`
- **Pan**: `translationX`, `translationY`, `velocityX`, `velocityY`
- **Pinch**: `scale`, `velocity`, `focalX`, `focalY`
- **Rotation**: `rotation` (degrees), `velocity`, `anchorX`, `anchorY`
- **Fling**: `velocityX`, `velocityY`, `direction` (`"up" | "down" | "left" | "right"`)

---

This package provides the foundation for interactive components. For complex animations driven by these gestures, it is recommended to use this alongside `@zynth/animate`.
