# TextField

`TextField` is a high-level text entry component that provides native styles and behaviors out of the box. Unlike the low-level `TextInput`, which is a bare primitive, `TextField` follows platform-specific design guidelines (such as Material 3 on Android) and includes built-in styling for focus states, labels, and containers.

## Basic Usage

`TextField` can be used as a controlled or uncontrolled component. For controlled usage, you can pass a standard Solid signal or use the `TextFieldRef` for imperative control.

```tsx
import { createSignal } from "solid-js";
import { TextField, View } from "@zynthjs/components";

function LoginScreen() {
  const [email, setEmail] = createSignal("");

  return (
    <View style={{ padding: 20 }}>
      <TextField
        value={email()}
        onChange={setEmail}
        placeholder="Email Address"
        keyboardType="email"
      />
    </View>
  );
}
```

## Visual Variants

On Android, `TextField` supports multiple Material Design variants through the `variant` prop.

```tsx
<TextField variant="filled" placeholder="Filled (Default)" />
<TextField variant="outlined" placeholder="Outlined" />
<TextField variant="none" placeholder="No Container (Android only)" />
```

_Note: On iOS, these variants map to standard native text field styles where applicable._

## Imperative Control with `useTextFieldRef`

For more advanced scenarios, such as programmatically focusing a field or clearing its content, use the `useTextFieldRef` hook and pass the resulting ref to the component.

```tsx
import { TextField, useTextFieldRef, Button, View } from "@zynthjs/components";

function SearchBar() {
  const ref = useTextFieldRef();

  return (
    <View>
      <TextField ref={ref} placeholder="Search..." />
      <Button title="Clear" onPress={() => ref.clear()} />
      <Button title="Focus" onPress={() => ref.focus()} />
    </View>
  );
}
```

## Props

| Prop               | Type                                                    | Description                                                |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| `value`            | `string`                                                | Controlled text value.                                     |
| `defaultValue`     | `string`                                                | Initial uncontrolled text value.                           |
| `placeholder`      | `string`                                                | Placeholder text (used as a floating label on Material 3). |
| `placeholderColor` | `string`                                                | Color of the placeholder text.                             |
| `variant`          | `"filled" \| "outlined" \| "none"`                      | Visual style variant. Defaults to `"filled"`.              |
| `disabled`         | `boolean`                                               | If `true`, the text field is disabled.                     |
| `editable`         | `boolean`                                               | If `false`, text cannot be edited. Defaults to `true`.     |
| `secureTextEntry`  | `boolean`                                               | If `true`, masks the text for password entry.              |
| `keyboardType`     | `"default" \| "numeric" \| "email" \| "phone" \| "url"` | Type of keyboard to display.                               |
| `returnKeyType`    | `"done" \| "go" \| "next" \| "search" \| "send"`        | Label for the return key.                                  |
| `autoCapitalize`   | `"none" \| "sentences" \| "words" \| "characters"`      | Automatic capitalization behavior.                         |
| `autoCorrect`      | `boolean`                                               | Whether to enable native autocorrect. Defaults to `true`.  |
| `maxLength`        | `number`                                                | Maximum number of characters allowed.                      |
| `onChange`         | `(value: string) => void`                               | Called when the text changes.                              |
| `onFocus`          | `() => void`                                            | Called when the field gains focus.                         |
| `onBlur`           | `() => void`                                            | Called when the field loses focus.                         |
| `onSubmit`         | `(event: { value: string }) => void`                    | Called when the return/submit key is pressed.              |
| `ref`              | `TextFieldRef`                                          | Ref for imperative control.                                |
| `style`            | `Style`                                                 | Custom styles for the container.                           |
| `testID`           | `string`                                                | Identifier for automated testing.                          |

## TextFieldRef API

The `TextFieldRef` (created via `useTextFieldRef`) provides the following methods:

| Method        | Type                      | Description                                     |
| ------------- | ------------------------- | ----------------------------------------------- |
| `text()`      | `() => string`            | Returns the current text value.                 |
| `setText()`   | `(value: string) => void` | Sets the text value programmatically.           |
| `focus()`     | `() => void`              | Programmatically focuses the text field.        |
| `blur()`      | `() => void`              | Programmatically blurs the text field.          |
| `clear()`     | `() => void`              | Clears the text field.                          |
| `isFocused()` | `() => boolean`           | Returns whether the field is currently focused. |
