# TextInput

`TextInput` is the native text entry primitive used by Zynth. It supports controlled and uncontrolled usage, native selection updates, secure entry, multiline input, and synchronous UI-thread handlers for custom text mutation.

## Basic Usage

For controlled inputs, always use `createSyncSignal` from `@zynth/core`. Standard Solid signals (`createSignal`) should be avoided for the `value` prop as they can cause cursor jumps and synchronization lag.

```tsx
import { createSyncSignal } from "@zynth/core";
import { TextInput, View, Text } from "@zynth/components";

function UsernameField() {
  // Use createSyncSignal for all controlled inputs
  const [value, setValue] = createSyncSignal("");

  return (
    <View>
      <TextInput value={value} onChangeText={setValue} placeholder="Username" />
      <Text>Current: {value()}</Text>
    </View>
  );
}
```

## Controlled And Uncontrolled

`TextInput` can be driven by a Solid signal through `value`, or initialized once with `defaultValue`.

```tsx
<TextInput value={value} onChangeText={setValue} />
<TextInput defaultValue="Hello" />
```

Use `value` when the parent should own the source of truth. Use `defaultValue` when the native field should manage its own state after mount.

### Reactivity and `createSyncSignal`

For **controlled** `TextInput` usage, it is highly recommended to use `createSyncSignal` instead of a standard `createSignal`.

Standard signals can cause undesirable effects such as cursor jumps, text flickers, or synchronization lag because they rely on asynchronous bridge communication. `createSyncSignal` is specifically designed for high-performance synchronization between the JavaScript environment and the native text buffer, ensuring that the field remains responsive and stable during rapid editing.

```tsx
import { createSyncSignal } from "@zynth/core";
import { TextInput } from "@zynth/components";

function ControlledInput() {
  // Use createSyncSignal for controlled inputs to ensure stability
  const [text, setText] = createSyncSignal("");

  return (
    <TextInput value={text} onChangeText={setText} placeholder="Type here..." />
  );
}
```

## Input Handlers (Worklets)

For text transformations, sanitization, or masking, use the `handler` prop combined with `createInputHandler`.

Because `createInputHandler` creates a **UI-thread worklet**, the transformation happens synchronously on the native side before the text is even committed to the buffer. This prevents the "jumping" effect often seen when using JavaScript-side `onChangeText` for formatting.

```tsx
import { createInputHandler, createSyncSignal } from "@zynth/core";
import { TextInput } from "@zynth/components";

function CreditCardInput() {
  const [text, setText] = createSyncSignal("");

  // Transformation happens on the native UI thread
  const formatCard = createInputHandler((currentText, newChar) => {
    const combined = (currentText + newChar).replace(/\D/g, "");
    if (combined.length > 16) return currentText;
    return combined.replace(/(.{4})/g, "$1 ").trim();
  });

  return (
    <TextInput
      value={text}
      onChangeText={setText}
      handler={formatCard}
      placeholder="XXXX XXXX XXXX XXXX"
    />
  );
}
```

## Props

