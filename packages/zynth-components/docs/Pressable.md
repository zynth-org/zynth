# Pressable

`Pressable` is a versatile interaction wrapper that detects various stages of press interactions across all platforms. It is designed to replace legacy touchable components with a more performant, state-aware primitive.

## Basic Usage

The component provides a `style` prop that can be a function, allowing you to change the appearance based on the interaction state.

```tsx
import { Pressable, Text } from "@zynthjs/components";

function SimpleButton() {
  return (
    <Pressable
      onPress={() => console.log("Pressed")}
      style={(state) => ({
        padding: 16,
        borderRadius: 8,
        backgroundColor: state.pressed ? "#ddd" : "#eee",
        transform: [{ scale: state.pressed ? 0.98 : 1 }]
      })}
    >
      <Text>Interaction State</Text>
    </Pressable>
  );
}
```

## Interaction States

`Pressable` tracks several states that are passed to the style function or children accessor:

- `pressed`: True when the user is actively pressing the component.
- `hovered`: True when a pointer (mouse/trackpad) is over the component.
- `focused`: True when the component has keyboard focus.
- `disabled`: True when the component is in a disabled state.
- `longPressActive`: True during a long press duration.

## Advanced Press Behaviors

You can configure detailed press behaviors like hit slop, retention offsets, and delays.

```tsx
<Pressable
  hitSlop={20} // Expands touch area by 20pt
  delayLongPressMs={1000}
  pressRetentionOffset={30}
  onLongPress={() => console.log("Long Press!")}
>
  <Text>Advanced Config</Text>
</Pressable>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `onPress` | `(event) => void` | Called when a press is completed. |
| `onPressIn` | `(event) => void` | Called immediately when a press starts. |
| `onPressOut` | `(event) => void` | Called when a press is released. |
| `onLongPress` | `(event) => void` | Called after a sustained press. |
| `style` | `Style \| (state) => Style` | Standard or state-dependent style. |
| `disabled` | `boolean` | Disables all interactions. |
| `hitSlop` | `number \| HitSlop` | Expands the interactive area. |
| `delayLongPressMs`| `number` | Duration required for a long press. |
| `pressEffect` | `ripple \| highlight \| none` | Native feedback effect. |

