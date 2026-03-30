# Animation

> [!WARNING]
> The `@zynth/animate` library is currently under active development and constant improvement. It is not yet considered production-ready.

High-performance, frame-synced animations for Zynth applications using the JSI native bridge.

The `@zynth/animate` package enables developers to create complex, fluid animations that run at 60/120fps by offloading the heavy lifting to the native thread. It provides a familiar, declarative API for Shared Values, interpolated styles, and lifecycle transitions.

## Features

- **Shared Values**: Reactive primitives synchronized with the native animation thread.
- **Hardware-Accelerated Styles**: Style mappings that bypass the JS thread for transforms and opacity.
- **Declarative Lifecycle**: Built-in support for entry and exit animations (Fade, Slide, Zoom).
- **Layout Intelligence**: Automatically animate components when their position or size changes.

## Documentation Index

Explore the specialized guides for each part of the animation system:

- **[Core Animations](./docs/Animation.md)**: `createSharedValue`, `withTiming`, `withSpring`, and basic animation control.
- **[AnimatedView](./docs/AnimatedView.md)**: Components, `createAnimatedStyle`, and the `visible` lifecycle prop.
- **[Interpolation](./docs/Interpolation.md)**: Range mapping, `interpolate`, and extrapolation strategies.
- **[Entry & Exit](./docs/EntryExit.md)**: Mounting/unmounting animations and `Keyframe` builders.
- **[Layout Transitions](./docs/LayoutTransitions.md)**: Animating automatic layout shifts and `LinearTransition`.

## Quick Start

### 1. Create a Shared Value

Shared values are the reactive source for all animations.

```tsx
import { createSharedValue, withSpring } from "@zynth/animate";

const opacity = createSharedValue(0);

const show = () => {
  opacity.value = withSpring(1);
};
```

### 2. Map to a Component

Use `createAnimatedStyle` to connect your shared values to an `AnimatedView`.

```tsx
import { AnimatedView, createAnimatedStyle } from "@zynth/animate";

function FadeInView() {
  const style = createAnimatedStyle(() => ({
    opacity: opacity.value
  }));

  return <AnimatedView style={style} />;
}
```
