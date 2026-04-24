# Switch

`Switch` is a boolean selection primitive mapping to `UISwitch` on iOS and Material Switch on Android. It provides a native toggle interface for Boolean configuration with customizable states for the track and thumb.

## Basic Usage

The component is used as a controlled boolean input with the `value` and `onValueChange` props.

```tsx
import { Switch, View, Text } from "@zynthjs/components";

function SettingsToggle() {
  const [notifications, setNotifications] = createSignal(true);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text>Enable Notifications</Text>
      <Switch 
        value={notifications()} 
        onValueChange={setNotifications} 
      />
    </View>
  );
}
```

## Coloring States

The `trackColor` and `thumbColor` props can be either a string (applying to the `true` state) or an object specifying individual `false` and `true` values.

```tsx
<Switch
  value={isOn()}
  onValueChange={setIsOn}
  trackColor={{ 
    false: "#767577", 
    true: "#81b0ff" 
  }}
  thumbColor={{ 
    false: "#f4f3f4", 
    true: "#f5dd4b" 
  }}
/>
```

## Disabling Interaction

Set the `disabled` prop to prevent user interaction while maintaining the current visual state.

```tsx
<Switch 
  value={true} 
  disabled={true} 
  onValueChange={() => {}} 
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `value` | `boolean` | Controlled value (boolean) of the switch. |
| `onValueChange` | `(next) => void` | Triggered on value change. |
| `disabled` | `boolean` | Disables user interaction. |
| `trackColor` | `string \| {false, true}`| Appearance for the switch background track. |
| `thumbColor` | `string \| {false, true}`| Appearance for the switch handle. |
| `style` | `Style` | Styling for the container. |
| `testID` | `string` | Identifier for automation testing. |
