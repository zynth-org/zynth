# KeyboardAvoidingView

A specialized container component that automatically adjusts its coordinate space or padding when the keyboard appears.

`KeyboardAvoidingView` solves the common problem of the keyboard covering input fields. It listens to reactive state updates from the keyboard subsystem and applies transformations to its children based on the selected behavior.

## Basic usage

By default, the view adds padding to the bottom of its container to push content upward.

```tsx
import { KeyboardAvoidingView } from "@zynth/keyboard";
import { TextInput, View } from "@zynth/components";

function LoginScreen() {
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
        <TextInput placeholder="Email" />
        <TextInput placeholder="Password" secureTextEntry />
      </View>
    </KeyboardAvoidingView>
  );
}
```

## Advanced

### Avoidance Behaviors

The `behavior` prop determines how the component reacts to the keyboard:

- **`padding`**: Increases the bottom padding of the view. This is the most stable behavior for simple layouts.
- **`position`**: Applies a `translateY` transformation to the entire view. Useful when you want the whole UI to slide up together.
- **`height`**: Dynamically reduces the height of the view, forcing flex-box children to recalculate their layout.

```tsx
<KeyboardAvoidingView 
  behavior="height" 
  keyboardVerticalOffset={64} // Account for navigation header height
>
  <View style={{ flex: 1 }}>
    {/* Content that needs to compress */}
  </View>
</KeyboardAvoidingView>
```

### Offsetting Transitions

If your application has a persistent UI element at the bottom (like a custom tab bar) or a fixed header, use `keyboardVerticalOffset` to prevent empty spaces or over-scrolling.

## Special cases

- **Nested Keyboards**: If multiple `KeyboardAvoidingView` components are nested, each will apply its own transformation. It is recommended to use only one per screen or use one `KeyboardAvoidingView` combined with `KeyboardStickyView`.
- **Native Implementation**: On iOS and Android, Zynth uses a native view implementation (`zynth-keyboard-avoiding-view`) for hardware-accelerated transitions that remain perfectly in sync with the OS keyboard animation.

## API Reference

### `KeyboardAvoidingView` Props

- `behavior?: "padding" | "position" | "height"`
  The strategy used to avoid the keyboard. Default is `"padding"`.
- `enabled?: boolean`
  Whether the avoidance logic is active. Default is `true`.
- `keyboardVerticalOffset?: number`
  The distance between the top of the keyboard and the bottom of the view (in dp).
- `contentContainerStyle?: Style`
  Used only when `behavior="height"` to style the internal wrapper.
- `style?: Style`
  Styles for the main container.
- `children?: JSX.Element`
  Children to render inside the view.
- `testID?: string`
  Identifier for automated testing.
