# GlassContainer

`GlassContainer` is a structural primitive optimized for grouping and organizing glass-styled elements. On iOS, it uses a dedicated native container that manages hierarchical glass effects; on Android, it provides a consistent layout fallback.

## Basic Usage

The component is at its simplest as a wrapper for creating a themed section of the interface using multiple `GlassView` components.

```tsx
import { GlassContainer, GlassView, View, Text } from "@zynthjs/components";

function GlassDashboard() {
  return (
    <View style={{ flex: 1, backgroundColor: "#eee" }}>
      <GlassContainer spacing={16} style={{ padding: 20 }}>
        <GlassView style={{ height: 100 }}>
          <Text>Panel 1</Text>
        </GlassView>
        <GlassView style={{ height: 100 }}>
          <Text>Panel 2</Text>
        </GlassView>
      </GlassContainer>
    </View>
  );
}
```

## Child Alignment and Spacing

The `spacing` prop can be used to control the visual gaps between child glass elements within the container.

```tsx
<GlassContainer 
  spacing={12} 
  style={{ flexDirection: "row", padding: 24 }}
>
  <GlassView style={{ flex: 1 }} />
  <GlassView style={{ flex: 1 }} />
</GlassContainer>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | Content placed inside the glass group. |
| `spacing` | `number` | Internal gap between child components. |
| `style` | `Style` | Styling for the main container wrapper. |
| `pointerEvents`| `auto \| none \| box-none \| box-only` | Touch event propagation behavior. |
| `testID` | `string` | Unique identifier for automation tests. |

## Platform Notes

- **iOS**: Uses a native `glass-container` node to optimize the rendering of multiple vibrant subviews.
- **Android**: Falls back to a standard `View` for structural compatibility while maintaining child layout.
