# Advanced Motion

Beyond basic shared value animations, Zynth provides powerful tools for interpolating values, defining complex easings, and handling layout changes.

## Interpolation

Interpolation allows you to map a value from one range to another. This is commonly used to drive multiple properties (like opacity and scale) from a single "progress" shared value.

### `interpolate(value: number, inputRange: number[], outputRange: number[], config?: InterpolationConfig)`

```tsx
import { interpolate, Extrapolation } from "@zynthjs/core/motion";

const style = createAnimatedStyle(() => {
  const opacity = interpolate(
    scrollOffset.value,
    [0, 100],      // Input: scroll position
    [1, 0],        // Output: fade out
    Extrapolation.CLAMP
  );
  
  return { opacity };
});
```

## Easings

Easings control the rate of change of an animation over time.

```tsx
import { Easing } from "@zynthjs/core/motion";

withTiming(1, {
  easing: Easing.bezier(0.25, 0.1, 0.25, 1),
});
```

Common easings include:
- `Easing.linear`
- `Easing.quad`, `Easing.cubic`, `Easing.poly(n)`
- `Easing.bezier(x1, y1, x2, y2)`
- `Easing.in(easing)`, `Easing.out(easing)`, `Easing.inOut(easing)`

---

## Layout Transitions

Layout transitions automatically animate changes to a view's size or position caused by changes in the Flexbox (Yoga) layout.

### `LinearTransition`

The simplest transition, which smoothly moves a component from its old position to its new one.

```tsx
import { View } from "@zynthjs/components";
import { LinearTransition } from "@zynthjs/core/motion";

<View layout={LinearTransition} />
```

---

## Entry and Exit Animations

Zynth primitives support declarative entry and exit animations that run when a component is mounted or unmounted (or when its `visible` prop changes).

### Basic Usage

```tsx
import { FadeIn, FadeOut } from "@zynthjs/core/motion";
import { View } from "@zynthjs/components";

const App = () => {
  const [show, setShow] = createSignal(true);

  return (
    <Show when={show()}>
      <View 
        entering={FadeIn.duration(500)} 
        exiting={FadeOut}
      />
    </Show>
  );
};
```

### Keyframes

For more complex entry/exit paths, you can use the `Keyframe` builder.

```tsx
import { Keyframe } from "@zynthjs/core/motion";

const customEntering = new Keyframe({
  0: {
    transform: [{ scale: 0 }, { rotate: '0deg' }],
    opacity: 0,
  },
  45: {
    transform: [{ scale: 1.2 }, { rotate: '45deg' }],
  },
  100: {
    transform: [{ scale: 1 }, { rotate: '0deg' }],
    opacity: 1,
  },
}).duration(1000);

<View entering={customEntering} />
```

> [!NOTE]
> Entry/Exit animations on native platforms are handled by the `startNativeTransition` API, ensuring that even unmounting animations remain smooth and frame-perfect.
