# Keyboard Hooks

Granular reactive hooks for consuming keyboard state within Zynth components.

These hooks provide a SolidJS-friendly interface to the keyboard subsystem. They are highly optimized to ensure that components only re-render when the specific piece of state they consume changes.

> [!IMPORTANT]
> All keyboard hooks must be used within a component wrapped by the `KeyboardProvider`.

## Basic usage

### Consuming Full State

The `useKeyboard` hook returns a reactive accessor to the complete keyboard state.

```tsx
import { useKeyboard } from "@zynthjs/keyboard";

function KeyboardMonitor() {
  const keyboard = useKeyboard();
  
  return (
    <View>
      <Text>Is Visible: {keyboard().isVisible ? "Yes" : "No"}</Text>
      <Text>Height: {keyboard().height}dp</Text>
    </View>
  );
}
```

## Advanced

### Optimized Hooks

For better performance, use specialized hooks if you only need a specific property. This prevents unnecessary re-renders when other keyboard properties change (e.g., watching `isVisible` won't trigger re-renders just because the `height` is still calculating during an animation).

```tsx
import { useKeyboardVisible, useKeyboardHeight } from "@zynthjs/keyboard";

function VisibilityToggle() {
  const isVisible = useKeyboardVisible();
  
  return (
    <View style={{ opacity: isVisible() ? 1 : 0.5 }}>
      <Text>I only care if the keyboard is open.</Text>
    </View>
  );
}
```

### Checking Animation State

Use `useKeyboardAnimating` to pause heavy UI transitions or expensive calculations while the keyboard is in motion.

```tsx
import { useKeyboardAnimating } from "@zynthjs/keyboard";

function PerformanceAwareComponent() {
  const isAnimating = useKeyboardAnimating();
  
  return (
    <View>
      {isAnimating() ? <Text>Syncing...</Text> : <HeavyList />}
    </View>
  );
}
```

## API Reference

### `useKeyboard()`
Returns a reactive accessor to the raw `KeyboardState`.
- **Returns**: `Accessor<KeyboardState>`

### `useKeyboardVisible()`
Returns a reactive accessor for the visibility boolean.
- **Returns**: `Accessor<boolean>`

### `useKeyboardHeight()`
Returns a reactive accessor for the current height in dp.
- **Returns**: `Accessor<number>`

### `useKeyboardAnimating()`
Returns a reactive accessor indicating if a transition is in progress.
- **Returns**: `Accessor<boolean>`

### `KeyboardState` Structure
```ts
{
  isVisible: boolean;    // Whether the keyboard is on screen
  height: number;       // Height in dp
  isAnimating: boolean; // Whether active transition is happening
  duration: number;     // OS animation duration
  easing: string;       // OS animation easing curve
}
```
