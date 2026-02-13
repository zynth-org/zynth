# @zynth/skia - Declarative Canvas API

## Components

### `Canvas`

Primary declarative surface.

Props:

- `style?`
- `clearColor?: string`
- `frameLoop?: boolean`
- `allowFallback?: boolean`
- `time?: number | Accessor<number>`
- `ref?`
- `onNativeReady?`

### `Group`

Transform scope.

Props:

- positioning: `x`, `y`, `translateX`, `translateY`
- scale: `scale`, `scaleX`, `scaleY`
- rotation: `rotate`
- pivot: `originX`, `originY`
- composition: `layer`

### `Paint`

Paint inheritance scope.

Props:

- `color`, `style`, `strokeWidth`
- `antiAlias`, `opacity`
- `strokeCap`, `strokeJoin`, `strokeMiter`
- `shader`

### `LinearGradient`

Gradient shader node.

Props:

- `start: { x, y } | [x, y]`
- `end: { x, y } | [x, y]`
- `colors` (2-stop minimum)
- `positions?`
- `mode?: "clamp" | "repeat" | "mirror" | "decal"`
- `flags?`

Reactive scalar coordinates:

- Use `toSharedScalar(...)` for direct shared-signal coordinates.
- Use `interpolateShared(...)` for native interpolation references.
- Avoid `tick()` snapshots for native-reactive coords in declarative nodes.

### `Mask`

Luminance mask composition node.

Props:

- `mode?: "luminance"`
- `mask?`
- `children`

### Shapes

- `Rect`
- `Circle`
- `Path`
- `Text`
- `Shader` (as a child of `Paint` or shape nodes)
- `LinearGradient` (as a child of `Paint` or shape nodes)
- `Mask`

All shape nodes accept local paint overrides.

## Migration note

- Do not snapshot with `tick()` for native-reactive coordinates.
- Prefer `interpolateShared` and `toSharedScalar`.
- Legacy manual token literals (`__zynth_*`) are compatibility-only and deprecated for app code.

## Example: paint inheritance and override

```tsx
<Canvas clearColor="#0B1220" style={{ width: 320, height: 180 }}>
  <Paint color="#F59E0B" style="stroke" strokeWidth={4} opacity={0.72}>
    <Rect x={20} y={20} width={96} height={64} />
    <Circle cx={180} cy={80} r={28} />
    <Paint color="#F43F5E" opacity={1}>
      <Path path="M 240 22 L 298 90 L 240 158" />
    </Paint>
  </Paint>
</Canvas>
```
