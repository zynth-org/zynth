# Custom Fonts in Skia

Zynth Skia supports using both system fonts and custom loaded fonts.

## Loading and Registering Fonts

The primary way to load a font for Skia is using the `createFont` utility. It handles the entire lifecycle: downloading the font, registering it with the OS, and registering it with the Skia engine.

### `createFont`

`createFont` returns a Solid Resource that integrates perfectly with `<Suspense>`. It is self-contained and is the only thing you need for a single font.

```tsx
import { Suspense } from "solid-js";
import { Canvas, Text, createFont } from "@zynth/skia";
import myFontFile from "./assets/my-font.ttf";

function MyCanvas() {
  // 1. Create the font (starts loading immediately)
  // You can pass an asset directly, or an object with a custom family name
  const font = createFont(myFontFile, 24);

  return (
    <Suspense fallback={<UILabel>Loading Font...</UILabel>}>
      {/* 2. Accessing font() triggers Suspense until ready */}
      <Canvas style={{ width: 300, height: 200 }}>
        <Text
          text="Hello Skia!"
          x={20}
          y={50}
          font={font()}
          color="white"
        />
      </Canvas>
    </Suspense>
  );
}
```

## Batch Loading

### `createFontLoader`

If you need to wait for multiple fonts before showing any UI, you can use `createFontLoader`. It returns a boolean resource that resolves when all fonts in the map are ready and registered.

```tsx
import { createFontLoader, createFontFromStyle } from "@zynth/skia";

const fontsReady = createFontLoader({
  "Heading": require("./bold.ttf"),
  "Body": require("./regular.ttf")
});

// Inside Suspense, once fontsReady() is true, 
// you can use createFontFromStyle for synchronous access.
const heading = createFontFromStyle({ fontFamily: "Heading", fontSize: 24 });
```

## APIs

### `createFont(source, size)`

Creates a `Resource<SkiaFont | null>`. 
- `source`: Can be a raw asset (from import), a URL string, or an object `{ fontFamily: string, resourceName: any }`.
- `size`: The font size in pixels.

### `createFontFromStyle(style)` (Synchronous)

Creates a `SkiaFont` object immediately from a style. This does **not** handle asynchronous loading. Use this when you are certain the font is already registered (e.g., after using `createFontLoader`).

### `listFontFamilies()`

Returns a list of all available font families, including system fonts and registered custom fonts.

## Native Implementation Details

When a font is loaded via the native bridge, it returns a local filesystem path. Zynth Skia uses this path to register the font directly with the Skia `SkTypeface` cache using `makeFromFile`. This ensures that Skia has direct, high-performance access to the font data without needing to pass large buffers back and forth through the JSI bridge.
