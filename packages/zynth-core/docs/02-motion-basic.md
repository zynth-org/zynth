# Motion Overview

The Zynth Motion system provides a suite of tools for creating fluid, high-performance animations. Following the framework's consolidation, animations are now built directly into the core primitives, allowing for a more expressive and performant developer experience.

## Key Concepts

- **JSI-First**: Animation calculations are offloaded to the native thread, ensuring 60/120 FPS even when the JS thread is busy.
- **Unified Styles**: Primitives like `View` and `Text` accept "Animated Styles" directly.
- **Shared Values**: Reactive primitives that hold the state of an animation.

## Basic Usage

To animate a property, create a **Shared Value** and use it inside a style created with `createAnimatedStyle`.

```tsx
import { View } from "@zynthjs/components";
import { 
  createSharedValue, 
  createAnimatedStyle, 
  withSpring 
} from "@zynthjs/core/motion";

const App = () => {
  const scale = createSharedValue(1);

  const style = createAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  const onPress = () => {
    // Drive the animation natively
    scale.value = withSpring(1.5, { damping: 10 });
  };

  return (
    <View 
      style={style} 
      onPress={onPress}
    />
  );
};
```

## Shared Values

`SharedValue` is a high-level wrapper around `SharedSignal`. It provides a `.value` property for imperative updates and supports animation drivers.

### `createSharedValue(initialValue: T)`

```ts
const offset = createSharedValue(0);

// Imperative update (immediately stops any running animation)
offset.value = 100;

// Access the current value (reactive in JS)
console.log(offset.value);
```

## Animation Drivers

Drivers are used to transition a Shared Value from its current state to a target value using specific physics or timing.

### `withTiming(toValue: number, config?: TimingConfig)`

A duration-based animation.

```ts
opacity.value = withTiming(1, {
  duration: 500,
  easing: Easing.inOut(Easing.quad),
});
```

### `withSpring(toValue: number, config?: SpringConfig)`

A physics-based spring animation. This is recommended for most UI interactions to provide a natural feel.

```ts
position.value = withSpring(0, {
  stiffness: 150,
  damping: 20,
  mass: 1,
});
```

## Animated Styles

`createAnimatedStyle` is a special hook that allows the framework to "sniff" shared values and establish a native-to-native link between the signal and the view's style properties.

```ts
const style = createAnimatedStyle(() => ({
  opacity: opacity.value,
  transform: [
    { translateX: offset.value },
    { rotate: `${rotation.value}deg` }
  ]
}));
```

> [!IMPORTANT]
> Always use `createAnimatedStyle` for styles that depend on `SharedValue`. If you pass a shared value directly to a standard `style` prop, it will fall back to JS-thread updates, losing the performance benefits of JSI.
---

## Technical Details

When an `AnimatedStyle` is applied to a `View`:
1. The framework captures all `SharedValue` IDs used in the function.
2. A **Native Style Mapper** is created on the UI thread.
3. Every time a Shared Value updates (natively), the Native Style Mapper re-calculates the style and applies it to the `HostNode` without any round-trip to JavaScript.
