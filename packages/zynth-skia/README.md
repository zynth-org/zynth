# @zynth/skia

Declarative Skia rendering package for Zynth.

## Status

- Binary provisioning is manifest-driven via `binaries.manifest.json`.
- Binary source is a package-scoped GitHub release hosted in `x64Bits/skia-assets`.
- Native `zynth-skia-view` component is available on iOS and Android.
- Sync surface API is exposed for draw submission and frame invalidation.

## Quickstart

Install:

```bash
yarn add @zynth/skia
```

Render primitives:

```tsx
import { Canvas, Circle, Group, Path, Rect } from "@zynth/skia";

export function BasicSkiaScene() {
  return (
    <Canvas clearColor="#0B1220" style={{ width: 320, height: 180 }}>
      <Group>
        <Rect x={18} y={18} width={284} height={144} color="#1E293B" style="stroke" strokeWidth={2} />
        <Path path="M 0 90 L 320 90 M 160 0 L 160 180" color="#334155" style="stroke" strokeWidth={2} />
        <Circle cx={160} cy={90} r={26} color="#38BDF8" />
      </Group>
    </Canvas>
  );
}
```

Drive shader uniforms from Solid signals:

```tsx
import { Canvas, Paint, Rect, createShader, createSkiaValue } from "@zynth/skia";

const [timeSec, setTimeSec] = createSkiaValue(0, { shared: true });
const shader = createShader(
  "h.rgba(40 + 140 * h.fract(u.t * 0.25 + input.x / input.width), 90, 210, 1)",
  { t: timeSec },
);

<Canvas clearColor="#020617" time={timeSec} style={{ width: 320, height: 180 }}>
  <Paint shader={shader}>
    <Rect x={0} y={0} width={320} height={180} />
  </Paint>
</Canvas>;
```

## Shader cookbook

Gradient sweep:

```ts
const shader = createShader(
  "h.rgba(20 + 180 * h.fract((input.x + input.y) * 0.004 + u.t * 0.2), 90, 220, 1)",
  { t: timeSec },
);
```

Pulse by distance:

```ts
const shader = createShader(
  "h.rgba(70, 170 + 70 * Math.abs(Math.sin(Math.hypot(input.x - 160, input.y - 90) * 0.03 - u.t * 2)), 230, 1)",
  { t: timeSec },
);
```

Shared-signal uniform driver:

```ts
const [boost, setBoost] = createSkiaValue(0.35, { shared: true });
const shader = createShader("h.rgba(36 + 120 * u.boost, 110, 220, 1)", { boost });
```

## Commands

Manual sync for maintainers/local debugging:

```bash
yarn workspace @zynth/skia binaries:sync
```

Force refresh and update checksums from current manifest URLs:

```bash
yarn workspace @zynth/skia binaries:update
```

Update release version and refresh checksums:

```bash
yarn workspace @zynth/skia binaries:update --version zynth-skia-binaries-v0.0.2-skia-graphite-m142b
```

Verify manifest structure:

```bash
yarn workspace @zynth/skia binaries:verify
```

Verify manifest with strict checksum enforcement (CI for manifest edits):

```bash
node packages/zynth-skia/scripts/manage-binaries.mjs verify --strict-checksums
```

## Binary manifest

`binaries.manifest.json` is the source of truth for:

- release tag that hosts mirrored Skia artifacts
- platform/architecture artifact URLs
- destination paths under `native/vendor`
- optional SHA256 integrity locks

`binaries:sync` accepts empty `sha256` fields, but once `binaries:update` runs, the script writes locked checksums for reproducible installs.

## Binary layout contract

`binaries:sync` normalizes downloaded archives into deterministic package-local layouts:

- Android destination (`native/vendor/android/<abi>/gl-pdf`):
  - keeps only linkable/runtime payload files (`.a`, `.so`, `.dat`)
  - removes archive build byproducts (`obj`, `gen`, ninja metadata files)
- iOS destination (`native/vendor/ios/<arch>/<target>/metal-pdf`):
  - writes `xcframeworks/` with all packaged `*.xcframework` bundles
  - writes `libs/` with slice-selected static libraries for that target
  - keeps `libskia.a` at destination root as a temporary compatibility shim during native migration

By default, `postinstall` runs `binaries:sync`. To skip in CI/offline environments:

```bash
ZYNTH_SKIA_SKIP_BINARY_SYNC=1 yarn install
```

## Binary update policy

1. Mirror the approved asset set into a package-scoped GitHub release tag.
2. Change release inputs only through `binaries:update --version ...`.
3. Keep mirrored asset filenames stable, or update `binaries.manifest.json` URLs accordingly.
4. Never hand-edit checksum values.
5. Run `binaries:verify` before opening a PR.
6. If `binaries.manifest.json` changed, strict checksum verification is required in CI.
7. Keep `destination` paths deterministic under `native/vendor/<platform>/<arch>/<variant>`.

Release checklist:

1. Publish/mirror the required assets into `https://github.com/x64Bits/skia-assets/releases/tag/<tag>`.
2. `yarn workspace @zynth/skia binaries:update --version <tag>`
3. `yarn workspace @zynth/skia binaries:verify`
4. Validate in app scenes (`SkiaParitySuiteExample`, shader demo scenes).
5. Commit manifest/script changes together.

## Usage

```tsx
import {
  Canvas,
  Circle,
  Paint,
  Rect,
  Path,
  getSkiaCapabilities,
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
  <Path
    path="M 24 120 C 80 24 160 196 216 88"
    color="#A855F7"
    style="stroke"
    strokeWidth={3}
    strokeCap="round"
  />
</Canvas>;

const caps = getSkiaCapabilities();
if (!caps.pathCurves) {
  throw new Error("This runtime does not support curved paths.");
}
```

Imperative APIs (`SkiaView`, `createSkiaSurface`) remain available for low-level control.
