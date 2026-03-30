# KeyboardAwareScrollView

An enhanced ScrollView that automatically calculates and maintains focus visibility during keyboard events.

`KeyboardAwareScrollView` is the most comprehensive solution for forms and long scrollable content. Unlike a standard `ScrollView`, it detects which input is focused and ensures it remains visible above the keyboard, even during complex animations.

## Basic usage

Wrap your form content with `KeyboardAwareScrollView` to enable automatic scrolling to focused inputs.

```tsx
import { KeyboardAwareScrollView } from "@zynth/keyboard";
import { TextInput, View } from "@zynth/components";

function FeedbackForm() {
  return (
    <KeyboardAwareScrollView style={{ flex: 1 }}>
      <View style={{ padding: 20, gap: 16 }}>
        <TextInput placeholder="Subject" />
        <TextInput 
          placeholder="Detailed Message" 
          multiline 
          style={{ height: 200 }} 
        />
        <TextInput placeholder="Contact Info" />
      </View>
    </KeyboardAwareScrollView>
  );
}
```

## Advanced

### Customizing Scroll Buffers

Use `extraScrollHeight` to add a fixed amount of space above the keyboard when an input is focused. This prevents the input from being flushed against the keyboard edge.

```tsx
<KeyboardAwareScrollView 
  extraScrollHeight={100}
  scrollToInputOnFocus={true}
  showsVerticalScrollIndicator={false}
>
  {/* Form fields */}
</KeyboardAwareScrollView>
```

### Account for External Offsets

If you have a sticky header or a custom navigation bar taking up space at the top of the screen, specify `keyboardVerticalOffset` to calibrate the scroll calculations correctly.

## Special cases

- **Native Performance**: Unlike JS-only implementations that poll for focus, `KeyboardAwareScrollView` uses a native backing view (`zynth-keyboard-aware-scroll-view`) to receive focus events synchronously with the OS keyboard window, resulting in zero-latency scrolling.
- **Input Detection**: All native Zynth inputs (like `TextInput`) work automatically with this component. Third-party or custom components that emit standard focus events are also supported.

## API Reference

### `KeyboardAwareScrollView` Props

- `enabled?: boolean`
  Enables or disables keyboard-aware behavior. Default is `true`.
- `extraScrollHeight?: number`
  Extra distance above the keyboard when scrolling to a focused input. Default is `75`.
- `keyboardVerticalOffset?: number`
  Offset to account for fixed UI elements (like headers). Default is `0`.
- `scrollToInputOnFocus?: boolean`
  Whether to automatically scroll when an input receives focus. Default is `true`.
- `scrollEnabled?: boolean`
  Common ScrollView prop to enable/disable manual scrolling. Default is `true`.
- `showsVerticalScrollIndicator?: boolean`
  Whether to show the scroll bar. Default is `true`.
- `bounces?: boolean`
  Whether the scroll view bounces at the edges (iOS specific). Default is `true`.
- `contentInset?: { top?, left?, bottom?, right? }`
  Custom insets for the scroll content.
- `contentContainerStyle?: Style`
  Styles for the inner content wrapper.
- `style?: Style`
  Styles for the outer scroll container.
- `children?: JSX.Element`
  Children to render inside the scroll view.
