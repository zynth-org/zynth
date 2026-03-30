# Core Animations

High-performance, frame-synced animations for Zynth applications, powered by Shared Values and the native JSI bridge.

The `@zynth/animate` system is designed for maximum performance by offloading animation calculations to the native thread. It uses **Shared Values** as the source of truth, ensuring that UI updates stay perfectly in sync with the OS display refresh rate.

## Basic usage

### Shared Values

Shared Values are reactive primitives that can be shared between the JavaScript thread and the native animation thread. They are the foundation of all animations in Zynth and serve as a high-level abstraction over `@zynth/core`'s **Shared Signals**.

```tsx
import { createSharedValue } from "@zynth/animate";

// Initialize a shared value with a number
const offset = createSharedValue(0);

// Update its value imperatively
const moveRight = () => {
  offset.value = 100;
};
```

### Timing Animations

To animate a value over a specific duration, wrap the target value with `withTiming`.

```tsx
import { createSharedValue, withTiming, Easing } from "@zynth/animate";

const opacity = createSharedValue(0);

const fadeIn = () => {
  opacity.value = withTiming(1, {
    duration: 500,
    easing: Easing.out(Easing.cubic)
  });
};
```

### Spring Animations

For physical, physics-based motion, use `withSpring`. This is the preferred way to animate interactive elements like buttons and sliders.

```tsx
import { createSharedValue, withSpring } from "@zynth/animate";

const scale = createSharedValue(1);

const onPressIn = () => {
  scale.value = withSpring(0.9, {
    damping: 10,
    stiffness: 100
  });
};
```

## Advanced

### Animation Hooks and Callbacks

You can listen for animation completion using the `onFinish` callback within the animation configuration.

```ts
offset.value = withTiming(200, {
  duration: 1000,
  onFinish: (finished) => {
    if (finished) {
      console.log("Animation landed safely!");
    }
  }
});
```

## Special cases

- **Thread Switching**: When a style property is mapped to a Shared Value via `createAnimatedStyle`, Zynth automatically handles the bridge synchronization. Updates to `.value` happen immediately on the JS thread and are mirrored to the native thread for the next frame.
- **Cancellation**: Setting a Shared Value to a static number (or calling `.cancelAnimation()`) will immediately stop any running animation on that value.

## API Reference

### `createSharedValue(initialValue: T)`
Creates a new shared value container.
- **Returns**: `SharedValue<T>`

### `withTiming(toValue: number, config?: TimingConfig)`
Animates a value using a duration-based transition.
- **Config**:
  - `duration?: number` (Default: 300)
  - `easing?: EasingFunction` (Default: `Easing.inOut(Easing.quad)`)
  - `delay?: number`
  - `onFinish?: (finished: boolean) => void`

### `withSpring(toValue: number, config?: SpringConfig)`
Animates a value using a spring physics simulation.
- **Config**:
  - `damping?: number` (Default: 20)
  - `stiffness?: number` (Default: 150)
  - `mass?: number` (Default: 1)
  - `velocity?: number` (Initial velocity)
  - `onFinish?: (finished: boolean) => void`

### `SharedValue<T>` Interface
- `value: T` (Getter/Setter)
- `cancelAnimation(): void`
- `toSignal(): SharedSignalAccessor<T>` (Convert to a standard SolidJS signal)
