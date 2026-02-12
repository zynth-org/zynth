# @zynth/skia - Shaders and Values

## `createSkiaValue`

```ts
const [time, setTime] = createSkiaValue(0, { shared: true });
```

- `shared: true` uses shared-signal backing for numeric values.
- For non-numeric values, it falls back to Solid `createSignal` semantics.

For shared-signal-driven animation primitives (`createClock`, `createPathInterpolation`, `createPathValue`), see `08-reactive-primitives.md`.

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

## `Skia.RuntimeEffect.Make`

`RuntimeEffect.Make` compiles SKSL for native RuntimeEffect rendering and returns an effect object with `makeShader(...)`.

```ts
const effect = Skia.RuntimeEffect.Make(`
uniform float iTime;
uniform vec2 iResolution;

vec4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  return vec4(uv.x, uv.y, 0.8 + 0.2 * sin(iTime), 1.0);
}
`);
if (!effect) throw new Error("Couldn't compile shader");

const shader = effect.makeShader({
  r: 0.1,
  g: 0.6,
  b: 0.9,
});
```

`Shader` component usage:

```tsx
<Rect x={0} y={0} width={320} height={180}>
  <Shader source={effect} uniforms={{ t: time }} />
</Rect>
```

Current scope:

- RuntimeEffect shaders render natively on `Rect` fill.
- RuntimeEffect on `Circle`/`Path` is not supported yet.

## Example

```tsx
<Canvas clearColor="#020617" time={time} style={{ width: 320, height: 180 }}>
  <Paint shader={shader}>
    <Rect x={0} y={0} width={320} height={180} />
  </Paint>
</Canvas>
```
