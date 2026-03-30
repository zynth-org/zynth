# Shaders and Values

`@zynth/skia` exposes two related shader models. `createShader()` builds a JavaScript-evaluated color program for declarative drawing, while `createRuntimeEffect()` and `Skia.RuntimeEffect.Make(...)` build native runtime shaders for rects, circles, and paths. The package also exposes `createSkiaValue()` for local values and shared numeric values.

These APIs are designed to fit SolidJS state and signals without introducing a separate animation runtime in application code.

## Basic usage

```tsx
import {
  Canvas,
  Paint,
  Rect,
  createShader,
  createSkiaValue,
} from "@zynth/skia";

const [time, setTime] = createSkiaValue(0, { shared: true });

const shader = createShader(
  "h.rgba(16 + 180 * h.fract(u.t * 0.15 + input.x / input.width), 120, 220, 1)",
  { t: time },
);

export function ShaderCard() {
  return (
    <Canvas
      clearColor="#020617"
      time={time}
      style={{ width: 320, height: 180 }}
    >
      <Paint shader={shader}>
        <Rect x={16} y={16} width={288} height={148} />
      </Paint>
    </Canvas>
  );
}
```

## Advanced examples

### Updating uniforms after creation

```tsx
import { Canvas, Paint, Rect, createShader } from "@zynth/skia";

const shader = createShader("h.rgba(255 * u.mix, 90, 180, 1)", { mix: 0.2 });

shader.setUniform("mix", 0.65);

export function UniformUpdate() {
  return (
    <Canvas style={{ width: 220, height: 120 }}>
      <Paint shader={shader}>
        <Rect x={12} y={12} width={196} height={96} />
      </Paint>
    </Canvas>
  );
}
```

### Runtime shader effects

```tsx
import {
  Canvas,
  Rect,
  Shader,
  createClock,
  createRuntimeEffect,
} from "@zynth/skia";

const clock = createClock();

const effect = createRuntimeEffect(`
uniform float iTime;
uniform vec2 iResolution;

half4 main(vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution;
  return half4(uv.x, 0.35 + 0.25 * sin(iTime), uv.y, 1.0);
}
`);

if (!effect) {
  throw new Error("Runtime shader effect could not be created.");
}

export function RuntimeShaderRect() {
  return (
    <Canvas frameLoop style={{ width: 320, height: 180 }}>
      <Rect x={0} y={0} width={320} height={180}>
        <Shader
          source={effect}
          uniforms={() => ({
            iTime: clock(),
            iResolution: [320, 180],
          })}
        />
      </Rect>
    </Canvas>
  );
}
```

### Building values for shared numeric state

```tsx
import { createSkiaValue } from "@zynth/skia";

const [progress, setProgress] = createSkiaValue(0, { shared: true });

setProgress(0.5);
```

## Special cases and unusual features

- `createSkiaValue(initial, { shared: true })` creates shared numeric values only when the initial value is a number. Other value types remain local Solid signals.
- `createShader()` evaluates to colors and is useful for declarative paint composition.
- `createRuntimeEffect()` returns `null` for empty source strings.
- Runtime effects are exposed both as standalone helpers and through the `Skia` namespace.
- `resolveRuntimeUniforms()` and `resolveRuntimeShaderUniformMap()` are used internally to normalize uniform objects and are also part of the exported API for advanced composition.

## API Reference

### `createSkiaValue<T>(initial, options?)`

- `initial: T`
- `options?: { shared?: boolean }`
- returns `[Accessor<T>, Setter<T>]`

### `createShader(source, uniforms?)`

- `source: string`
- `uniforms?: Record<string, SkiaUniformValue>`
- returns `SkiaShaderProgram`

### `SkiaShaderProgram`

- `source: string`
- `uniforms: SkiaUniformMap`
- `evaluate(input: SkiaShaderInput): string`
- `setUniform(name: string, value: SkiaUniformValue): void`
- `runtimeEffect?: SkiaRuntimeEffect`

### `createRuntimeEffect(source)`

- `source: string`
- returns `SkiaRuntimeEffect | null`

### `SkiaRuntimeEffect`

- `source: string`
- `makeShader(uniforms?: SkiaRuntimeUniforms): SkiaShaderProgram`

### `Skia` namespace helpers

- `Skia.RuntimeEffect.Make(source)`
- `Skia.Data.fromBytes(bytes)`
- `Skia.Data.fromBase64(base64)`
- `Skia.Image.MakeImageFromEncoded(data)`
- `Skia.Image.MakeImage(info, data, rowBytes)`
- `Skia.SVG.MakeFromString(source, fontMgr?, resources?)`
- `Skia.SVG.MakeFromData(data, fontMgr?, resources?)`
- `Skia.Skottie.Make(source)`
