# KeyboardStickyView

A specialized layout primitive designed to stay pinned to the top of the keyboard as it animates.

`KeyboardStickyView` is perfect for toolbars, "send" input bars, or contextual menus that must remain accessible while the keyboard is open. It uses reactive translation to maintain its position relative to the keyboard's top edge.

## Basic usage

Place the `KeyboardStickyView` at the bottom of a container sibling to your main content.

```tsx
import { KeyboardStickyView } from "@zynth/keyboard";
import { View, TextInput, Button } from "@zynth/components";

function ChatScreen() {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        {/* Messages */}
      </ScrollView>
      
      <KeyboardStickyView>
        <View style={{ backgroundColor: "white", padding: 10, flexDirection: "row" }}>
          <TextInput style={{ flex: 1 }} placeholder="Type a message..." />
          <Button label="Send" />
        </View>
      </KeyboardStickyView>
    </View>
  );
}
```

## Advanced

### Using Offsets

You can use the `offset` prop to add breathing room between the keyboard and the sticky UI. Positive values move the view higher above the keyboard boundary.

```tsx
<KeyboardStickyView offset={12} style={{ paddingHorizontal: 16 }}>
  <FloatingToolbar />
</KeyboardStickyView>
```

## Special cases

- **Layout Hierarchy**: The component applies a `translateY` transformation. For best results, ensure the `KeyboardStickyView` is placed in a layout position where its transform won't be clipped by parent containers with `overflow: 'hidden'`.
- **Interaction**: Because it relies on the reactive `useKeyboard()` hook, the sticky behavior is frame-synced with the Host renderer's layout pass, ensuring smooth movement even during rapid keyboard toggling.

## API Reference

### `KeyboardStickyView` Props

- `offset?: number`
  Additional distance from the top of the keyboard (in dp). Default is `0`.
- `style?: Style`
  Base styles for the sticky container. Note that `translateY` will be applied internally.
- `children?: JSX.Element`
  Content that should stick to the keyboard.
- `testID?: string`
  Identifier for automated testing.
