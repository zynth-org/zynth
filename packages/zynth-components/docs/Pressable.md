# Pressable

`Pressable` is the fundamental interaction primitive. It detects various gesture events (taps, long presses, double presses, and hovers) while providing granular state tracking. To ensure responsiveness, all interaction states follow reactive proxies, allowing for low-latency visual feedback on any platform.

## Basic Usage

The component is at its simplest as a wrapper for detecting primary tap gestures:

```tsx
import { Pressable, Text, View } from "@zynth/components";

function ActionItem() {
  const handlePress = () => console.log("Action triggered");

  return (
    <Pressable 
      onPress={handlePress} 
      style={{ padding: 16, backgroundColor: "#eee" }}
    >
      <Text>Tap here</Text>
    </Pressable>
  );
}
```

## Functional Styling Based on State

To create dynamic visual feedback without manual state management, both `style` and `stateLayerStyle` can be functions that receive the current interaction state (`pressed`, `hovered`, `focused`, `disabled`).

```tsx
<Pressable
  style={(state) => ({
    padding: 12,
    borderRadius: 8,
    backgroundColor: state.pressed ? "#ccc" : "#eee",
    opacity: state.disabled ? 0.5 : 1,
    transform: [{ scale: state.pressed ? 0.98 : 1 }]
  })}
>
  <Text>Responsive Feedback</Text>
</Pressable>
```

## Advanced Gesture Control

`Pressable` supports several high-level gesture refinements:

- **Double Press**: Enable with `enableDoublePress` and tune the `doublePressWindowMs`.
- **Long Press**: Configure the minimum required hold time with `longPressMinDurationMs`.
- **Hit Slop**: Expand the interactive touchable area beyond the visible boundaries (crucial for accessibility on small targets).

```tsx
<Pressable
  onDoublePress={() => console.log("Double tap!")}
  enableDoublePress={true}
  doublePressWindowMs={200}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} // Easier to tap
>
  <Text>Advanced Gestures</Text>
</Pressable>
```

## Native Interaction Feedback

On supported platforms, `Pressable` can trigger native visual effects like material ripples or highlight overlays via the `pressEffect` prop.

```tsx
<Pressable 
  pressEffect="ripple" 
  onPress={onPress} 
  style={{ height: 60, justifyContent: "center" }}
>
  <Text>Native Ripple (Android)</Text>
</Pressable>

<Pressable 
  pressEffect="highlight" 
  onPress={onPress}
>
  <Text>Native Highlight (iOS)</Text>
</Pressable>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | Content placed inside the interaction area. |
| `disabled` | `boolean` | If true, all interactive events are blocked. |
| `onPress` | `(event) => void` | Primary tap action. |
| `onLongPress` | `({ durationMs }) => void` | Hold gesture action. |
| `onDoublePress` | `(event) => void` | Sequential tap action. |
| `onHoverIn` / `onHoverOut`| `() => void` | Mouse/stylus cursor entry/exit. |
| `onFocus` / `onBlur`| `() => void` | Keyboard or programmatic focus changes. |
| `style` | `Style \| (state) => Style` | Reactive styling based on interaction. |
| `hitSlop` | `number \| HitSlop` | Insets to expand the touch area. |
| `pressEffect` | `none \| ripple \| highlight` | Native interaction visuals. |
| `enableGlassIOS` | `boolean` | Enables native glass effects on tap (iOS). |
| `role` | `button \| link \| menuitem \| none` | Semantic role for accessibility. |

## Imperative Ref

A `ref` provides an interface to query or trigger the component's state programmatically:

- `pressed()`: Returns true ifcurrently held.
- `hovered()`: Returns true on cursor entry.
- `focused()`: Returns true during focus focus.
- `click()`: Triggers the `onPress` sequence manually.
- `cancel()`: Immediately terminates the current press event sequence.
- `focus()` / `blur()`: Manually manages focus.
- `setDisabled(boolean)`: Programmatically toggles the interaction state.
