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
import {
  Canvas,
  Circle,
  Paint,
  Rect,
  createShader,
  createSkiaValue,
} from "@zynth/skia";

const [time, setTime] = createSkiaValue(0, { shared: true });
const shader = createShader(
  "h.rgba(32 + 160 * h.fract(u.t * 0.2 + input.x / input.width), 120, 220, 1)",
  { t: time },
);

<Canvas
  style={{ width: 240, height: 240 }}
  clearColor="#101418"
  time={time}
>
  <Paint shader={shader}>
    <Rect x={0} y={0} width={240} height={240} />
  </Paint>
  <Circle cx={120} cy={120} r={48} color="#60A5FA" />
</Canvas>;
```

Imperative APIs (`SkiaView`, `createSkiaSurface`) remain available for low-level control.
