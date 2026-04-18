# Dimensions

The default dimensions surface in Zynth is `viewport`, a reactive binding for querying and subscribing to device screen and window metrics.

It ensures that your application layout remains responsive to screen rotations, window resizing (on tablets/multi-window), and DPI scaling changes by synchronizing native display snapshots with the Zynth JavaScript tree.

## Basic usage

### Reactive Metrics

You can read the current viewport metrics at any time from `viewport.window` and `viewport.screen`.

```tsx
import { viewport } from "@zynth/apis";

const width = viewport.window.width;
const height = viewport.window.height;

console.log(`Current window resolution: ${width}x${height}`);
```

### Subscriptions

To respond to layout changes (such as device rotation), subscribe to updates using `viewport.subscribe()`.

```tsx
import { viewport } from "@zynth/apis";

const unsubscribe = viewport.subscribe((snapshot, meta) => {
  console.log("New window width:", snapshot.window.width);
  console.log("Update source:", meta.source); // e.g., "native", "refresh"
});

// Later: unsubscribe();
```

## Advanced

### Observing Specific Types

If you only care about changes to the "screen" metrics (physical display) versus "window" metrics (actual app viewport), use `viewport.observe()`.

```tsx
viewport.observe("screen", (metrics) => {
  console.log(`Device physical pixel scale: ${metrics.scale}`);
});
```

### Forcing a Refresh

In cases where native events might be deferred, you can manually trigger a synchronization with the native display manager.

```ts
await viewport.refresh();
```

### Component Bindings

If you want an explicit local binding inside a Solid component, use `createViewport()`.

```tsx
import { createViewport } from "@zynth/apis";

function Hero() {
  const viewport = createViewport();
  return <Text>{viewport.window.width}</Text>;
}
```

## Special cases

- **Window vs. Screen**:
  - `window`: The dimensions of the actual application viewport (affected by multi-tasking and split-screen).
  - `screen`: The dimensions of the physical display hardware.
- **Precision**: Calculations use an internal epsilon (`0.01`) during comparison to avoid redundant reactive updates caused by floating-point rounding errors in the native layer.
- **Initialization**: Dimensions are pre-populated during boot using `NativeConstants`. If constants are missing, the API falls back to standard browser `innerWidth/innerHeight` for web-compatibility.

## API Reference

### `viewport.window` / `viewport.screen`
Reactive metric objects for the current app viewport and the physical display.

### `viewport.subscribe(listener: DimensionsListener, options?: { emitCurrent?: boolean }): () => void`
Listens for changes to any dimension metric. Returns an unsubscribe function.

### `viewport.observe(type, listener, options?): () => void`
Optimized listener for changes to a specific dimension key.

### `viewport.refresh(): Promise<DimensionsSnapshot>`
Asks the native bridge for an immediate display snapshot.

### Legacy compatibility

`Dimensions.get()`, `Dimensions.observe()`, `Dimensions.subscribe()`, and `Dimensions.refresh()` remain available for legacy semantics and LLM compatibility.

### `DimensionMetrics` (Type)
- `width: number`
- `height: number`
- `scale: number` (Pixel density/device ratio)
- `fontScale: number` (User preference for text zoom)
