# Motion & Gesture Migration Guide

Migrating from `@zynth/animate` + `@zynth/gesture-handler` to the consolidated
`@zynth/core/motion`, `@zynth/core/gesture`, and `@zynth/components` APIs.

---

## Why this changed

The original `@zynth/animate` and `@zynth/gesture-handler` packages existed as
separate opt-in packages. After Phase 1–3 of the animation/gesture consolidation
roadmap, all runtime logic lives inside `@zynth/core` and the UI primitives live
in `@zynth/components`. There are no extra packages to install for basic
animation and gesture work.

---

## Summary table

| Old import | New import |
|---|---|
| `createSharedValue` | `@zynth/core/motion` |
| `withTiming`, `withSpring` | `@zynth/core/motion` |
| `createAnimatedStyle` | `@zynth/core/motion` |
| `interpolate`, `Extrapolation` | `@zynth/core/motion` |
| `Easing` | `@zynth/core/motion` |
| `FadeIn`, `FadeOut`, `Keyframe` | `@zynth/core/motion` |
| `LinearTransition` | `@zynth/core/motion` |
| `AnimatedView` / `Animated.View` | `View` from `@zynth/components` |
| `createPanGesture`, `createTapGesture`, … | `@zynth/core/gesture` |
| `GestureDetector` | `@zynth/components` |

---

## Animation utilities

```diff
- import { createSharedValue, withTiming, withSpring, createAnimatedStyle } from "@zynth/animate";
+ import { createSharedValue, withTiming, withSpring, createAnimatedStyle } from "@zynth/core/motion";
```

```diff
- import { interpolate, Extrapolation, Easing } from "@zynth/animate";
+ import { interpolate, Extrapolation, Easing } from "@zynth/core/motion";
```

---

## Entry / exit / layout animations

```diff
- import { FadeIn, FadeOut, Keyframe, LinearTransition } from "@zynth/animate";
+ import { FadeIn, FadeOut, Keyframe, LinearTransition } from "@zynth/core/motion";
```

---

## `AnimatedView` → `View`

`View` from `@zynth/components` now natively supports all animated style and
transition props. You no longer need a wrapper component.

### Animated style

```diff
- import { Animated, createAnimatedStyle, createSharedValue, withSpring } from "@zynth/animate";
+ import { createAnimatedStyle, createSharedValue, withSpring } from "@zynth/core/motion";
  import { View } from "@zynth/components";

  const scale = createSharedValue(1);
  const boxStyle = createAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

- <Animated.View style={boxStyle}>…</Animated.View>
+ <View style={boxStyle}>…</View>
```

### Entry / exit animations

```diff
- import { Animated, FadeIn, FadeOut } from "@zynth/animate";
+ import { FadeIn, FadeOut } from "@zynth/core/motion";
  import { View } from "@zynth/components";

- <Animated.View entering={FadeIn} exiting={FadeOut} visible={isVisible()}>
+ <View entering={FadeIn} exiting={FadeOut} visible={isVisible()}>
    …
- </Animated.View>
+ </View>
```

### Layout transition

```diff
- import { Animated, LinearTransition } from "@zynth/animate";
+ import { LinearTransition } from "@zynth/core/motion";
  import { View } from "@zynth/components";

- <Animated.View layout={LinearTransition}>…</Animated.View>
+ <View layout={LinearTransition}>…</View>
```

---

## Gesture handlers

### Builders

```diff
- import { createPanGesture, createTapGesture, createPinchGesture } from "@zynth/gesture-handler";
+ import { createPanGesture, createTapGesture, createPinchGesture } from "@zynth/core/gesture";
```

### GestureDetector

```diff
- import { GestureDetector } from "@zynth/gesture-handler";
+ import { GestureDetector } from "@zynth/components";
```

### Full gesture example

```diff
- import { Animated, createSharedValue, createAnimatedStyle, withSpring } from "@zynth/animate";
- import { GestureDetector, createPanGesture } from "@zynth/gesture-handler";
+ import { createSharedValue, createAnimatedStyle, withSpring } from "@zynth/core/motion";
+ import { GestureDetector } from "@zynth/components";
+ import { createPanGesture } from "@zynth/core/gesture";
  import { View } from "@zynth/components";

  const tx = createSharedValue(0);
  const pan = createPanGesture({ onUpdate: (e) => { tx.value = e.translationX; } });
  const style = createAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  <GestureDetector gesture={pan}>
-   <Animated.View style={style} />
+   <View style={style} />
  </GestureDetector>
```

---

## Package.json changes

Remove `@zynth/animate` and `@zynth/gesture-handler` from your dependencies.
Add `@zynth/core` if you were not already depending on it.

```diff
  {
    "dependencies": {
+     "@zynth/core": "0.0.1-alpha.0",
      "@zynth/components": "0.0.1-alpha.0",
-     "@zynth/animate": "0.0.1-alpha.0",
-     "@zynth/gesture-handler": "0.0.1-alpha.0"
    }
  }
```

---

## Guidance for component authors

### When to use animated styles

Use `createAnimatedStyle` when you need continuous UI-thread driven transforms —
scale, translate, opacity, rotate — responding to shared values. Attach to any
`View`, `Text`, `Pressable`, or `GestureDetector` via the `style` prop directly.
The native style mapper is attached lazily and adds zero overhead when no
animation metadata is present.

```tsx
// ✅ Correct: animated style directly on a primitive
const scale = createSharedValue(1);
const animStyle = createAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
<View style={animStyle} />
```

```tsx
// ❌ Avoid: wrapping in AnimatedView — it's an unnecessary indirection
<Animated.View style={animStyle} />  // @deprecated
```

### When to use gesture props

Attach gestures to `GestureDetector` for multi-touch recognizers (pan, pinch,
rotation). Use `Pressable` for discrete press interactions (tap, long-press) —
it has a built-in press recognizer optimized for accessibility and hit testing.

```tsx
// ✅ Pan gesture → GestureDetector
const pan = createPanGesture({ onUpdate: (e) => { tx.value = e.translationX; } });
<GestureDetector gesture={pan}><View style={dragStyle} /></GestureDetector>

// ✅ Tap interaction → Pressable
<Pressable onPress={handlePress}><Text>Tap me</Text></Pressable>
```

### How to keep motion on the UI thread

- Use `createSharedValue` + `createAnimatedStyle` for style-driven animations.
  These run on the native UI thread via the JSI style mapper.
- Avoid reading `sharedValue.value` inside SolidJS reactive computations —
  signal reads and shared value reads are different reactive systems.
- Use `onUpdate` in gesture callbacks to write shared values synchronously.
  Never `setState` or update SolidJS signals in a hot-path gesture callback.
- For JS-thread animations (web fallback), use `withTiming` / `withSpring`.
  These run on the JS thread but are still driven by the Zynth RAF loop.

```tsx
// ✅ UI-thread path: shared value → native mapper → frame update
const progress = createSharedValue(0);
const style = createAnimatedStyle(() => ({ opacity: progress.value }));
progress.value = withSpring(1);  // animates on UI thread

// ❌ JS-thread anti-pattern: signal updates in gesture callbacks
const pan = createPanGesture({
  onUpdate: (e) => setTranslateX(e.translationX),  // ❌ causes JS-thread bridge
});
```
