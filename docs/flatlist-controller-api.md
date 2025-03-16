# FlatList Controller API

## Overview

The FlatList controller provides an imperative API for programmatic scrolling and list manipulation. It enables deterministic control for testing, UX enhancements, and accessibility features while maintaining all performance invariants.

## Key Features

✅ **Pixel-perfect scrolling** - Uses same offset math as item binding  
✅ **No virtualization disruption** - Controller calls don't trigger pool changes  
✅ **Works during all phases** - Idle, drag, and momentum scrolling  
✅ **No flicker** - Leverages native animated scrolling  
✅ **Type-safe** - Full TypeScript support with detailed options

## Basic Usage

```tsx
import { FlatList, createFlatListController } from "@rune/components";

function MyList() {
  const controller = createFlatListController();

  return (
    <>
      <Button
        onPress={() => controller.scrollToIndex({ index: 10, animated: true })}
      >
        Jump to item 10
      </Button>

      <FlatList
        data={data}
        controller={controller}
        renderItem={({ item }) => <ItemView item={item} />}
        keyExtractor={(item) => item.id}
        itemSize={80}
      />
    </>
  );
}
```

## API Reference

### Creating a Controller

```tsx
const controller = createFlatListController();
```

Returns a `FlatListController` instance. Create one controller per FlatList and pass it via the `controller` prop.

### Methods

#### `scrollToIndex(options)`

Scroll to a specific item by index. The item will be positioned based on `viewPosition` and `viewOffset`.

**Options:**

- `index: number` - Target item index (0-based) **[required]**
- `viewPosition?: number` - Where in the viewport the item should land (0-1 range). Default: `0`
  - `0` = top/left edge
  - `0.5` = center
  - `1` = bottom/right edge
- `viewOffset?: number` - Additional pixel offset from the edge. Default: `0`
  - Positive values inset, negative values outset
- `animated?: boolean` - Animate the scroll. Default: `false`

**Examples:**

```tsx
// Scroll to item 20 at the top
controller.scrollToIndex({ index: 20 });

// Scroll to item 50 centered in the viewport
controller.scrollToIndex({
  index: 50,
  viewPosition: 0.5,
  animated: true,
});

// Scroll to item 10 near the bottom with 20px padding
controller.scrollToIndex({
  index: 10,
  viewPosition: 0.9,
  viewOffset: -20,
  animated: true,
});
```

#### `scrollToOffset(options)`

Scroll to an absolute pixel offset.

**Options:**

- `offset: number` - Target scroll offset in pixels **[required]**
- `animated?: boolean` - Animate the scroll. Default: `false`

**Example:**

```tsx
controller.scrollToOffset({ offset: 500, animated: true });
```

#### `scrollToTop(options?)`

Scroll to the start of the list (top for vertical, left for horizontal).

**Options:**

- `animated?: boolean` - Animate the scroll. Default: `false`

**Example:**

```tsx
controller.scrollToTop({ animated: true });
```

#### `scrollToEnd(options?)`

Scroll to the end of the list (bottom for vertical, right for horizontal).

**Options:**

- `animated?: boolean` - Animate the scroll. Default: `false`

**Example:**

```tsx
controller.scrollToEnd({ animated: true });
```

#### `flashScrollIndicators()`

Briefly flash the scroll indicators to draw user attention.

**Example:**

```tsx
controller.flashScrollIndicators();
```

#### `recomputeViewableItems()`

Force recomputation of which items are currently visible. Useful after external layout changes or when you need to synchronize viewability state.

**Example:**

```tsx
// After rotating the device or changing layout
onLayoutChange(() => {
  controller.recomputeViewableItems();
});
```

#### `recordInteraction()`

Record a user interaction timestamp. This is an extension point for analytics, accessibility, or gesture coordination. Currently a no-op but provided for future use.

**Example:**

```tsx
controller.recordInteraction();
```

#### `getNativeScrollRef()`

Escape hatch to access the underlying `ScrollController`. Use sparingly - prefer the typed methods above.

**Returns:** `ScrollController | null`

**Example:**

```tsx
const scrollController = controller.getNativeScrollRef();
if (scrollController) {
  const metrics = scrollController.metrics();
  console.log("Current offset:", metrics.offset);
}
```

## Advanced Patterns

### Scroll to Index with Offset

Center an item but add a 50px offset:

```tsx
controller.scrollToIndex({
  index: 25,
  viewPosition: 0.5,
  viewOffset: 50,
  animated: true,
});
```

### Implementing "Scroll to Top" Button

```tsx
function ListWithScrollToTop() {
  const controller = createFlatListController();
  const [showButton, setShowButton] = createSignal(false);
  const listState = createFlatListState();

  createEffect(() => {
    const offset = listState.offset();
    setShowButton(offset > 500); // Show after scrolling 500px
  });

  return (
    <>
      {showButton() && (
        <Button
          onPress={() => controller.scrollToTop({ animated: true })}
          style={{ position: "absolute", bottom: 20, right: 20 }}
        >
          ↑ Top
        </Button>
      )}

      <FlatList
        data={data}
        controller={controller}
        state={listState}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        itemSize={80}
      />
    </>
  );
}
```

### Pagination with Scroll Control

```tsx
function PaginatedList() {
  const controller = createFlatListController();
  const [page, setPage] = createSignal(0);
  const itemsPerPage = 20;

  const goToPage = (pageNum: number) => {
    setPage(pageNum);
    controller.scrollToIndex({
      index: pageNum * itemsPerPage,
      viewPosition: 0,
      animated: true,
    });
  };

  return (
    <>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button onPress={() => goToPage(page() - 1)} disabled={page() === 0}>
          Previous
        </Button>
        <Text>{page() + 1}</Text>
        <Button onPress={() => goToPage(page() + 1)}>Next</Button>
      </View>

      <FlatList
        data={data}
        controller={controller}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        itemSize={80}
      />
    </>
  );
}
```

