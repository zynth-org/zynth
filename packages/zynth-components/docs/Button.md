# Button

`Button` is the primary interactive primitive in Zynth, designed for responsive native interactions. It features a wide range of visual variants, built-in loading states with automatic async tracking, haptic feedback, and advanced press behaviors like debouncing and throttling.

## Basic Usage

The component supports a simplified label prop or standard children. By default, it uses the `primary` tone and `solid` variant.

```tsx
import { Button, View, SystemIcon } from "@zynth/components";

function ActionButtons() {
  const handlePress = () => {
    console.log("Button pressed");
  };

  return (
    <View style={{ gap: 12 }}>
      {/* Standard label usage */}
      <Button label="Click Me" onPress={handlePress} />

      {/* Children usage for complex content */}
      <Button onPress={handlePress} tone="success">
        Confirm Action
      </Button>

      {/* Icon only button */}
      <Button iconOnly startIcon={<SystemIcon name="plus" style={{ width: 24, height: 24 }} />} onPress={handlePress} />
    </View>
  );
}
```

## Async State Management

`Button` includes a powerful state management system for asynchronous operations. If the `onPress` handler returns a `Promise`, the button can automatically enter a loading state and disable itself to prevent double-submissions.

This behavior is controlled via the `pendingBehavior` prop, which defaults to `{ mode: "auto", blockWhilePending: true }`.

```tsx
function SaveButton() {
  const handleSave = async () => {
    // Button automatically becomes loading during this async operation
    await api.saveData();
  };

  return (
    <Button 
      onPress={handleSave} 
      variant="outline"
      loadingPlacement="start"
    >
      Save Changes
    </Button>
  );
}
```

## Press Behaviors

To prevent rapid-fire activations or accidental double-taps, `Button` provides built-in `debounce` and `throttle` modes via the `pressBehavior` prop.

```tsx
{/* Throttles calls to once every 1000ms */}
<Button 
  onPress={doAction} 
  pressBehavior={{ mode: "throttle", ms: 1000 }}
>
  Rate Limited
</Button>

{/* Only fires 500ms after the last tap */}
<Button 
  onPress={search} 
  pressBehavior={{ mode: "debounce", ms: 500 }}
>
  Search
</Button>
```

## Haptic Feedback

Native haptics can be triggered on press by setting the `haptics` prop. This provides tactile confirmation for user actions without requiring manual invocation of a haptics API.

```tsx
<Button haptics="medium" label="Impact" />
<Button haptics="success" label="Complete" />
<Button haptics="error" label="Failed" tone="danger" />
```

## Glass and Aesthetics

For modern, premium interfaces, `Button` supports native glass effects on iOS and advanced styling options like elevation and custom rounding.

```tsx
<Button 
  enableGlassIOS={true} 
  rounded="pill" 
  variant="ghost"
  label="Frosted Button" 
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `label` | `string` | The text label to display. |
| `children` | `JSX.Element` | Content to render inside the button. |
| `startIcon` | `JSX.Element` | Icon rendered before the label. |
| `endIcon` | `JSX.Element` | Icon rendered after the label. |
| `iconOnly` | `boolean` | If true, renders as a square button with only the icon. |
| `variant` | `solid` \| `outline` \| `ghost` \| `link` | The visual style of the button. |
| `tone` | `primary` \| `secondary` \| `success` \| `warning` \| `danger` \| `neutral` | The color theme of the button. |
| `size` | `xs` \| `sm` \| `md` \| `lg` \| `xl` | The physical dimensions of the button. |
| `loading` | `boolean` | Manually controls the loading state. |
| `disabled` | `boolean` | Disables user interaction. |
| `fullWidth` | `boolean` | Forces the button to take the full width of its container. |
| `rounded` | `none` \| `sm` \| `md` \| `lg` \| `pill` \| `full` | Corner radius preset. |
| `elevation` | `0` \| `1` \| `2` \| `3` | Shadow depth (Android-specific behavior). |
| `pressEffect` | `ripple` \| `highlight` \| `none` | Native touch feedback effect. |
| `haptics` | `none` \| `light` \| `medium` \| `heavy` \| `success` \| `warning` \| `error` | Haptic feedback style to trigger on press. |
| `onPress` | `(event) => void \| Promise<void>` | Callback triggered on activation. Returns a Promise for auto-loading. |
| `onLongPress` | `(event) => void` | Callback triggered on long press. |
| `pressBehavior` | `PressBehavior` | Configuration for debounce or throttle logic. |
| `pendingBehavior`| `PendingBehavior` | Controls how the button reacts to async results. |
| `hitSlop` | `number \| HitSlop` | Expands the touchable area beyond the visible bounds. |
| `minimumTouchSize`| `MinimumTouchSize` | Enforces a minimum accessible touch area (defaults to 44x36). |
| `style` | `Style` | Container styles. |
| `labelStyle` | `Style` | Styles applied to the internal label text. |
| `baseColor` | `string` | Explicit override for the button's base hex color. |
| `enableGlassIOS` | `boolean` | Enables native SF Symbol glass effects on supported iOS versions. |

## Imperative Ref

The `ref` exposes the `ButtonRef` interface for tracking internal state or triggering actions imperatively.

```tsx
export type ButtonRef = {
  pressed: () => boolean;    // Current press state
  focused: () => boolean;    // Current focus state
  hovered: () => boolean;    // Current hover state
  disabled: () => boolean;   // Current disabled state
  loading: () => boolean;    // Current loading state
  focus: () => void;         // Focus the button
  blur: () => void;          // Unfocus the button
  click: () => void;         // Programmatically trigger a press
  setLoading: (v: boolean) => void;
  setDisabled: (v: boolean) => void;
};
```

### Usage

```tsx
let buttonRef: (HostNode & ButtonRef) | null = null;

<Button ref={(node) => (buttonRef = node)} label="Submit" />

// Later in a handler
buttonRef?.setLoading(true);
buttonRef?.click();
```
