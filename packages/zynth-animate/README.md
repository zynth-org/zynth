# @zynth/animate

High-performance, declarative animations for Zynth.

This library provides a physics-based animation system that runs on the UI thread (native) or the JS thread (web/polyfill), ensuring buttery smooth 60/120fps interactions. It is inspired by `react-native-reanimated`.

## Features

*   **Shared Values**: Reactive values that can be animated on the UI thread without bridging overhead.
*   **Worklets**: (Internal) Logic that runs synchronously on the UI thread.
*   **Layout Transitions**: Automatically animate entering, exiting, and layout changes.
*   **Physics**: Spring and Timing animations.

## Usage

### Basic Animation

```tsx
import { Animated, createSharedValue, useAnimatedStyle, withSpring } from "@zynth/animate";
import { Button } from "@zynth/components";

function MyComponent() {
  const width = createSharedValue(100);

  const style = useAnimatedStyle(() => ({
    width: width.value,
    height: 100,
    backgroundColor: "red",
  }));

  return (
    <>
      <Animated.View style={style} />
      <Button onPress={() => (width.value = withSpring(Math.random() * 300))}>
        Animate
      </Button>
    </>
  );
}
```

### Entering/Exiting Animations

Animate views when they mount or unmount.

```tsx
import { Animated, FadeIn, FadeOut } from "@zynth/animate";

<Animated.View 
  entering={FadeIn.duration(500)} 
  exiting={FadeOut}
>
  <Text>Hello</Text>
</Animated.View>
```

### Layout Transitions

Animate position changes when the layout updates (e.g., list reordering).

```tsx
import { Animated, LinearTransition } from "@zynth/animate";

<Animated.View layout={LinearTransition.springify()}>
  {/* Content */}
</Animated.View>
```

## API Reference

### `createSharedValue(initialValue)`
Creates a reference to a value that can be animated.
*   `.value`: Get or set the current value. Assigning an animation function (like `withTiming`) triggers an animation.

### `useAnimatedStyle(() => style)`
Creates a reactive style object that updates whenever accessed shared values change. Returns a style object compatible with `Animated.View`.

### `Animated.View`
A wrapper around the native `View` that accepts `useAnimatedStyle` results and handles layout animations.

### Animation Functions
*   `withSpring(toValue, config)`: Physics-based spring animation.
*   `withTiming(toValue, config)`: Time-based animation with easing.

### Transition Objects
*   `FadeIn`, `FadeOut`: Opacity transitions.
*   `LinearTransition`: Standard layout change transition.