### Deep Linking to Specific Item

```tsx
function DeepLinkableList() {
  const controller = createFlatListController();

  onMount(() => {
    const itemId = getUrlParam("item");
    if (itemId) {
      const index = data.findIndex((item) => item.id === itemId);
      if (index >= 0) {
        // Small delay to ensure list is mounted
        setTimeout(() => {
          controller.scrollToIndex({
            index,
            viewPosition: 0.3,
            animated: false,
          });
          controller.flashScrollIndicators();
        }, 100);
      }
    }
  });

  return (
    <FlatList
      data={data}
      controller={controller}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      itemSize={80}
    />
  );
}
```

## Performance Considerations

### ✅ Safe Operations (No Performance Impact)

- All controller methods are safe to call at any time
- Controller calls don't trigger reconciliation or pool changes
- Animated scrolls use native animation for 60fps
- Multiple rapid calls are handled gracefully

### ⚠️ Best Practices

1. **Create controller once** - Don't recreate the controller on every render
2. **Batch updates** - If calling multiple methods, call them in sequence
3. **Use animation wisely** - Animated scrolls look better but take more time
4. **Avoid rapid scrolls** - Give scrolls time to complete before issuing new ones

### ❌ Anti-Patterns

```tsx
// ❌ DON'T: Recreate controller every render
function Bad() {
  const controller = createFlatListController(); // Creates new controller each render!
  return <FlatList controller={controller} ... />;
}

// ✅ DO: Create controller once outside component or with createMemo
const controller = createFlatListController();
function Good() {
  return <FlatList controller={controller} ... />;
}

// ❌ DON'T: Call methods before controller is attached
const controller = createFlatListController();
controller.scrollToIndex({ index: 10 }); // Called before FlatList mounts!

// ✅ DO: Call methods after mount or in event handlers
onMount(() => {
  controller.scrollToIndex({ index: 10 });
});
```

## Testing

The controller API is designed for deterministic testing:

```tsx
describe('FlatList scroll behavior', () => {
  it('scrolls to specific index', () => {
    const controller = createFlatListController();

    render(<FlatList data={data} controller={controller} ... />);

    controller.scrollToIndex({ index: 10 });

    // Assert position
    const metrics = controller.getNativeScrollRef()?.metrics();
    expect(metrics?.offset.y).toBe(10 * itemSize);
  });

  it('centers item in viewport', () => {
    const controller = createFlatListController();

    render(<FlatList data={data} controller={controller} ... />);

    controller.scrollToIndex({
      index: 10,
      viewPosition: 0.5
    });

    // Assert centered
    const metrics = controller.getNativeScrollRef()?.metrics();
    const expectedOffset = (10 * itemSize) - (metrics.viewportSize.height / 2);
    expect(metrics?.offset.y).toBeCloseTo(expectedOffset);
  });
});
```

## Implementation Notes

### Offset Math Consistency

The controller uses **exactly the same offset calculations** as the item binding system:

```ts
// Item binding position (from FlatList.tsx)
const position = index * itemSize;

// Controller scroll calculation (from controller.ts)
const itemOffset = index * itemSize;
const viewportAdjustment = viewPosition * viewportSize;
const targetOffset = itemOffset - viewportAdjustment + viewOffset;
```

This ensures pixel-perfect alignment between bound items and controller-driven scrolls.

### Integration with Existing Systems

- **ScrollController**: The FlatList controller wraps and extends the base ScrollController
- **FlatListState**: Controller and state are independent but complementary
- **Recycling**: Controller operations don't interfere with node recycling
- **Viewability**: `recomputeViewableItems()` triggers the same effect that scroll events do

## Migration Guide

If you were previously accessing scroll methods directly:

```tsx
// Old approach (if you were doing this)
const scrollController = createScrollController();
scrollController.scrollTo({ y: index * itemSize });

// New approach
const controller = createFlatListController();
controller.scrollToIndex({ index });
```

The new API is preferable because:

- Type-safe with better autocomplete
- Handles edge cases (clamping, horizontal vs vertical)
- Clearer intent in code
- Better testability

## Troubleshooting

### Controller methods do nothing

**Cause:** Controller called before FlatList mounts or controller not passed to FlatList.

**Solution:** Ensure controller is passed via `controller` prop and methods are called after mount:

```tsx
const controller = createFlatListController();

onMount(() => {
  controller.scrollToIndex({ index: 10 }); // ✅ After mount
});

return <FlatList controller={controller} ... />;
```

### Scroll position is slightly off

**Cause:** Viewport size not yet settled or itemSize doesn't match actual rendered height.

**Solution:**

1. Ensure `itemSize` matches your rendered item height exactly
2. Call `recomputeViewableItems()` after layout changes
3. Add a small delay before initial scrolls to let layout settle

### Animated scrolls are janky

**Cause:** Heavy computation or updates during scroll animation.

**Solution:** Defer non-critical updates until scroll completes:

```tsx
controller.scrollToIndex({ index: 50, animated: true });

// Wait for animation
setTimeout(() => {
  // Do heavy work here
}, 500);
```

## Future Enhancements

Potential additions being considered:

- `scrollToKey({ key, ... })` - Scroll to item by key instead of index
- `getVisibleRange()` - Get current visible index range
- Scroll event hooks (`onScrollComplete`, `onScrollStart`)
- Velocity-based scrolling
- Custom easing functions

Feedback and feature requests welcome!
