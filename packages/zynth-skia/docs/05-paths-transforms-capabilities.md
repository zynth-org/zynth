# @zynth/skia - Paths, Transforms, Capabilities

## Path support

`Path` accepts:

- path string (`SVG-like`)
- `SkiaPathObject` from `createPath(...)`
- `SkiaPathCommand[]`

Supported path commands in parser:

- `M/m`, `L/l`, `H/h`, `V/v`
- `Q/q`, `T/t`
- `C/c`, `S/s`
- `A/a` (normalized to cubic segments)
- `Z/z`

Arc constraints:

- arc flags must be `0` or `1`
- invalid flags throw deterministic errors

## `createPath`

```ts
const p = createPath()
  .moveTo(16, 16)
  .cubicTo(48, 4, 72, 44, 104, 20)
  .quadTo(160, 8, 220, 42)
  .close();
```

## Group transforms

`Group` transform props compose into one matrix:

- translate: `x`, `y`, `translateX`, `translateY`
- scale: `scale`, `scaleX`, `scaleY`
- rotate: `rotate`
- origin: `originX`, `originY`

## Capabilities API

```ts
import { assertSkiaFeature, getSkiaCapabilities, supportsSkiaFeature } from "@zynth/skia";

const caps = getSkiaCapabilities();
const canCurves = supportsSkiaFeature("path.curves");
assertSkiaFeature("group.transforms", "Animated gauge scene");
```

Available features:

- `paths`
- `path.curves`
- `paint.opacity`
- `paint.strokeCap`
- `paint.strokeJoin`
- `paint.strokeMiter`
- `group.transforms`

If a feature is unsupported, APIs throw explicit errors instead of silently degrading.
