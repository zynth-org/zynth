# Skia

`@zynth/skia` provides a declarative canvas API, an imperative surface API, resource loaders for images, SVG, animations, and fonts, and a small set of reactive helpers for draw-time values.

The native renderer is available on iOS and Android. Web support is partial: utility APIs such as shader evaluation, font measurement helpers, and resource preparation can be used in browser environments, but the package does not expose a dedicated web canvas renderer.

## Basic usage

```tsx
import { Canvas, Circle, Group, Path, Rect } from "@zynth/skia";

export function BasicScene() {
  return (
    <Canvas clearColor="#0b1220" style={{ width: 320, height: 180 }}>
      <Group>
        <Rect x={18} y={18} width={284} height={144} color="#1e293b" />
        <Path
          path="M 24 132 Q 160 28 296 132"
          color="#38bdf8"
          style="stroke"
          strokeWidth={4}
        />
        <Circle cx={160} cy={90} r={18} color="#f8fafc" />
      </Group>
    </Canvas>
  );
}
```

## Advanced examples

### Paint inheritance

```tsx
import { Canvas, Paint, Rect, Circle } from "@zynth/skia";

export function PaintInheritance() {
  return (
    <Canvas clearColor="#020617" style={{ width: 320, height: 180 }}>
      <Paint color="#f59e0b" style="stroke" strokeWidth={4} opacity={0.8}>
        <Rect x={20} y={20} width={110} height={64} />
        <Circle cx={220} cy={84} r={28} />
        <Paint color="#22c55e" opacity={1}>
          <Rect x={150} y={110} width={120} height={36} />
        </Paint>
      </Paint>
    </Canvas>
  );
}
```

### Transforming a subtree

```tsx
import { Canvas, Group, Rect, Circle } from "@zynth/skia";

export function TransformedGroup() {
  return (
    <Canvas clearColor="#111827" style={{ width: 320, height: 180 }}>
      <Group x={160} y={90} rotate={18} scale={1.1} originX={0} originY={0}>
        <Rect x={-56} y={-36} width={112} height={72} color="#334155" />
        <Circle cx={0} cy={0} r={18} color="#f97316" />
      </Group>
    </Canvas>
  );
}
```

### Switching to the imperative surface

```tsx
import { SkiaView } from "@zynth/skia";

export function SurfaceHost() {
  return (
    <SkiaView
      clearColor="#020617"
      frameLoop={false}
      style={{ width: 320, height: 180 }}
      commands={[
        { type: "clear", color: "#020617" },
        {
          type: "rect",
          x: 24,
          y: 24,
          width: 272,
          height: 132,
          color: "#0f172a",
        },
      ]}
    />
  );
}
```

## Special cases and unusual features

- `Canvas` compiles its child tree into draw commands and renders through `SkiaView`.
- `Group`, `Paint`, and `Mask` are structural nodes. They do not draw by themselves; they modify how descendant nodes are compiled.
- Reactive scalar values can be passed directly to many numeric props. This is how clocks, interpolated values, and shared signals stay connected to drawing.
- `allowFallback` is available on `Canvas` and `SkiaView` when a surface should not draw a simple background fallback while native rendering is unavailable.
- The package surface is larger than the canvas primitives. Images, SVG, Skottie, fonts, shaders, and imperative submission are part of the public API and documented in the related pages.

## API Reference

### Main components

- `Canvas`
- `SkiaView`
- `SkottieView`

### Declarative drawing nodes

- `Group`
- `Paint`
- `Rect`
- `Circle`
- `Path`
- `Text`
- `Image`
- `ImageSVG`
- `Skottie`
- `Shader`
- `LinearGradient`
- `Mask`

### Related pages

- [Declarative Canvas](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/02-declarative-canvas.md)
- [Imperative Surface](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/03-imperative-surface.md)
- [Shaders and Values](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/04-shaders-and-values.md)
- [Paths, Transforms, and Capabilities](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/05-paths-transforms-capabilities.md)
- [Animations](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/06-animations.md)
- [Reactive Primitives](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/07-reactive-primitives.md)
- [Fonts](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-skia/docs/08-fonts.md)
