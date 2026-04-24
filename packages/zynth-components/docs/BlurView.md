# BlurView

`BlurView` provides a native blur container on platforms that expose a practical blur primitive for in-tree views.

On iOS, it uses a native blur-backed view. On the web, it maps to CSS backdrop blur. On Android, `BlurView` intentionally falls back to a regular container view unless the project opts into a dedicated native blur backend.

## Basic Usage

```tsx
import { BlurView, Text, View } from "@zynthjs/components";

function BlurCard() {
  return (
    <View style={{ flex: 1, backgroundColor: "#1d4ed8", padding: 32 }}>
      <BlurView
        intensity={24}
        tint="light"
        style={{ borderRadius: 20, overflow: "hidden", padding: 20 }}
      >
        <Text style={{ color: "#0f172a" }}>Blurred content surface</Text>
      </BlurView>
    </View>
  );
}
```

## Props

| Prop            | Type                                   | Description                                              |
| --------------- | -------------------------------------- | -------------------------------------------------------- |
| `intensity`     | `number`                               | Blur intensity hint. Used by supported platforms.        |
| `tint`          | `"default" \| "light" \| "dark"`       | Tint mode applied to the blur surface.                   |
| `variant`       | `"blur" \| "glass"`                    | Higher-level presentation style hint.                    |
| `tintColor`     | `string`                               | Optional custom tint color for supported platforms.      |
| `style`         | `Style`                                | Container styling, including clipping and border radius. |
| `pointerEvents` | `auto \| none \| box-none \| box-only` | Touch event propagation behavior.                        |
| `children`      | `JSX.Element`                          | Content rendered inside the blur surface.                |

## Platform Notes

- **iOS**: Uses a native blur-backed view.
- **Web**: Uses CSS `backdrop-filter`.
- **Android**: Falls back to a regular container view. The same SolidJS API is preserved, but no native blur is applied by default.
