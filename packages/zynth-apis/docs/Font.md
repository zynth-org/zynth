# Font

The `Font` API provides a deep integration with native font managers for dynamic registration and high-performance font scaling.

It enables loading custom Typeface files (.ttf, .otf) at runtime and provides SolidJS-integrated loaders that synchronize with `Suspense` for a seamless loading experience.

## Basic usage

### Manual Font Loading

To load a single font family, use `Font.loadAsync`. This registers the font with the OS and makes it available to the Zynth style system immediately.

```ts
import { Font } from "@zynthjs/apis";

async function setupFonts() {
  await Font.loadAsync("MyCustomFont", "path/to/font.ttf");
}
```

### SolidJS Integration (Recommended)

Use `createFontLoader` to create a reactive resource. This works natively with SolidJS's `<Suspense>`, allowing you to show a loading state while fonts are being registered.

```tsx
import { createFontLoader } from "@zynthjs/apis";
import { Suspense } from "solid-js";

const fontsReady = createFontLoader({
  "BrandFont": "brand-bold.ttf",
  "UIFont": "inter-regular.otf"
});

function App() {
  return (
    <Suspense fallback={<Loading />}>
       <MainScreen ready={fontsReady()} />
    </Suspense>
  );
}
```

## Advanced

### Font Asset Descriptors

For complex projects using asset bundling, you can pass a `FontAssetDescriptor` which contains metadata about the hash and development paths.

```ts
Font.loadAsync("MonoFont", {
  type: "font",
  name: "source-code-pro",
  ext: "ttf",
  hash: "e3b0c442...",
  devPath: "assets/fonts/mono.ttf"
});
```

## Special cases

- **Caching**: Once a font is successfully loaded into the OS typeface manager, subsequent calls to `loadAsync` for the same family name will return immediately with a success status.
- **Web Parity**: On the web, this API dynamically injects `@font-face` rules or uses the `FontFace` API to ensure that font family names resolve correctly in the CSS engine.
- **Development Server**: When running with a Zynth development server, fonts requested via `devPath` are automatically proxied through the server's file system bridge (`/@fs/`).

## API Reference

### `Font.loadAsync(family: string, source: string | FontAssetDescriptor): Promise<FontLoadResult>`
Natively loads and registers a font.

### `Font.register(family, options): void`
Registers a font mapping without immediately loading it. Useful for pre-defining web-specific sources.

### `createFontLoader(map: Record<string, string | descriptor>): Resource<boolean>`
A high-level SolidJS primitive that resolves when all fonts in the map are loaded.

### `FontLoadResult` (Type)
- `success: boolean`
- `error?: string`
