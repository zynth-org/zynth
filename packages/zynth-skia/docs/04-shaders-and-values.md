# @zynth/skia - Shaders and Values

## `createSkiaValue`

```ts
const [time, setTime] = createSkiaValue(0, { shared: true });
```

- `shared: true` uses shared-signal backing for numeric values.
- For non-numeric values, it falls back to Solid `createSignal` semantics.

## `createShader`

```ts
const shader = createShader(
  "h.rgba(32 + 160 * h.fract(u.t * 0.2 + input.x / input.width), 120, 220, 1)",
  { t: time },
);
```

`input` fields:

- `x`, `y`, `width`, `height`, `time`

Helper namespace `h` includes:

- `clamp`, `mix`, `smoothstep`, `fract`
- `vec2`, `vec3`, `vec4`
- `rgb`, `rgba`, `toColor`

## Example

```tsx
<Canvas clearColor="#020617" time={time} style={{ width: 320, height: 180 }}>
  <Paint shader={shader}>
    <Rect x={0} y={0} width={320} height={180} />
  </Paint>
</Canvas>
```
