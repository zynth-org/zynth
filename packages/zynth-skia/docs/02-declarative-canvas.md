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

### `Paint`

Paint inheritance scope.

Props:

- `color`, `style`, `strokeWidth`
- `antiAlias`, `opacity`
- `strokeCap`, `strokeJoin`, `strokeMiter`
- `shader`

### Shapes

- `Rect`
- `Circle`
- `Path`

All shape nodes accept local paint overrides.

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
