# Entry & Exit Animations

Declarative animations for the lifecycle of Zynth components.

Zynth provides a powerful system for animating components as they enter or leave the view hierarchy. Unlike standard web transitions, these animations are deeply integrated with the Zynth layout engine, allowing for smooth mounting and unmounting even during complex layout shifts.

## Basic usage

### Preset Animations

Zynth comes with several pre-defined animation builders like `FadeIn` and `FadeOut`. Assign these to the `entering` and `exiting` props of an `AnimatedView`.

```tsx
import { AnimatedView, FadeIn, FadeOut } from "@zynth/animate";

function Notification() {
  return (
    <AnimatedView 
      entering={FadeIn.duration(400)} 
      exiting={FadeOut.delay(100)}
    >
      <Text>New Message Received</Text>
    </AnimatedView>
  );
}
```

## Advanced

### Custom Animations

You can define custom entry and exit behaviors by specifying the `from` and `to` states directly.

```tsx
import { AnimatedView } from "@zynth/animate";

const SlideUp = {
  from: { transform: [{ translateY: 100 }], opacity: 0 },
  to: { transform: [{ translateY: 0 }], opacity: 1 },
  duration: 500,
  easing: "easeOutCubic"
};

<AnimatedView entering={SlideUp}>
  <Component />
</AnimatedView>
```

### Keyframes

For multi-stage animations, use the `Keyframe` builder to define specific styles at percentages of the animation's total duration.

```tsx
import { Keyframe, AnimatedView } from "@zynth/animate";

const pulse = new Keyframe({
  0: { transform: [{ scale: 1 }] },
  50: { transform: [{ scale: 1.2 }], opacity: 0.8 },
  100: { transform: [{ scale: 1 }] }
}).duration(1000);

<AnimatedView entering={pulse}>
  <HeartIcon />
</AnimatedView>
```

## Special cases

- **Unmounting Logic**: When an `AnimatedView` with an `exiting` prop is removed from the component tree (or its `visible` prop becomes `false`), Zynth intercepts the unmount, plays the full animation on the native thread, and only then cleans up the host node.
- **Interrupting Transitions**: If a view is in the middle of an `entering` animation and is suddenly unmounted, Zynth will immediately transition into the `exiting` phase from the current state to ensure visual continuity.

## API Reference

### Preset Builders
- `FadeIn` / `FadeOut`
- `SlideIn` / `SlideOut` (based on directional presets)

### `EntryExitAnimation` Object
- `from?: Style`
- `to?: Style`
- `duration?: number`
- `easing?: string`
- `delay?: number`

### `Keyframe` Builder
- `constructor(definitions: Record<number, Style>)`
- `duration(ms: number)`
- `delay(ms: number)`
- `build()`
