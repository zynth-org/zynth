# TextInput

`TextInput` is the native text entry primitive used by Zynth. It supports controlled and uncontrolled usage, native selection updates, secure entry, multiline input, and synchronous UI-thread handlers for custom text mutation.

## Basic Usage

```tsx
import { createSignal } from "solid-js";
import { TextInput, View, Text } from "@zynth/components";

function UsernameField() {
  const [value, setValue] = createSignal("");

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Username"
      />
      <Text>{value()}</Text>
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

## Native Sync Signals

For the tightest integration with the native text buffer, use `createSyncSignal` from `@zynth/core`.

```tsx
import { createSyncSignal } from "@zynth/core";
import { TextInput, View, Show, Text } from "@zynth/components";

function UsernameInput() {
  const [text, setText] = createSyncSignal("");

  return (
    <View>
      <TextInput value={text} onChangeText={setText} />
      <Show when={text().length > 0 && text().length < 4}>
        <Text style={{ color: "red" }}>Username is too short.</Text>
      </Show>
    </View>
  );
}
```

`createSyncSignal` is intended for cases where the JS signal should stay in lockstep with the native text buffer and still participate in Solid reactivity.

## Input Handlers

`createInputHandler` creates a UI-thread worklet used by `TextInput`'s `handler` prop. This is the hook for rejecting, sanitizing, or reformatting input before the native view commits it.

```tsx
import { createInputHandler, createSyncSignal } from "@zynth/core";
import { TextInput, View } from "@zynth/components";

function TagInput() {
  const [text, setText] = createSyncSignal("");

  const sanitizeTag = createInputHandler((currentText, newChar) => {
    if (newChar === " ") return currentText;
    return (currentText + newChar).toLowerCase();
  });

  return (
    <View>
      <TextInput value={text} onChangeText={setText} handler={sanitizeTag} />
    </View>
  );
}
```

The callback receives the current text and the new input fragment. It should return the next text value.

## Example Patterns

### Validation

```tsx
<TextInput value={text} onChangeText={setText} />
<Show when={text().length > 0 && text().length < 4}>
  <Text style={{ color: "red" }}>Username is too short.</Text>
</Show>
```

### Sanitization

```tsx
const sanitizeTag = createInputHandler((currentText, newChar) => {
  if (newChar === " ") return currentText;
  return (currentText + newChar).toLowerCase();
});
```

### Formatting

```tsx
const formatCard = createInputHandler((currentText, newChar) => {
  const combined = (currentText + newChar).replace(/\D/g, "");
  if (combined.length > 16) return currentText;
  return combined.replace(/(.{4})/g, "$1 ").trim();
});
```

## Style Partitioning

`TextInput` is a primitive and sync-aware component. To ensure stability during reactive updates (especially when focused), the framework internally partitions decorative and text-editing styles using a two-layer native architecture.

- **Outer Layer (Host Container):** Responsible for layout, background, border, radius, shadow, and opacity.
- **Inner Layer (Editable Control):** Responsible for text-specific styles like `color`, `fontSize`, `fontWeight`, `fontFamily`, and `textAlign`.

This partitioning prevents reactive style updates (like changing a border color on focus) from destabilizing the native text editor or causing unexpected cursor jumps.

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `value` | `string` | Controlled text value. |
| `defaultValue` | `string` | Initial uncontrolled text value. |
| `placeholder` | `string` | Placeholder text shown when empty. |
| `multiline` | `boolean` | Enables multiline entry. |
| `numberOfLines` | `number` | Hint for multiline height. |
| `maxLength` | `number` | Native maximum text length. |
| `editable` | `boolean` | Enables or disables editing. |
| `secureTextEntry` | `boolean` | Masks text entry like a password field. |
| `inputMode` | `text` \| `numeric` \| `decimal` \| `tel` \| `email` \| `url` \| `search` | Keyboard/input mode hint. |
| `autoCapitalize` | `none` \| `sentences` \| `words` \| `characters` | Capitalization behavior. |
| `autoCorrect` | `boolean` | Enables native autocorrect. |
| `spellCheck` | `boolean` | Enables native spell checking. |
| `returnKeyType` | `default` \| `go` \| `next` \| `search` \| `send` \| `done` | Return key label. |
| `blurOnSubmit` | `boolean` | Blurs the field after submit. |
| `submitBehavior` | `newline` \| `submit` \| `none` | Submission behavior for multiline fields. |
| `selection` | `{ start: number; end: number }` | Programmatic selection range. |
| `selectionColor` | `string` | Selection highlight color. |
| `caretColor` | `string` | Caret color. |
| `placeholderTextColor` | `string` | Placeholder color. |
| `clearButtonMode` | `never` \| `while-editing` \| `unless-editing` \| `always` | Clear button visibility. |
| `showClearAccessory` | `boolean` | Shows a clear accessory on supported platforms. |
| `inputFilter` | `(proposed, change) => string \| false` | Low-level filter hook. |
| `handler` | `(currentText, newInput) => string` | UI-thread input transformation hook. |
| `onChangeText` | `(text: string) => void` | Called when text changes. |
| `onChange` | `(event) => void` | Native change event callback. |
| `onSelectionChange` | `(selection) => void` | Called when the caret or selection changes. |
| `onContentSizeChange` | `(width, height) => void` | Called for content size changes. |
| `onSubmitEditing` | `(text: string) => void` | Called when editing is submitted. |
| `onKeyPress` | `(event) => void` | Called on key press events. |
| `onFocus` | `() => void` | Called when the field gains focus. |
| `onBlur` | `() => void` | Called when the field loses focus. |
| `onCompositionStart` | `() => void` | Composition start event. |
| `onCompositionEnd` | `() => void` | Composition end event. |
| `eventThrottleMs` | `number` | Throttle for native event dispatch. |
| `allowProgrammaticJumpDuringEdit` | `boolean` | Allows programmatic value jumps while editing. |
| `ref` | `(node) => void` | Imperative ref to the native text input. |
| `style` | `Style` | Native style object. |
| `testID` | `string` | Test identifier for automation. |

## Imperative Ref

The ref exposes the native text input controller.

```tsx
let inputRef: TextInputRef | null = null;

<TextInput ref={(node) => (inputRef = node)} />

inputRef?.focus();
inputRef?.blur();
inputRef?.clear();
inputRef?.insertAtCursor("A");
inputRef?.replaceRange(0, 2, "Hi");
```

## Demo Screen

The components app includes a dedicated test screen at `apps/components/src/components/controls/TextInputSyncTests.tsx` that exercises:

1. Reactive validation with `createSyncSignal`
2. Sanitization with `createInputHandler`
3. Masking and formatting with `createInputHandler`

Use that screen to verify changes against real Android and iOS behavior.
