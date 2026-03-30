# GlassView

`GlassView` is a specialized primitive for creating modern, high-fidelity interfaces with real-time blur and vibrancy effects. On iOS, it maps to native vibrancy layers, providing a premium "frosted glass" aesthetic. It is interactive by default, responding to touch with subtle scale and tilt animations.

## Basic Usage

The component is typically used as a container for high-contrast content that needs to stand out against a complex background.

```tsx
import { GlassView, Text, View } from "@zynth/components";

function GlassPanel() {
  return (
    <View style={{ flex: 1, backgroundColor: "#3b82f6", padding: 40 }}>
      <GlassView 
        style={{ width: 200, height: 120, borderRadius: 20, padding: 20 }}
        effect="regular"
      >
        <Text style={{ color: "white" }}>Frosted Content</Text>
      </GlassView>
    </View>
  );
}
```

## Interactive Feedback

By default, `GlassView` is `interactive`, meaning it will provide tactile visual feedback (scaling and tilting) during user touch events. This behavior can be toggled using the `interactive` prop.

```tsx
{/* Static glass panel without touch responsiveness */}
<GlassView interactive={false} style={panelStyle}>
  <Text>Static Glass</Text>
</GlassView>
```

## Custom Tinting

Apply a `tintColor` to the glass layer to blend it with specific branding or UI themes.

```tsx
<GlassView 
  tintColor="rgba(255, 0, 0, 0.1)" // Slight red tint
  style={panelStyle}
>
  <Text>Branded Glass</Text>
</GlassView>
```

## Effect Styles

The `effect` prop controls the density and style of the native blur:

- `regular`: Standard frosted glass appearance (default).
- `clear`: High-transparency vibrancy effect.
- `none`: Disables the native blur while maintaining the container structure.

## Props

| Prop | Type | Description |
|---|---|---|
| `effect` | `regular \| clear \| none` | Native blur and vibrancy intensity. |
| `interactive` | `boolean` | Enables touch-responsive scale/tilt (default: true). |
| `tintColor` | `string` | Color to blend with the glass layer. |
| `style` | `Style` | Styling for the glass container and its boundaries. |
| `pointerEvents`| `auto \| none \| box-none \| box-only` | Touch event propagation behavior. |
| `children` | `JSX.Element` | Content rendered within the glass effect area. |

## Platform Notes

- **iOS**: Uses native vibrancy and blur layers. Animations are handled on the UI thread for zero-latency feedback.
- **Android**: Falls back to a standard `View` for layout compatibility. Use semi-transparent background colors in your `style` to emulate the appearance.
