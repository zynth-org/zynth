# Keyboard

The keyboard subsystem in Zynth provides a high-performance bridge for physical and virtual keyboard state, enabling granular reactivity and layout adjustments during keyboard transitions.

Zynth's keyboard management is built on three pillars:
- **`KeyboardProvider`**: A reactive context that tracks visibility, height, and animation state.
- **`Keyboard`**: A static controller for imperative actions like dismissing the keyboard.
- **Native Synchronization**: Frame-precise height updates that synchronize with the underlying OS window manager.

## Basic usage

### Providing Keyboard Context

To enable reactive keyboard features, you must wrap your component tree with the `KeyboardProvider`. This is typically done at the root level of your application.

```tsx
import { KeyboardProvider } from "@zynth/keyboard";

function App() {
  return (
    <KeyboardProvider>
      <MainScreen />
    </KeyboardProvider>
  );
}
```

### Imperative Management

For non-component logic or simple actions, use the `Keyboard` (aliased from `KeyboardController`) controller.

```ts
import { Keyboard } from "@zynth/keyboard";

// Hide the keyboard regardless of current focus
Keyboard.dismiss();

// Synchronously check visibility
if (Keyboard.isVisible()) {
  console.log("Keyboard height is:", Keyboard.getHeight());
}
```

## Advanced

### Event Listening

While hooks are preferred for UI reactivity, you can subscribe to keyboard events globally using the controller. This is useful for analytics or low-level layout engine modifications.

```ts
import { Keyboard } from "@zynth/keyboard";

const unsubscribe = Keyboard.addListener((state) => {
  if (state.isVisible) {
    console.log(`Keyboard opened with height: ${state.height}`);
  }
});

// Later: unsubscribe();
```

## Special cases

- **Initialization Delay**: On some platforms, the native bridge might take a few frames to initialize. `KeyboardProvider` includes a retry mechanism to prevent state synchronization issues during app startup.
- **Platform Insets**: Keyboard height reported by Zynth is the raw height of the keyboard window. If you are using a `SafeAreaProvider`, ensure you are not double-compensating for bottom home indicators.

## API Reference

### `KeyboardProvider` Props

- `children: JSX.Element`
  The components that will have access to the keyboard context.

### `Keyboard` (Controller)

- `dismiss(): void`
  Force-closes the software keyboard.
- `isVisible(): boolean`
  Returns whether the keyboard is currently active on screen.
- `getHeight(): number`
  Returns the current keyboard height in density-independent pixels (dp).
- `getState(): KeyboardState`
  Returns the full `KeyboardState` snapshot.
- `addListener(listener: KeyboardChangeListener): KeyboardUnsubscribe`
  Subscribes to all keyboard state changes including animation status.

### `KeyboardState`

- `isVisible: boolean`
- `height: number`
- `isAnimating: boolean`
- `duration: number` (Animation duration in ms)
- `easing: string` (Animation curve name)
