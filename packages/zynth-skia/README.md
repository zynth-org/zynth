# @zynth/skia

Declarative Skia rendering package for Zynth.

## Status

- Binary provisioning is manifest-driven via `binaries.manifest.json`.
- Native `zynth-skia-view` component is available on iOS and Android.
- Sync surface API is exposed for draw submission and frame invalidation.

## Commands

Automatic install-time sync (default):

```bash
yarn add @zynth/skia
```

Manual sync for maintainers/local debugging:

```bash
yarn workspace @zynth/skia binaries:sync
```

Force refresh and update `sha256` values in the manifest:

```bash
yarn workspace @zynth/skia binaries:update
```

## Binary manifest

`binaries.manifest.json` is the source of truth for:

- Skia release version
- platform/architecture artifact URLs
- destination paths under `native/vendor`
- optional SHA256 integrity locks

`binaries:sync` accepts empty `sha256` fields, but once `binaries:update` runs, the script writes locked checksums for reproducible installs.

By default, `postinstall` runs `binaries:sync`. To skip in CI/offline environments:

```bash
ZYNTH_SKIA_SKIP_BINARY_SYNC=1 yarn install
```

## Usage

```tsx
import { SkiaView, createSkiaSurface } from "@zynth/skia";

const surface = createSkiaSurface();

<SkiaView
  ref={(node) => surface.bind(node)}
  style={{ width: 240, height: 240 }}
  clearColor="#101418"
  frameLoop={true}
/>;

surface.submit([
  { type: "rect", x: 12, y: 12, width: 96, height: 72, color: "#4ADE80" },
  { type: "circle", cx: 170, cy: 88, r: 42, color: "#60A5FA" },
  { type: "line", x1: 16, y1: 180, x2: 220, y2: 220, color: "#F59E0B", strokeWidth: 3 },
]);
```
