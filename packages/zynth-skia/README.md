# @zynth/skia

Declarative Skia rendering package for Zynth.

## Status

- Binary provisioning is manifest-driven via `binaries.manifest.json`.
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
yarn workspace @zynth/skia binaries:update --version 0.92.0
```

Update release version + artifact set and refresh checksums:

```bash
yarn workspace @zynth/skia binaries:update --version 0.92.0 --artifact-set <artifact_set_id>
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

- Skia release version
- platform/architecture artifact URLs
- destination paths under `native/vendor`
- optional SHA256 integrity locks

`binaries:sync` accepts empty `sha256` fields, but once `binaries:update` runs, the script writes locked checksums for reproducible installs.

By default, `postinstall` runs `binaries:sync`. To skip in CI/offline environments:

```bash
ZYNTH_SKIA_SKIP_BINARY_SYNC=1 yarn install
```

## Binary update policy

1. Change release inputs only through `binaries:update --version ...` (and `--artifact-set` if needed).
2. Never hand-edit checksum values.
3. Run `binaries:verify` before opening a PR.
4. If `binaries.manifest.json` changed, strict checksum verification is required in CI.
5. Keep `destination` paths deterministic under `native/vendor/<platform>/<arch>/<variant>`.

Release checklist:

1. `yarn workspace @zynth/skia binaries:update --version <tag> [--artifact-set <id>]`
2. `yarn workspace @zynth/skia binaries:verify`
3. Validate in app scenes (`SkiaParitySuiteExample`, shader demo scenes).
4. Commit manifest/script changes together.

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
