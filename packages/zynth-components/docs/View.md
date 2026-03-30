# View

`View` is the fundamental building block for UI layout in Zynth. It supports Flexbox positioning via the Yoga layout engine, responsive touch interactions, accessibility features, and layout measurement.

## Basic Usage

`View` acts as a container for other elements. It is designed to be highly reactive, supporting style accessor functions for high-frequency updates during gestures or animations.

```tsx
import { View, Text } from "@zynth/components";

function Card() {
  return (
    <View 
      style={{
        padding: 16,
        backgroundColor: "#ffffff",
        borderRadius: 8,
        shadowOpacity: 0.1,
      }}
    >
      <Text>Card Content</Text>
    </View>
  );
}
```

## Layout Measurement

To retrieve the runtime dimensions and position of a container, use the `onLayout` callback. This is dispatched once after the first layout pass and subsequently whenever the view's size or position changes.

```tsx
function MeasuredView() {
  const [size, setSize] = createSignal({ width: 0, height: 0 });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View onLayout={handleLayout} style={{ flex: 1 }}>
      <Text>Width: {size().width}, Height: {size().height}</Text>
    </View>
  );
}
```

## Pointer Interactivity

Control how the view and its children react to touch events using the `pointerEvents` prop. This is useful for creating transparent overlays or disabling input for specific sub-hierarchies.

| Value | Description |
|---|---|
| `auto` | Receives touches normally (default). |
| `none` | View and children are transparent to touches. |
| `box-none` | View is transparent, but children can receive touches. |
| `box-only` | View receives touches, but children are transparent. |

```tsx
{/* Transparent overlay that doesn't block touches */}
<View 
  style={{ position: "absolute", inset: 0 }} 
  pointerEvents="none" 
/>
```

## Glass Aesthetics

On supported iOS versions, `View` can enable native glass effects (blur/vibrancy) by setting `enableGlassIOS`. This leverages system SF Symbol and UIBlurEffect for a premium frosted-glass appearance.

```tsx
<View 
  enableGlassIOS={true} 
  tintColor="#7c3aed"
  style={{ padding: 24 }}
>
  <Text>Frosted Overlay</Text>
</View>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | Nested components. |
| `style` | `StyleProp \| () => StyleProp` | Component styles. Supports reactive accessor functions for synchronous updates. |
| `onLayout` | `(event: LayoutChangeEvent) => void` | Called once on mount and on every layout change. |
| `onPress` | `() => void` | Simplified tap handler for non-complex interactions. |
| `pointerEvents` | `auto` \| `none` \| `box-none` \| `box-only` | Controls touch event propagation. |
| `accessibilityLabel` | `string` | Spoken description for screen readers. |
| `accessibilityRole` | `button` \| `header` \| `link` \| `none` | Accessibility behavior hint. |
| `enableGlassIOS` | `boolean` | Enables native frosted-glass effects (iOS). |
| `tintColor` | `string` | Tint color for glass effects or certain native styles. |
| `testID` | `string` | Unique identifier for automation tests. |
| `ref` | `(node: HostNode) => void` | Access the underlying native host node. |

## Notes

- **Implementation Tip**: When performing synchronous style updates (e.g., during a scroll or drag), pass a function to the `style` prop. This allows Zynth to update the native layout props directly on the host node without triggering a full SolidJS reactive cycle.
- **Flexbox**: Laying out views is done using Standard Flexbox. If no dimensions are provided, `View` will collapse to 0 size unless expanded by its children or a `flex` property.
