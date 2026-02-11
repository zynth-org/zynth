# @zynth/skia - Imperative Surface API

## `SkiaView`

Low-level native view component. Accepts draw commands directly.

Props:

- `style?`
- `clearColor?: string`
- `frameLoop?: boolean`
- `allowFallback?: boolean`
- `commands?: SkiaDrawCommand[] | (() => SkiaDrawCommand[])`
- `ref?`
- `onNativeReady?`

## `createSkiaSurface()`

Creates a controller for explicit bind/submit lifecycle.

Methods:

- `bind(node)`
- `currentNodeId()`
- `submit(commands)`
- `submitFrame(frame)`
- `invalidate()`
- `setFrameLoopEnabled(enabled)`
- `dispose()`

## Example

```tsx
import { SkiaView, createSkiaSurface } from "@zynth/skia";

const surface = createSkiaSurface();

<SkiaView ref={(node) => surface.bind(node)} style={{ width: 300, height: 120 }} />;

surface.submit([
  { type: "clear", color: "#0B1220" },
  { type: "rect", x: 16, y: 16, width: 268, height: 88, color: "#1E293B", style: "stroke", strokeWidth: 2 },
]);
```

## Notes

- Imperative and declarative flows end in the same packed native command path.
- Prefer declarative APIs unless you explicitly need scheduling control.
