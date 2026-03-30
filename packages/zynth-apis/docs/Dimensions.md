# Dimensions

The `Dimensions` API provides a reactive interface for querying and subscribing to device screen and window metrics.

It ensures that your application layout remains responsive to screen rotations, window resizing (on tablets/multi-window), and DPI scaling changes by synchronizing native display snapshots with the Zynth JavaScript tree.

## Basic usage

### Static Metrics

You can retrieve the current dimensions at any time using the `Dimensions.get()` method.

```tsx
import { Dimensions } from "@zynth/apis";

const { width, height } = Dimensions.get("window");

console.log(`Current window resolution: ${width}x${height}`);
```

### Subscriptions

To respond to layout changes (such as device rotation), subscribe to updates using `Dimensions.subscribe()`.

```tsx
import { Dimensions } from "@zynth/apis";

const unsubscribe = Dimensions.subscribe((snapshot, meta) => {
  console.log("New window width:", snapshot.window.width);
  console.log("Update source:", meta.source); // e.g., "native", "refresh"
});

// Later: unsubscribe();
```

## Advanced

### Observing Specific Types

If you only care about changes to the "screen" metrics (physical display) versus "window" metrics (actual app viewport), use `Dimensions.observe()`.

```tsx
Dimensions.observe("screen", (metrics) => {
  console.log(`Device physical pixel scale: ${metrics.scale}`);
});
```

### Forcing a Refresh

In cases where native events might be deferred, you can manually trigger a synchronization with the native display manager.

```ts
await Dimensions.refresh();
```

## Special cases

- **Window vs. Screen**:
  - `window`: The dimensions of the actual application viewport (affected by multi-tasking and split-screen).
  - `screen`: The dimensions of the physical display hardware.
- **Precision**: Calculations use an internal epsilon (`0.01`) during comparison to avoid redundant reactive updates caused by floating-point rounding errors in the native layer.
- **Initialization**: Dimensions are pre-populated during boot using `NativeConstants`. If constants are missing, the API falls back to standard browser `innerWidth/innerHeight` for web-compatibility.

## API Reference

### `Dimensions.get(type: 'window' | 'screen'): DimensionMetrics`
Returns the current frozen metrics for the specified type.

### `Dimensions.subscribe(listener: DimensionsListener, options?: { emitCurrent?: boolean }): () => void`
Listens for changes to any dimension metric. Returns an unsubscribe function.

### `Dimensions.observe(type, listener, options?): () => void`
Optimized listener for changes to a specific dimension key.

### `Dimensions.refresh(): Promise<DimensionsSnapshot>`
Asks the native bridge for an immediate, synchronous display snapshot.

### `DimensionMetrics` (Type)
- `width: number`
- `height: number`
- `scale: number` (Pixel density/device ratio)
- `fontScale: number` (User preference for text zoom)
