# Declarative Canvas

The declarative API is the main entry point for drawing with `@zynthjs/skia`. A `Canvas` hosts a tree of drawing nodes such as `Rect`, `Circle`, `Path`, `Text`, `Image`, and `Skottie`, while structural nodes such as `Group`, `Paint`, `Shader`, `LinearGradient`, and `Mask` configure how descendants are rendered.

This model works naturally with SolidJS composition. Shapes can be nested, inherited paint can be overridden locally, and many scalar props accept shared or interpolated values.

## Basic usage

```tsx
import { Canvas, Circle, Rect, Text, createFontFromStyle } from "@zynthjs/skia";

const labelFont = createFontFromStyle({
  fontFamily: "System",
  fontSize: 16,
  fontWeight: 600,
});

export function StatusCard() {
  return (
    <Canvas clearColor="#0f172a" style={{ width: 320, height: 180 }}>
      <Rect x={16} y={16} width={288} height={148} color="#1e293b" />
      <Circle cx={58} cy={56} r={10} color="#22c55e" />
      <Text text="Connected" x={80} y={62} font={labelFont} color="#f8fafc" />
    </Canvas>
  );
}
```

## Advanced examples

### Paint and gradient composition

```tsx
import { Canvas, LinearGradient, Paint, Rect, vec } from "@zynthjs/skia";

export function GradientCard() {
  return (
    <Canvas clearColor="#020617" style={{ width: 320, height: 180 }}>
      <Paint>
        <LinearGradient
          start={vec(16, 16)}
          end={vec(304, 164)}
          colors={["#0ea5e9", "#22c55e", "#f59e0b"]}
        />
        <Rect x={16} y={16} width={288} height={148} />
      </Paint>
    </Canvas>
  );
}
```

### Masking a subtree

```tsx
import { Canvas, Mask, Circle, Rect } from "@zynthjs/skia";

export function AvatarMask() {
  return (
    <Canvas clearColor="#020617" style={{ width: 240, height: 160 }}>
      <Mask mask={<Circle cx={80} cy={80} r={52} color="#ffffff" />}>
        <Rect x={20} y={20} width={120} height={120} color="#2563eb" />
        <Rect
          x={44}
          y={44}
          width={120}
          height={120}
          color="#38bdf8"
          opacity={0.6}
        />
      </Mask>
    </Canvas>
  );
}
```

### Drawing resources

```tsx
import {
  Canvas,
  Image,
  ImageSVG,
  Skottie,
  createClock,
  createImage,
  createSVG,
  createSkottie,
} from "@zynthjs/skia";

const image = createImage({ uri: "https://example.com/banner.png" });
const svg = createSVG({ uri: "https://example.com/icon.svg" });
const animation = createSkottie({ uri: "https://example.com/loader.json" });
const clock = createClock();

export function ResourceScene() {
  return (
    <Canvas clearColor="#111827" frameLoop style={{ width: 360, height: 220 }}>
      <Image
        image={image()}
        x={16}
        y={16}
        width={160}
        height={96}
        fit="cover"
      />
      <ImageSVG svg={svg()} x={204} y={24} width={72} height={72} />
      <Skottie
        animation={animation()}
        frame={clock() * 60}
        x={188}
        y={116}
        width={120}
        height={80}
      />
    </Canvas>
  );
}
```

## Special cases and unusual features

- `Text` requires a `font` object created with `createFontFromStyle`, `matchFont`, `createFont`, or `Skia.Font(...)`.
- `Image`, `ImageSVG`, and `Skottie` ignore paint inheritance. Their appearance is configured through their own props.
- `Shader` and `LinearGradient` are not standalone draw commands. They are attached through `Paint` or as children of shape nodes.
- `Mask` currently exposes `mode="luminance"`, which is also the default.
- `Canvas` accepts `time` when a subtree needs a stable time input for shader evaluation without deriving it from an external signal.

## API Reference

### `Canvas`

- `style?: Style`
- `clearColor?: string`
- `frameLoop?: boolean`
- `allowFallback?: boolean`
- `time?: number | Accessor<number>`
- `ref?: (node: HostNode | null) => void`
- `onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void`
- `onLayout?: (event: LayoutChangeEvent) => void`

### `Group`

- `x?: number`
- `y?: number`
- `translateX?: number`
- `translateY?: number`
- `scale?: number`
- `scaleX?: number`
- `scaleY?: number`
- `rotate?: number`
- `originX?: number`
- `originY?: number`
- `layer?: boolean`

### `Paint`

- `color?: string`
- `strokeWidth?: SkiaScalarValue`
- `style?: "fill" | "stroke"`
- `antiAlias?: boolean`
- `opacity?: SkiaScalarValue`
- `strokeCap?: "butt" | "round" | "square"`
- `strokeJoin?: "miter" | "round" | "bevel"`
- `strokeMiter?: SkiaScalarValue`
- `shader?: SkiaShaderProgram`

### Shapes

- `Rect`: `x`, `y`, `width`, `height`, plus local paint props and optional `shader`
- `Circle`: `cx`, `cy`, `r`, plus local paint props and optional `shader`
- `Path`: `path`, plus local paint props and optional `shader`
- `Text`: `text`, `font`, `x?`, `y?`, `color?`, `antiAlias?`, `opacity?`
- `Image`: `image`, `x`, `y`, `width`, `height`, `fit?`, `sampling?`, `antiAlias?`, `opacity?`
- `ImageSVG`: `svg`, `x?`, `y?`, `width?`, `height?`, `opacity?`
- `Skottie`: `animation`, `frame`, `x?`, `y?`, `width?`, `height?`, `opacity?`

### Effect nodes

- `Shader`: `source`, `uniforms?`
- `LinearGradient`: `start`, `end`, `colors`, `positions?`, `mode?`, `flags?`
- `Mask`: `mode?: "luminance"`, `mask?: JSX.Element`, `children?: JSX.Element`
