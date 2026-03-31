# Components

The standard UI primitive library for the Zynth framework.

This package provides the core building blocks for constructing native user interfaces. These components map directly to their native counterparts (UIView, TextView, etc.) via the `@zynth/core` renderer, ensuring 100% native performance and accessibility.

## Primitives

- **Containers**: `View`, `ScrollView`, `GlassView`
- **Content**: `Text`, `Image`, `SystemIcon`
- **Interactions**: `Button`, `Pressable`, `TextInput`, `Switch`, `Slider`
- **Lists**: `VirtualList`, `FlatList` (Virtualized, recycled list for high performance)
- **Overlays**: `Modal`, `Alert`

## Usage

```tsx
import { View, Text, Button } from "@zynth/components";

export function MyComponent() {
  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "bold" }}>Hello Zynth</Text>
      <Button onPress={() => console.log("Pressed!")}>Press Me</Button>
    </View>
  );
}
```

## Styling

Zynth uses a subset of CSS Flexbox for layout, powered by Yoga. Styles are passed via the `style` prop, similar to React Native.

```tsx
<View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
  <Text>Centered Text</Text>
</View>
```
