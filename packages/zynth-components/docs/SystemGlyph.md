# SystemGlyph

`SystemGlyph` is a font-based iconography system mapping to custom-registered runtime fonts. It offers scalable vectors that are rendered as text glyphs, ensuring perfect alignment and granular synchronization with the platform's text engine.

## Basic Usage

The component is at its simplest as a graphic element with specific `size` and `color`.

```tsx
import { SystemGlyph, View, Text } from "@zynth/components";

function IconRow() {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <SystemGlyph 
        name="star.fill" 
        size={24} 
        color="#fbbf24" 
      />
      <SystemGlyph 
        name="heart.fill" 
        size={24} 
        color="#ef4444" 
      />
    </View>
  );
}
```

## Styling and Sizing

`SystemGlyph` inherits from the `Text` primitive, allowing it to take any standard text-based styling (e.g., custom fonts or alignment).

```tsx
<SystemGlyph
  name="gear"
  size={32}
  color="#3b82f6"
  style={{ opacity: 0.8 }}
/>
```

## Font Loading and Availability

Because `SystemGlyph` relies on custom-registered runtime fonts, it includes automatic tracking of font availability. It will wait for the corresponding bundle to be ready before displaying the glyph to avoid flashes of unstyled content or fallback characters.

## Props

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | The unique identifier for the registered glyph. |
| `size` | `number` | The physical dimensions (pixel height/width). |
| `color` | `string` | The hex color for the iconography. |
| `style` | `Style` | Styling inherited from the `Text` primitive. |
| `testID` | `string` | Unique identifier for automation testing. |

## Notes

- **Registration**: All glyphs must be registered via the native `Glyphs` API during the application's initialization phase.
- **Rendering**: Glyph-based rendering is more efficient than image-based iconography for massive lists as it benefits from the font system's internal caching.
