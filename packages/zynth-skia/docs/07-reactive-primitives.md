# Reactive Primitives

The reactive helpers in `@zynth/skia` are designed for time-based drawing and path updates that fit SolidJS signals. They expose clocks, path interpolation, and mutable path generation without requiring imperative render loops in user code.

These primitives are especially useful when Skia props should be driven by shared numeric values, animated progress, or procedurally generated geometry.

## Basic usage

```tsx
import {
  Canvas,
  Path,
  createClock,
  createPathInterpolation,
} from "@zynth/skia";

const clock = createClock();

const path = createPathInterpolation(
  () => (Math.sin(clock()) + 1) / 2,
  [0, 1],
  ["M 24 120 Q 160 48 296 120", "M 24 60 Q 160 132 296 60"],
);

export function ReactivePath() {
  return (
    <Canvas frameLoop clearColor="#020617" style={{ width: 320, height: 180 }}>
      <Path path={path()} color="#38bdf8" style="stroke" strokeWidth={4} />
    </Canvas>
  );
}
```

## Advanced examples

### Clock-driven shader uniforms

```tsx
import {
  Canvas,
  Rect,
  Shader,
  createClock,
  createRuntimeEffect,
} from "@zynth/skia";

const clock = createClock({ durationMs: 10_000 });
const effect = createRuntimeEffect(`
uniform float t;
uniform vec2 size;

half4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / size;
  return half4(uv.x, 0.4 + 0.2 * sin(t), uv.y, 1.0);
}
`);

if (!effect) {
  throw new Error("Runtime shader effect could not be created.");
}

export function AnimatedShader() {
  return (
    <Canvas frameLoop style={{ width: 320, height: 180 }}>
      <Rect x={0} y={0} width={320} height={180}>
        <Shader source={effect} uniforms={{ t: clock(), size: [320, 180] }} />
      </Rect>
    </Canvas>
  );
}
```

### Procedural path values

```tsx
import { Canvas, Path, createClock, createPathValue } from "@zynth/skia";

const clock = createClock();

const wave = createPathValue((path) => {
  const t = clock();
  path.moveTo(20, 90);
  path.quadTo(110, 20 + Math.sin(t) * 30, 200, 90);
  path.quadTo(255, 130 - Math.sin(t) * 20, 300, 90);
});

export function ProceduralPath() {
  return (
    <Canvas frameLoop clearColor="#111827" style={{ width: 320, height: 180 }}>
      <Path path={wave()} color="#22c55e" style="stroke" strokeWidth={4} />
    </Canvas>
  );
}
```

## Special cases and unusual features

- `createClock()` returns seconds as an accessor.
- `createPathInterpolation()` requires `inputRange.length === outputRange.length` and at least two range stops.
- Interpolated paths must have the same command count and the same command types in each position.
- `createPathValue()` accepts an optional initial path, then lets the updater mutate a fresh path object derived from that base.
- `useClock`, `usePathInterpolation`, and `usePathValue` are compatibility aliases for the same implementations.

## API Reference

### `createClock(options?)`

- `options?: { autoStart?: boolean; durationMs?: number; fallbackStepMs?: number }`
- returns `Accessor<number>`

### `createPathInterpolation(progress, inputRange, outputRange)`

- `progress: number | Accessor<number>`
- `inputRange: readonly number[]`
- `outputRange: readonly SkiaPathSource[]`
- returns `Accessor<SkiaPathObject>`

### `createPathValue(updater, initialPath?)`

- `updater: (path: SkiaPathObject) => void`
- `initialPath?: SkiaPathSource`
- returns `Accessor<SkiaPathObject>`

### Compatibility aliases

- `useClock`
- `usePathInterpolation`
- `usePathValue`
