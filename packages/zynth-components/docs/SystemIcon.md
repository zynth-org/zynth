# SystemIcon

`SystemIcon` is a wrapper around the `Image` primitive that maps directly to platform-standard symbols. It provides a simple, direct interface to work with SF Symbols on iOS and platform Drawables on Android.

## Basic Usage

The component is at its simplest as a graphic element with a `name` corresponding to a platform-defined symbol.

```tsx
import { SystemIcon, View, Text } from "@zynth/components";

function IconStack() {
  return (
    <View style={{ flexDirection: "row", gap: 16 }}>
      <SystemIcon 
        name="person" 
        style={{ width: 24, height: 24 }} 
      />
      <SystemIcon 
        name="gear" 
        style={{ width: 24, height: 24 }} 
      />
      <SystemIcon 
        name="bell.fill" 
        style={{ width: 24, height: 24 }} 
      />
    </View>
  );
}
```

## Styling and Tinting

Since `SystemIcon` extends the `Image` primitive, you can apply tint colors and other standard styling like padding or rounded corners.

```tsx
<SystemIcon
  name="star.fill"
  tintColor="#fbbf24" // Solid amber tint
  style={{ 
    width: 32, 
    height: 32, 
    borderRadius: 8, 
    backgroundColor: "rgba(0,0,0,0.05)" 
  }}
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `name` | `string` | The platform-specific name of the symbol. |
| `style` | `Style` | Styling for dimensions, padding, and layout. |
| `tintColor` | `string` | Color to apply as a mask to the symbol. |
| `resizeMode`| `cover \| contain \| stretch \| center` | Scaling behavior (defaults to `contain`). |
| `testID` | `string` | Unique identifier for automation testing. |

## Platform Notes

- **iOS**: Maps directly to Apple's **SF Symbols**. Ensure the provided names are valid system symbols for the active iOS version.
- **Android**: Maps to the internal **Drawable** resources directory.
