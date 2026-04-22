# Components

The standard UI primitive library for the Zynth framework.

This package provides the core building blocks for constructing native user interfaces. These components map directly to their native counterparts (UIView, TextView, etc.) via the `@zynth/core` renderer, ensuring 100% native performance and accessibility.

## Primitives

- **Containers**: `View`, `ScrollView`, `GlassView`, `BlurView`
- **Content**: `Text`, `Image`, `SystemIcon`
- **Interactions**: `Button`, `Pressable`, `TextInput`, `Switch`, `Slider`
- **Lists**: `VirtualList`, `FlatList` (Virtualized, recycled list for high performance)
- **Overlays**: `Modal`, `Alert`

## Motion & Gestures

All core primitives are "Motion-Ready" and support JSI-first animations and gestures directly.

### Unified Animation

You can use `entering`, `exiting`, and `layout` props directly on any `View` or `Text`.

```tsx
import { View, Text } from "@zynth/components";
import { FadeIn, FadeOut, LinearTransition } from "@zynth/core/motion";

<View 
  entering={FadeIn} 
  exiting={FadeOut} 
  layout={LinearTransition}
>
  <Text>Animated Entry/Exit & Layout</Text>
</View>
```

### Integrated Gestures

Attach gestures via the `gesture` prop without extra wrappers.

```tsx
import { View } from "@zynth/components";
import { createTapGesture } from "@zynth/core/gesture";

const tap = createTapGesture({
  onStart: () => console.log("Tapped!")
});

<View gesture={tap} />
```

## Styling

Zynth uses a subset of CSS Flexbox for layout, powered by Yoga. Styles are passed via the `style` prop. For high-performance animations, use `createAnimatedStyle` from `@zynth/core/motion`.

```tsx
import { createAnimatedStyle, createSharedValue } from "@zynth/core/motion";

const scale = createSharedValue(1);
const animatedStyle = createAnimatedStyle(() => ({
  transform: [{ scale: scale.value }]
}));

<View style={animatedStyle} />
```
