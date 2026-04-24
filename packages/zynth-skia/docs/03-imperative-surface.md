# Imperative Surface

The imperative API exposes the same renderer through direct command submission. Use it when draw commands come from an external system, when command scheduling must be explicit, or when a reusable controller is easier to integrate than a declarative tree.

`SkiaView` is the host component. `createSkiaSurface()` creates a controller that binds to a host node and submits `SkiaDrawCommand[]` or complete frame objects.

## Basic usage

```tsx
import { SkiaView } from "@zynthjs/skia";

export function StaticSurface() {
  return (
    <SkiaView
      clearColor="#020617"
      style={{ width: 320, height: 180 }}
      commands={[
        { type: "clear", color: "#020617" },
        {
          type: "rect",
          x: 20,
          y: 20,
          width: 280,
          height: 140,
          color: "#1e293b",
        },
        { type: "circle", cx: 160, cy: 90, r: 24, color: "#38bdf8" },
      ]}
    />
  );
}
```

## Advanced examples

### Binding a controller

```tsx
import { SkiaView, createSkiaSurface } from "@zynthjs/skia";

const surface = createSkiaSurface();

export function SurfaceWithController() {
  return (
    <SkiaView
      ref={(node) => surface.bind(node)}
      clearColor="#0f172a"
      style={{ width: 320, height: 180 }}
    />
  );
}

surface.submit([
  { type: "clear", color: "#0f172a" },
  {
    type: "path",
    commands: [
      { type: "moveTo", x: 24, y: 120 },
      { type: "quadTo", cpx: 160, cpy: 36, x: 296, y: 120 },
    ],
    color: "#22c55e",
    style: "stroke",
    strokeWidth: 4,
  },
]);
```

### Submitting a frame object

```tsx
import { createSkiaSurface } from "@zynthjs/skia";

const surface = createSkiaSurface();

surface.submitFrame({
  clear: "#111827",
  commands: [
    { type: "clear", color: "#111827" },
    {
      type: "text",
      text: "Frame ready",
      x: 32,
      y: 72,
      color: "#f8fafc",
      fontFamily: "System",
      fontSize: 18,
    },
  ],
});
```

### Driving redraws manually

```tsx
import { createSignal, createEffect, onCleanup } from "solid-js";
import { SkiaView, createSkiaSurface } from "@zynthjs/skia";

const surface = createSkiaSurface();

export function ManualFrameLoop() {
  const [progress, setProgress] = createSignal(0);

  createEffect(() => {
    const t = progress();
    surface.submit([
      { type: "clear", color: "#020617" },
      {
        type: "rect",
        x: 24,
        y: 72,
        width: 272 * t,
        height: 20,
        color: "#0ea5e9",
      },
    ]);
  });

  let frame = 0;
  let handle = 0;
  const tick = () => {
    frame += 1;
    setProgress((frame % 120) / 120);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  onCleanup(() => cancelAnimationFrame(handle));

  return (
    <SkiaView
      ref={(node) => surface.bind(node)}
      style={{ width: 320, height: 180 }}
    />
  );
}
```

## Special cases and unusual features

- `SkiaView` can be used directly with a `commands` prop or indirectly through a `SkiaSurfaceController`.
- When `commands` is passed as an accessor, `SkiaView` schedules submission on the next animation frame rather than submitting synchronously on every reactive change.
- `submitFrame()` accepts a `clear` field, but the draw list remains the main source of rendering work.
- `frameLoop` enables continuous rendering on the native surface. Leave it disabled for static or manually invalidated content.
- The imperative and declarative APIs share the same native draw command format and resource types.

## API Reference

### `SkiaView`

- `style?: Style`
- `clearColor?: string`
- `frameLoop?: boolean`
- `allowFallback?: boolean`
- `commands?: SkiaDrawCommand[] | (() => SkiaDrawCommand[])`
- `ref?: (node: HostNode | null) => void`
- `onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void`
- `onLayout?: (event: LayoutChangeEvent) => void`

### `createSkiaSurface()`

Returns `SkiaSurfaceController`:

- `bind(node: HostNode | null): void`
- `currentNodeId(): number | null`
- `submit(commands: SkiaDrawCommand[]): void`
- `submitFrame(frame: SkiaFrameSpec): void`
- `invalidate(): void`
- `setFrameLoopEnabled(enabled: boolean): void`
- `dispose(): void`

### Core draw command types

- `clear`
- `rect`
- `circle`
- `line`
- `path`
- `text`
- `image`
- `svg`
- `skottie`
- `runtimeShaderRect`
- `runtimeShaderCircle`
- `runtimeShaderPath`
- `saveLayer`
- `saveLayerLuminanceMask`
- `restore`
