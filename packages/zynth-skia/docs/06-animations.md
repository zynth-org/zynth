# Animations

Animations in `@zynth/skia` are usually driven by numeric values that can be passed directly into drawing props. The package exposes shared numeric state through `createSkiaValue(..., { shared: true })`, conversion helpers such as `toSharedScalar()`, and interpolation helpers such as `interpolateShared()`.

This makes it possible to animate scalar props such as coordinates, opacity, stroke values, gradient endpoints, and shader uniforms without changing the declarative drawing model.

## Basic usage

```tsx
import { onCleanup, onMount } from "solid-js";
import {
  Canvas,
  LinearGradient,
  Rect,
  createSkiaValue,
  interpolateShared,
  toSharedScalar,
  vec,
} from "@zynth/skia";
import type { SharedSignalAccessor } from "@zynth/skia";

const [progress, setProgress] = createSkiaValue(0, { shared: true });
const progressSignal = progress as SharedSignalAccessor<number>;

const startX = interpolateShared(progressSignal, [0, 180, 360], [-40, 140, -40]);
const endX = interpolateShared(progressSignal, [0, 180, 360], [280, 440, 280]);
const flags = toSharedScalar(progressSignal);

export function AnimatedGradient() {
  onMount(() => {
    let frameId = 0;

    const loop = () => {
      setProgress((value) => (value + 1) % 360);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    onCleanup(() => {
      cancelAnimationFrame(frameId);
    });
  });

  return (
    <Canvas clearColor="#020617" frameLoop style={{ width: 320, height: 180 }}>
      <Rect x={20} y={24} width={280} height={132}>
        <LinearGradient
          start={vec(startX, 24)}
          end={vec(endX, 156)}
          colors={["#06b6d4", "#8b5cf6", "#f59e0b"]}
          positions={[0, 0.6, 1]}
          flags={flags}
        />
      </Rect>
    </Canvas>
  );
}
```

## Important and advanced examples

### Animating scalar props directly

```tsx
import { onCleanup, onMount } from "solid-js";
import {
  Canvas,
  Circle,
  createSkiaValue,
  interpolateShared,
} from "@zynth/skia";
import type { SharedSignalAccessor } from "@zynth/skia";

const [phase, setPhase] = createSkiaValue(0, { shared: true });
const phaseSignal = phase as SharedSignalAccessor<number>;

const cx = interpolateShared(phaseSignal, [0, 100, 200], [48, 272, 48]);
const cy = interpolateShared(phaseSignal, [0, 100, 200], [140, 56, 140]);

export function AnimatedCircle() {
  onMount(() => {
    let frameId = 0;

    const loop = () => {
      setPhase((value) => (value + 1) % 200);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    onCleanup(() => {
      cancelAnimationFrame(frameId);
    });
  });

  return (
    <Canvas clearColor="#111827" frameLoop style={{ width: 320, height: 180 }}>
      <Circle cx={cx} cy={cy} r={18} color="#22c55e" />
    </Canvas>
  );
}
```

### Combining shared values with helper clocks

```tsx
import { Canvas, Path, createClock, createPathInterpolation } from "@zynth/skia";

const clock = createClock({ durationMs: 6_000 });

const wave = createPathInterpolation(
  () => (Math.sin(clock()) + 1) / 2,
  [0, 1],
  [
    "M 24 120 Q 160 48 296 120",
    "M 24 60 Q 160 132 296 60",
  ],
);

export function AnimatedPath() {
  return (
    <Canvas clearColor="#020617" frameLoop style={{ width: 320, height: 180 }}>
      <Path path={wave()} color="#38bdf8" style="stroke" strokeWidth={4} />
    </Canvas>
  );
}
```

## Special cases and unusual features

- `createSkiaValue(..., { shared: true })` is the starting point when an animation should drive numeric Skia props.
- `interpolateShared()` maps one shared numeric signal to another scalar range and is useful for positions, sizes, radii, and other draw-time values.
- `toSharedScalar()` converts a shared numeric accessor into a scalar value that can be forwarded into props expecting `SkiaScalarValue`.
- Animation helpers such as `createClock()` build on the same shared numeric model and are documented separately in the reactive primitives page.
- The public API also re-exports `SharedSignalAccessor`, `SharedScalarRef`, and `InterpolatedScalarRef` for advanced integrations.

## API Reference

### Shared numeric helpers

- `createSkiaValue<T>(initial, options?)`
- `toSharedScalar(signal)`
- `interpolateShared(signal, inputRange, outputRange)`

### Related reactive APIs

- `createClock(options?)`
- `createPathInterpolation(progress, inputRange, outputRange)`
- `createPathValue(updater, initialPath?)`

### Shared value types

- `SharedSignalAccessor`
- `SharedScalarRef`
- `InterpolatedScalarRef`
- `SkiaScalarValue`
