# Paths, Transforms, and Capabilities

Paths are a core part of the package surface. `Path` accepts SVG-style strings, explicit command arrays, and mutable path objects created with `createPath()`. Group transforms and capability helpers complement this by defining how complex scenes are composed and which native features are available at runtime.

These APIs are especially relevant when porting drawing code, building editors, or guarding advanced rendering features behind runtime checks.

## Basic usage

```tsx
import { Canvas, Path, createPath } from "@zynthjs/skia";

const triangle = createPath()
  .moveTo(40, 24)
  .lineTo(176, 96)
  .lineTo(40, 168)
  .close();

export function PathScene() {
  return (
    <Canvas clearColor="#020617" style={{ width: 220, height: 200 }}>
      <Path path={triangle} color="#38bdf8" />
    </Canvas>
  );
}
```

## Advanced examples

### Using SVG path strings

```tsx
import { Canvas, Path } from "@zynthjs/skia";

export function SvgPathScene() {
  return (
    <Canvas clearColor="#111827" style={{ width: 320, height: 180 }}>
      <Path
        path="M 24 120 C 96 24 224 24 296 120"
        color="#f59e0b"
        style="stroke"
        strokeWidth={5}
      />
    </Canvas>
  );
}
```

### Transforming a path subtree

```tsx
import { Canvas, Group, Path } from "@zynthjs/skia";

export function RotatedPath() {
  return (
    <Canvas clearColor="#0f172a" style={{ width: 320, height: 180 }}>
      <Group x={160} y={90} rotate={24} originX={0} originY={0}>
        <Path path="M -80 0 Q 0 -64 80 0 Q 0 64 -80 0 Z" color="#22c55e" />
      </Group>
    </Canvas>
  );
}
```

### Checking capabilities before using a feature

```tsx
import {
  assertSkiaFeature,
  getSkiaCapabilities,
  supportsSkiaFeature,
} from "@zynthjs/skia";

const caps = getSkiaCapabilities();
const canDrawSVG = supportsSkiaFeature("svg");

assertSkiaFeature("group.transforms", "rotating gauge");

console.log(caps.paths, canDrawSVG);
```

## Special cases and unusual features

- `createPath()` returns a mutable builder with `moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`, `reset`, and `clone`.
- The SVG parser supports `M/m`, `L/l`, `H/h`, `V/v`, `Q/q`, `T/t`, `C/c`, `S/s`, `A/a`, and `Z/z`.
- Arc commands are normalized into cubic path segments before submission.
- `Path` also accepts a raw `SkiaPathCommand[]` array when paths are generated programmatically elsewhere.
- `getSkiaCapabilities()` merges the native capability report with package defaults, so unsupported features can be checked without probing draw behavior manually.

## API Reference

### `createPath(initial?)`

- `initial?: SkiaPathSource`
- returns `SkiaPathObject`

### `SkiaPathObject`

- `commands: readonly SkiaPathCommand[]`
- `moveTo(x, y)`
- `lineTo(x, y)`
- `quadTo(cpx, cpy, x, y)`
- `cubicTo(cp1x, cp1y, cp2x, cp2y, x, y)`
- `close()`
- `reset()`
- `clone()`

### `SkiaPathSource`

- `SkiaPathObject`
- `readonly SkiaPathCommand[]`
- `string`

### `Group` transform props

- `x`, `y`
- `translateX`, `translateY`
- `scale`, `scaleX`, `scaleY`
- `rotate`
- `originX`, `originY`
- `layer`

### Capability helpers

- `getSkiaCapabilities(): SkiaCapabilities`
- `supportsSkiaFeature(feature: SkiaFeature): boolean`
- `assertSkiaFeature(feature: SkiaFeature, context?: string): void`

### `SkiaFeature`

- `paths`
- `path.curves`
- `paint.opacity`
- `paint.strokeCap`
- `paint.strokeJoin`
- `paint.strokeMiter`
- `group.transforms`
- `text`
- `font.measure`
- `mask.luminance`
- `shader.linearGradient`
- `group.layer`
- `images`
- `svg`
- `skottie`
