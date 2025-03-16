# FlatList Controller - Quick Reference

## Setup

```tsx
import { FlatList, createFlatListController } from "@rune/components";

const controller = createFlatListController();

<FlatList controller={controller} ... />
```

## Common Operations

### Jump to Specific Item

```tsx
// At top
controller.scrollToIndex({ index: 25 });

// Centered with animation
controller.scrollToIndex({
  index: 25,
  viewPosition: 0.5,
  animated: true,
});

// At bottom with padding
controller.scrollToIndex({
  index: 25,
  viewPosition: 1,
  viewOffset: -20,
  animated: true,
});
```

### Edge Navigation

```tsx
// Jump to top/start
controller.scrollToTop({ animated: true });

// Jump to bottom/end
controller.scrollToEnd({ animated: true });
```

### Direct Offset Control

```tsx
// Jump to 500px
controller.scrollToOffset({ offset: 500, animated: true });
```

### Visual Feedback

```tsx
// Flash scroll indicators
controller.flashScrollIndicators();
```

### Recalculation

```tsx
// Force viewability recompute
controller.recomputeViewableItems();
```

### Advanced Access

```tsx
// Access underlying scroll controller
const scrollController = controller.getNativeScrollRef();
const metrics = scrollController?.metrics();
```

## Parameters Reference

### `scrollToIndex` Options

| Option         | Type      | Default  | Description                                     |
| -------------- | --------- | -------- | ----------------------------------------------- |
| `index`        | `number`  | required | Target item (0-based)                           |
| `viewPosition` | `number`  | `0`      | Viewport position (0=top, 0.5=center, 1=bottom) |
| `viewOffset`   | `number`  | `0`      | Additional pixel offset (+ inset, - outset)     |
| `animated`     | `boolean` | `false`  | Animate the scroll                              |

### Edge Case Handling

✅ **Auto-clamping**: Index and offset values are automatically clamped to valid ranges  
✅ **Pre-mount safety**: Methods warn but don't error if called before mount  
✅ **Data length**: Controller tracks data length and prevents out-of-bounds scrolls  
✅ **Horizontal support**: Automatically uses X axis for horizontal lists

## Patterns

### Scroll-to-Top Button

```tsx
const [showButton, setShowButton] = createSignal(false);

createEffect(() => {
  setShowButton(listState.offset() > 500);
});

{
  showButton() && (
    <Button onPress={() => controller.scrollToTop({ animated: true })}>
      ↑ Top
    </Button>
  );
}
```

### Deep Link

```tsx
onMount(() => {
  const itemId = getUrlParam("item");
  const index = data.findIndex((item) => item.id === itemId);
  if (index >= 0) {
    setTimeout(() => {
      controller.scrollToIndex({ index, viewPosition: 0.3 });
      controller.flashScrollIndicators();
    }, 100);
  }
});
```

### Keyboard Navigation

```tsx
const handleKey = (key: string) => {
  const current = listState.firstVisibleIndex() ?? 0;

  switch (key) {
    case "ArrowUp":
      controller.scrollToIndex({
        index: Math.max(0, current - 1),
        animated: true,
      });
      break;
    case "ArrowDown":
      controller.scrollToIndex({
        index: current + 1,
        animated: true,
      });
      break;
    case "Home":
      controller.scrollToTop({ animated: true });
      break;
    case "End":
      controller.scrollToEnd({ animated: true });
      break;
  }
};
```

## Performance Notes

- ✅ No virtualization disruption
- ✅ Works during drag and momentum scrolling
- ✅ Native 60fps animation
- ✅ No reconciliation triggered
- ✅ Pool size remains constant

## Dos and Don'ts

### ✅ Do

- Create controller once outside render
- Call methods in event handlers or effects
- Use with `state` prop for read access
- Animate for better UX

### ❌ Don't

- Recreate controller on every render
- Call before FlatList mounts
- Make rapid successive calls
- Forget to pass controller to FlatList

## TypeScript Support

All methods are fully typed:

```tsx
controller.scrollToIndex({
  index: 10,
  viewPosition: 0.5, // ← Autocomplete + type checking
  animated: true,
});
```

## See Also

- 📖 [Full API Documentation](./flatlist-controller-api.md)
- 📝 [Implementation Details](./flatlist-controller-implementation.md)
- 🎯 [Performance Rules](./flatlist-performance-rules.md)
- 💡 [Demo Component](../apps/components/src/components/lists/FlatListController.tsx)
