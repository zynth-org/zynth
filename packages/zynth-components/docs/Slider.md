# Slider

`Slider` is a linear input component for selecting a single value from a continuous or stepped range. It maps directly to `UISlider` on iOS and `SeekBar` on Android, ensuring native fluidity and accurate touch tracking.

## Basic Usage

The component is primarily used as a controlled input with `minimumValue`, `maximumValue`, and `onValueChange`.

```tsx
import { Slider, Text, View } from "@zynth/components";

function VolumeControl() {
  const [volume, setVolume] = createSignal(50);

  return (
    <View style={{ padding: 20 }}>
      <Text>Volume: {Math.round(volume())}%</Text>
      <Slider
        minimumValue={0}
        maximumValue={100}
        value={volume()}
        onValueChange={setVolume}
      />
    </View>
  );
}
```

## Customizing Appearance

You can customize the visual style of the slider by setting the tint colors for the track and the thumb.

- `minimumTrackTintColor`: The color of the track to the left of the thumb (active).
- `maximumTrackTintColor`: The color of the track to the right of the thumb (inactive).
- `thumbTintColor`: The color of the draggable thumb.

```tsx
<Slider
  minimumTrackTintColor="#34c759" // Green
  maximumTrackTintColor="#e5e5ea" // Light Gray
  thumbTintColor="#ffffff"
  value={0.5}
/>
```

## Stepped Intervals

By setting the `step` prop, you can force the slider to snap to specific increments. A `step` of `0` (default) allows for continuous movement.

```tsx
<Slider
  minimumValue={0}
  maximumValue={10}
  step={1}
  onValueChange={(val) => console.log("Snapped to:", val)}
/>
```

## Completion Callbacks

Use `onSlidingComplete` to trigger actions only when the user finishes interacting with the slider (e.g., updating a database or starting a search) to avoid excessive processing during movement.

```tsx
<Slider
  onSlidingComplete={(finalValue) => {
    savePreference("brightness", finalValue);
  }}
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `value` | `number` | Controlled value of the slider. |
| `defaultValue` | `number` | Initial value for uncontrolled usage. |
| `minimumValue` | `number` | The lower bound of the range (default: 0). |
| `maximumValue` | `number` | The upper bound of the range (default: 1). |
| `step` | `number` | Step interval for snapping (default: 0). |
| `disabled` | `boolean` | If true, user interaction is disabled. |
| `minimumTrackTintColor` | `string` | Color for the active side of the track. |
| `maximumTrackTintColor` | `string` | Color for the inactive side of the track. |
| `thumbTintColor` | `string` | Color for the draggable handle. |
| `onValueChange` | `(val) => void`| Triggered continuously during movement. |
| `onSlidingComplete` | `(val) => void`| Triggered when the user releases the thumb. |
| `precision` | `number` | Decimal places for rounding (default: 5). |
| `style` | `Style` | Container styling. |
| `testID` | `string` | Identifier for automation testing. |