| Prop                              | Type                                                                      | Description                                                                |
| --------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `value`                           | `string \| SyncSignalAccessor<string>`                                    | Controlled text value. **Prefer `createSyncSignal`** for stability.        |
| `defaultValue`                    | `string`                                                                  | Initial uncontrolled text value.                                           |
| `placeholder`                     | `string`                                                                  | Placeholder text shown when empty.                                         |
| `multiline`                       | `boolean`                                                                 | Enables multiline entry.                                                   |
| `numberOfLines`                   | `number`                                                                  | Hint for multiline height (rows).                                          |
| `maxLength`                       | `number`                                                                  | Native maximum text length.                                                |
| `editable`                        | `boolean`                                                                 | Enables or disables editing.                                               |
| `secureTextEntry`                 | `boolean`                                                                 | Masks text entry like a password field.                                    |
| `inputMode`                       | `text` \| `numeric` \| `decimal` \| `tel` \| `email` \| `url` \| `search` | Keyboard/input mode hint.                                                  |
| `autoCapitalize`                  | `none` \| `sentences` \| `words` \| `characters`                          | Capitalization behavior.                                                   |
| `autoCorrect`                     | `boolean`                                                                 | Enables native autocorrect.                                                |
| `spellCheck`                      | `boolean`                                                                 | Enables native spell checking.                                             |
| `returnKeyType`                   | `default` \| `go` \| `next` \| `search` \| `send` \| `done`               | Return key label.                                                          |
| `blurOnSubmit`                    | `boolean`                                                                 | Blurs the field after submit.                                              |
| `submitBehavior`                  | `newline` \| `submit` \| `none`                                           | Submission behavior for multiline fields.                                  |
| `selection`                       | `{ start: number; end: number }`                                          | Programmatic selection range.                                              |
| `selectionColor`                  | `string`                                                                  | Selection highlight color (Hex).                                           |
| `caretColor`                      | `string`                                                                  | Caret (cursor) color (Hex).                                                |
| `placeholderTextColor`            | `string`                                                                  | Placeholder text color (Hex).                                              |
| `clearButtonMode`                 | `never` \| `while-editing` \| `unless-editing` \| `always`                | (iOS) Clear button visibility.                                             |
| `showClearAccessory`              | `boolean`                                                                 | Shows a clear accessory on supported platforms.                            |
| `handler`                         | `(current, next) => string`                                               | **Worklet** for UI-thread input transformation (via `createInputHandler`). |
| `onChangeText`                    | `(text: string) => void`                                                  | Called when text changes.                                                  |
| `onChange`                        | `(event: TextChangeEvent) => void`                                        | Native change event callback with delta details.                           |
| `onSelectionChange`               | `(selection: Selection) => void`                                          | Called when the caret or selection changes.                                |
| `onContentSizeChange`             | `(width: number, height: number) => void`                                 | Called when multiline content size changes.                                |
| `onSubmitEditing`                 | `(text: string) => void`                                                  | Called when the return key is pressed.                                     |
| `onKeyPress`                      | `(event: KeyEvent) => void`                                               | Called on native key press events.                                         |
| `onFocus`                         | `() => void`                                                              | Called when the field gains focus.                                         |
| `onBlur`                          | `() => void`                                                              | Called when the field loses focus.                                         |
| `onCompositionStart`              | `() => void`                                                              | Called when IME composition starts.                                        |
| `onCompositionEnd`                | `() => void`                                                              | Called when IME composition ends.                                          |
| `selectTextOnFocus`               | `boolean`                                                                 | Automatically selects all text when focused.                               |
| `eventThrottleMs`                 | `number`                                                                  | Throttles native event dispatch to JS.                                     |
| `allowProgrammaticJumpDuringEdit` | `boolean`                                                                 | Allows JS to overwrite the buffer while the user is typing.                |
| `style`                           | `StyleProp \| Accessor<StyleProp>`                                        | Component styles.                                                          |
| `testID`                          | `string`                                                                  | Test identifier for automation.                                            |
| `debugSync`                       | `boolean`                                                                 | Enables console logging for synchronization events.                        |

## Imperative Ref

The `ref` exposes the `TextInputRef` interface for imperative control.

```tsx
export type TextInputRef = {
  text: () => string;
  setText: (value: string) => void;
  selection: () => Selection;
  setSelection: (sel: Selection) => void;
  isEditing: () => boolean;
  isComposing: () => boolean;
  hasPendingSync: () => boolean;
  focus: () => void;
  blur: () => void;
  clear: () => void;
  insertAtCursor: (text: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  commit: () => void;
  cancelPending: () => void;
};
```

### Usage

```tsx
let inputRef: (HostNode & TextInputRef) | null = null;

<TextInput ref={(node) => (inputRef = node)} />;

// Focus the input
inputRef?.focus();

// Insert text at current cursor position
inputRef?.insertAtCursor("Hello");

// Clear text
inputRef?.clear();
```
