# VirtualList

`VirtualList` is a lightweight virtualization container designed for homogeneous datasets where item layouts are highly predictable. It maintains responsive rendering by only calculating and mounting components that are within the current viewport and overscan range.

## Basic Usage

For lists where every item has a fixed or easily calculable size, `getItemLayout` allows the container to bypass expensive layout measurements and determine scroll positions synchronously.

```tsx
import { VirtualList, View, Text } from "@zynth/components";

const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `Row ${i}` }));

function MyVirtualList() {
  return (
    <VirtualList
      data={data}
      renderItem={({ item, index }) => (
        <View style={{ height: 60, borderBottomWidth: 1 }}>
          <Text>{item.text}</Text>
        </View>
      )}
    />
  );
}
```

## Grid Layouts

Similar to `FlatList`, `VirtualList` supports multiple columns using the `numColumns` prop. Grid layouts are calculated atomically to ensure synchronization between rows.

```tsx
<VirtualList
  data={items}
  numColumns={2}
  renderItem={({ item }) => <GridCell data={item} />}
  columnWrapperStyle={{ padding: 4 }}
/>
```

## Headers and Footers

The component includes support for a `ListHeaderComponent` and a `ListFooterComponent`, which are automatically integrated into the virtualization bounds.

```tsx
<VirtualList
  data={data}
  ListHeaderComponent={<WelcomeHeader />}
  ListFooterComponent={<LoadMoreIndicator />}
  onEndReached={() => console.log("Load more...")}
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `data` | `T[]` | The array of items to render. |
| `renderItem` | `(info) => JSX.Element` | Function to render each row. |
| `keyExtractor` | `(item, index) => string \| number` | Returns a unique identifier. |
| `numColumns` | `number` | Number of columns in a grid. |
| `estimatedItemSize`| `number` | Average item size for fallback layout. |
| `getItemLayout` | `(data, index) => ItemLayout` | Synchronous layout descriptor. |
| `overscan` | `number` | Number of rows to pre-calculate. |
| `style` | `StyleProp` | Styling for the main list container. |
| `contentContainerStyle`| `StyleProp` | Styling for the inner viewport wrapper. |
| `columnWrapperStyle`| `StyleProp` | Applied to the wrapper of grid items. |
| `onEndReached` | `() => void` | Event triggered as the scroll approaches the end. |
| `onEndReachedThreshold` | `number` | Threshold (0-1) relative to viewport size. |
| `horizontal` | `boolean` | Enables horizontal scrolling mode. |
| `inverted` | `boolean` | Reverses the list using native scroll inversion. |
| `initialNumToRender`| `number` | Items to render on the first pass (mount). |
| `removeClippedSubviews`| `boolean` | Enables aggressive clipping of non-visible views. |

## Advanced Layout Optimization

While the component manages its internal layout automatically through periodic measurement passes, providing `getItemLayout` allows the container to determine scroll positions and viewport ranges synchronously. This can improve stability and responsiveness during rapid scrolling through massive datasets.

```tsx
<VirtualList
  data={data}
  getItemLayout={(data, index) => ({
    length: 60,
    offset: 60 * index,
    index
  })}
/>
```

The `estimatedItemSize` property is also available as an optional hint for the virtualization engine to guess the layout before measurements are confirmed.


## Notes

- **Scroll Performance**: While both `FlatList` and `VirtualList` use virtualization, `VirtualList` is optimized for simpler structures with consistent item sizes (`getItemLayout`).
- **Memory Management**: For extremely large datasets (10,000+ items), ensure `keyExtractor` is provided to allow the renderer to track node identity accurately during updates.
- **Inverted Lists**: `inverted` is supported, but on iOS transparent router headers that use native blur or Liquid Glass can render incorrectly because the platform also inverts the header edge effect. Prefer non-transparent headers on those screens, or add screen-level top padding when `headerTransparent` is `false`.
