# @zynth/keyboard

Keyboard handling for Zynth applications.

This package provides tools to manage the virtual keyboard on mobile devices, including monitoring its state (height, visibility), dismissing it, and adjusting layouts to prevent content from being obscured.

## Features

*   **Reactivity**: Hooks like `useKeyboard` provide reactive access to keyboard state.
*   **Components**: `KeyboardAvoidingView` and `KeyboardAwareScrollView` automatically adjust content.
*   **Controller**: Imperative `Keyboard` API for dismissing or querying the keyboard.

## Usage

### Hooks

```tsx
import { useKeyboardHeight, useKeyboardVisible } from "@zynth/keyboard";

function MyComponent() {
  const height = useKeyboardHeight();
  const isVisible = useKeyboardVisible();

  return (
    <View style={{ paddingBottom: height() }}>
      <Text>Keyboard is {isVisible() ? "Open" : "Closed"}</Text>
    </View>
  );
}
```

### KeyboardAvoidingView

Automatically adjusts its height or position based on the keyboard.

```tsx
import { KeyboardAvoidingView } from "@zynth/keyboard";

<KeyboardAvoidingView behavior="padding">
  <TextInput placeholder="Type here..." />
</KeyboardAvoidingView>
```

### Imperative API

```tsx
import { Keyboard } from "@zynth/keyboard";

// Dismiss the keyboard
Keyboard.dismiss();
```
