# Fonts

Text rendering in `@zynth/skia` is based on explicit font objects. You can construct fonts synchronously from style information, resolve a best match from a font manager, or load and register font files as Solid resources for use with `Suspense`.

This page covers the public helpers used to build `font` values for the `Text` node and the related font discovery utilities.

## Basic usage

```tsx
import { Canvas, Text, createFontFromStyle } from "@zynth/skia";

const titleFont = createFontFromStyle({
  fontFamily: "System",
  fontSize: 24,
  fontWeight: 700,
});

export function FontExample() {
  return (
    <Canvas clearColor="#0f172a" style={{ width: 320, height: 120 }}>
      <Text text="Skia text" x={24} y={68} font={titleFont} color="#f8fafc" />
    </Canvas>
  );
}
```

## Advanced examples

### Loading a custom font resource

```tsx
import { Show, Suspense } from "solid-js";
import { Canvas, Text, createFont } from "@zynth/skia";
import interSemiBold from "./assets/Inter-SemiBold.ttf";

const font = createFont(interSemiBold, 20);

export function LoadedFontScene() {
  return (
    <Suspense fallback={null}>
      <Canvas style={{ width: 320, height: 120 }}>
        <Text text="Loaded font" x={24} y={68} font={font()!} color="#111827" />
      </Canvas>
    </Suspense>
  );
}
```

### Preloading multiple families

```tsx
import { Show, Suspense } from "solid-js";
import {
  Canvas,
  Text,
  createFontFromStyle,
  createFontLoader,
} from "@zynth/skia";
import headingFontFile from "./assets/Heading-Bold.ttf";
import bodyFontFile from "./assets/Body-Regular.ttf";

const fontsReady = createFontLoader({
  Heading: headingFontFile,
  Body: bodyFontFile,
});

const heading = createFontFromStyle({
  fontFamily: "Heading",
  fontSize: 22,
  fontWeight: 700,
});

export function PreloadedFonts() {
  return (
    <Suspense fallback={null}>
      <Show when={fontsReady()}>
        <Canvas style={{ width: 320, height: 120 }}>
          <Text text="Heading" x={24} y={66} font={heading} color="#1e293b" />
        </Canvas>
      </Show>
    </Suspense>
  );
}
```

### Matching from a font manager

```tsx
import { Canvas, Text, Skia, matchFont } from "@zynth/skia";

const systemFontMgr = Skia.FontMgr.System();

const caption = matchFont(
  {
    fontFamily: "System",
    fontSize: 14,
    fontWeight: 500,
  },
  systemFontMgr,
);

export function MatchedFont() {
  return (
    <Canvas style={{ width: 240, height: 80 }}>
      <Text text="Caption" x={16} y={44} font={caption} color="#334155" />
    </Canvas>
  );
}
```

## Special cases and unusual features

- `Text` accepts either a `SkiaFont` instance or an accessor that resolves to `SkiaFont | null`.
- `createFont()` and `createFontLoader()` integrate with `Suspense` because they return Solid resources.
- `listFontFamilies()` can inspect either the default system manager or a custom font manager.
- `matchFont()` preserves the requested style when an exact match is not available.
- `vec(x, y)` is exported from the same module because it is commonly used when building text-adjacent geometry and gradient inputs.

## API Reference

### `createFontFromStyle(style)`

- `style: { fontFamily?: string; fontSize?: number; fontStyle?: "normal" | "italic" | "oblique"; fontWeight?: "normal" | "bold" | 100..900 }`
- returns `SkiaFont`

### `createFont(source, fontSize)`

- `source: unknown`
- `fontSize: number`
- returns `Resource<SkiaFont | null>`

### `createFontLoader(map)`

- `map: Record<string, string | FontAssetDescriptor>`
- returns `Resource<boolean>`

### Font helpers

- `matchFont(style, fontMgr?)`
- `listFontFamilies(fontMgr?)`
- `useFont(source, fontSize)` alias of `createFont`
- `vec(x, y)`

### `Skia` namespace font helpers

- `Skia.FontMgr.System()`
- `Skia.TypefaceFontProvider.Make()`
- `Skia.Font(typeface, size)`
- `Skia.matchFont(style, fontMgr?)`
