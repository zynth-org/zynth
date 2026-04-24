# ScrollView

`ScrollView` is the native scrollable container for Zynth. It supports vertical and horizontal scrolling, touch snapping, momentum, scroll metrics tracking, and UI-thread operations.

## Basic Usage

The standard `ScrollView` provides vertical scrolling by default. It can be switched to horizontal mode by setting the `horizontal` prop.

```tsx
import { ScrollView, View, Text } from "@zynthjs/components";

function List() {
  return (
    <ScrollView style={{ height: 400 }}>
      {/* Content will be scrollable vertically */}
      <View style={{ height: 1000, padding: 20 }}>
        <Text>Scroll Me!</Text>
      </View>
    </ScrollView>
  );
}
```

## Horizontal Scrolling and Content Container

Use `horizontal` for side-to-side scrolling. The `contentContainerStyle` is applied directly to the internal container wrapping the children, which is useful for setting paddings or flex directions.

```tsx
<ScrollView horizontal={true} contentContainerStyle={{ gap: 12 }}>
  <View style={{ width: 100, height: 100 }} />
  <View style={{ width: 100, height: 100 }} />
  <View style={{ width: 100, height: 100 }} />
</ScrollView>
```

## Scroll Snap and Pagination

`ScrollView` supports advanced snapping logic. Setting `snapToInterval` or `snapToOffsets` creates a paginated experience. For multi-column or centered pagination, use the `scrollSnapAlign` and `scrollSnapType` props.

```tsx
<ScrollView 
  horizontal={true} 
  snapToInterval={200} 
  decelerationRate="fast"
  showsHorizontalScrollIndicator={false}
>
  {/* Each child becomes a "page" snapped every 200px */}
</ScrollView>
```

## Native Scroll Guards

The `config` prop allows fine-tuning the native scroll guard, which prevents flings from overrunning during high-load periods or long lists. This ensures the UI remains responsive and content stays visible while the JS bridge is processing.

```tsx
const scrollConfig = ScrollView.config({
  stopVelocityThreshold: 3600,
  stopDistanceMultiplier: 3.25,
});

<ScrollView config={scrollConfig} />
```

## UI-Thread Operations

For responsive scrolling (e.g., autoscrolling), the `ref` provides a `ui.scrollTo` method. This operation is scheduled directly on the native UI thread, bypassing the JavaScript bridge for zero-latency scrolling.

```tsx
let scrollRef: ScrollViewRef | null = null;

const onAction = () => {
  // Bypasses the JS bridge for instant execution
  scrollRef?.ui.scrollTo({ y: 0, animated: true });
};

<ScrollView ref={(node) => (scrollRef = node)} />
```

## Shared Value Offset

Integrate with the native animation engine by passing a `contentOffsetSharedValue`. This allows the scroll position to update a native `SharedValue` synchronously, which can drive animations (like sticky headers or parallax) without any bridge overhead.

```tsx
// Using an ID from a native SharedValue (e.g. from a gesture or animation)
<ScrollView contentOffsetSharedValue={sharedValueId} />
```

## Props

| Prop | Type | Description |
|---|---|---|
| `horizontal` | `boolean` | Enables horizontal scrolling. |
| `scrollEnabled` | `boolean` | Enables or disables user-initiated scrolling. |
| `showsVerticalScrollIndicator` | `boolean` | Visibility of vertical indicator. |
| `showsHorizontalScrollIndicator` | `boolean` | Visibility of horizontal indicator. |
| `indicatorStyle` | `default` \| `black` \| `white` | Styling theme for indicators. |
| `bounces` | `boolean` | Enables iOS-style elastic bouncing or Android overscroll effects. |
| `overScrollBehavior` | `auto` \| `always` \| `never` | Explicit control for Android overscroll. |
| `snapToInterval` | `number` | Snaps content to specific pixel intervals. |
| `snapToOffsets` | `number[]` | Snaps content to explicit offset positions. |
| `snapToAlignment` | `start` \| `center` \| `end` | Alignment for snap-points. |
| `decelerationRate` | `normal` \| `fast` \| `number` | Rate at which momentum slows down. |
| `onScroll` | `(event: ScrollEvent) => void` | Continuous scroll event callback. |
| `onScrollBeginDrag` | `(event: ScrollEvent) => void` | Called on manual scroll start. |
| `onScrollEndDrag` | `(event: ScrollEvent) => void` | Called on manual scroll release. |
| `onMomentumScrollEnd` | `(event: ScrollEvent) => void` | Called once inertial movement stops. |
| `eventThrottleMs` | `number` | Throttles scroll events to JS (default 16ms). |
| `config` | `ScrollViewConfig` | Persistent native scroll guard tuning. |
| `contentOffsetSharedValue` | `number` | ID of a SharedValue to update with offset synchronously. |
| `style` | `Style` | Styling for the main viewport container. |
| `contentContainerStyle` | `Style` | Styling for the inner scrollable content container. |
| `testID` | `string` | Unique identifier for automation tests. |
| `ref` | `(node: HostNode & ScrollViewRef) => void` | Imperative API reference. |

## Imperative Ref

| Method | Description |
|---|---|
| `metrics()` | Returns current offset, content size, and viewport size. |
| `scrollTo(opts)` | Programmatic scroll via the JS bridge. |
| `ui.scrollTo(opts)` | **Synchronous UI-thread scroll** (bypasses bridge). |
| `scrollBy(opts)` | Relative scroll based on current offset. |
| `flashScrollIndicators()` | Briefly shows the indicator to hint at scrollability. |
| `isDragging()` | Returns true if the user is currently touching the surface. |
| `isDecelerating()` | Returns true if inertial momentum is active. |

## Notes

- **Content Size Optimization**: For virtualized lists, provide an explicit `contentSize` to help the native scroll view manage its scrollable area before child measurements are available.
- **Scroll Synchronization**: Avoid heavy computations inside `onScroll`. Use `contentOffsetSharedValue` for animations for optimal responsiveness.
