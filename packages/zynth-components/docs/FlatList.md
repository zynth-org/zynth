# FlatList

`FlatList` is an optimized list component designed for large datasets. It employs a recycler pool strategy, reusing a fixed number of DOM/native nodes to display items as they enter the viewport, ensuring responsive scrolling and stable memory usage.

## Basic Usage

The component requires `data`, `renderItem`, and `keyExtractor`. It is recommended to provide an `estimatedItemSize` to assist the initial layout calculation.

```tsx
import { FlatList, Text, View } from "@zynthjs/components";

const DATA = Array.from({ length: 1000 }, (_, i) => ({ id: `${i}`, title: `Item ${i}` }));

function MyList() {
  return (
    <FlatList
      data={DATA}
      renderItem={({ item }) => (
        <View style={{ padding: 16, borderBottomWidth: 1 }}>
          <Text>{item.title}</Text>
        </View>
      )}
      keyExtractor={(item) => item.id}
    />
  );
}
```

## Advanced Features

### Multi-Column Layouts

`FlatList` can render items in a grid by setting the `numColumns` prop. This is useful for photo galleries or dashboard layouts.

```tsx
<FlatList
  data={photos}
  numColumns={3}
  renderItem={({ item }) => <PhotoThumbnail src={item.url} />}
  keyExtractor={(item) => item.id}
/>
```

### Inverted Scaling and Chat Persistence

For chat interfaces, set the `inverted` prop to reverse the scroll direction. Use `maintainVisibleContentPosition` to prevent the scroll position from jumping when new items are added to the top (start) of the list.

```tsx
<FlatList
  data={messages}
  inverted={true}
  maintainVisibleContentPosition={{
    minIndexForVisible: 0,
  }}
  renderItem={({ item }) => <MessageBubble message={item} />}
/>
```

### UI-Thread Animation Syncing

To drive animations (like sticky headers) with zero bridge latency, pass a `contentOffsetSharedValue`. This ID updates a native SharedValue synchronously as the user scrolls.

```tsx
// sharedValueId from a native animation context
<FlatList 
  data={items} 
  contentOffsetSharedValue={sharedValueId} 
/>
```

## Recycling and Overscan

The list maintains a `recycle` pool (enabled by default). You can tune responsiveness using `overscan`:

- **Number**: The number of items to pre-render beyond the viewport.
- **Object**: Precise control via `main` (pixel distance) or `multiple` (viewport size multiplier).

```tsx
<FlatList
  data={data}
  overscan={{ multiple: 2 }} // Pre-renders 2 viewports of content
  recycle={true}
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `data` | `T[]` | The array of items to render. |
| `renderItem` | `(info) => JSX.Element` | Function to render each row. |
| `keyExtractor` | `(item, index) => string` | Returns a unique key for each item. |
| `numColumns` | `number` | Number of columns for grid layouts. |
| `recycle` | `boolean` | Enables node recycling (default: true). |
| `estimatedItemSize`| `number` | Initial guess for item height/width. |
| `overscan` | `number \| OverscanConfig` | Range of pre-rendered content. |
| `inverted` | `boolean` | Reverses the list orientation. |
| `horizontal` | `boolean` | Enables horizontal scrolling. |
| `onEndReached` | `() => void` | Triggered when scrolling near the end. |
| `onEndReachedThreshold` | `number` | Threshold (0-1) for end detection. |
| `ListHeaderComponent` | `JSX.Element` | Component shown at the start. |
| `ListFooterComponent` | `JSX.Element` | Component shown at the end. |
| `ItemSeparatorComponent` | `JSX.Element` | Component shown between items. |
| `contentOffsetSharedValue` | `number` | Native SharedValue ID for scroll tracking. |

## Imperative Ref

The `ref` provides access to the `FlatListRef`, which includes all `ScrollView` methods plus list-specific controls:

- `scrollToItem(item, animated)`: Scrolls to a specific data item.
- `scrollToIndex(index, animated)`: Scrolls to a specific numerical index.
- `scrollToOffset(offset, animated)`: Scrolls to a pixel position.
- `recordInteraction()`: Manually tells the list to check for visibility updates.
