# @zynth/skia - Reactive Primitives

These APIs are reactive primitives designed for SolidJS + shared-signal rendering.

## Overview

`@zynth/skia` provides shared-signal-aware primitives for animation and path updates:

- `createClock`
- `createPathInterpolation`
- `createPathValue`

When these primitives receive shared-signal-backed values, Skia can resolve them natively during draw, without JS resubmission loops.

## `createClock`

```ts
const clock = createClock();
```

Returns an accessor number (seconds). It prefers native shared-signal animation and falls back to JS timing if native animate bridge is unavailable.

```ts
const uniforms = () => ({
  iTime: clock,
  iResolution: [width, height] as const,
});
```

## `createPathInterpolation`

```ts
const path = createPathInterpolation(
  progress,
  [0, 0.5, 1],
  [pathA, pathB, pathC],
);
```

Interpolates between compatible paths.

Rules:

- `inputRange.length` must equal `outputRange.length`
- all output paths must have matching command count + command types

Execution mode:

- shared-signal `progress` -> native token-driven interpolation
- plain number / non-shared accessor -> JS interpolation fallback

## `createPathValue`

```ts
const path = createPathValue((p) => {
  const x = clock() as unknown as number;
  p.moveTo(x, 170);
  p.lineTo(x, 230);
  p.lineTo(20, 200);
  p.close();
});
```

Builds a reactive path from an updater function.

Execution mode:

- updater emits tokenized shared-signal scalars -> native token-driven path
- updater emits only plain numbers -> JS reactive fallback

Optional initial path:

```ts
const path = createPathValue((p) => {
  // mutate from base commands
}, initialPath);
```

## Current constraints

- Tokenized path scalars currently require identity group transform for `Path` rendering.
- `createPathValue` native mode is token-driven. Arbitrary per-frame JS math inside updater is still JS mode unless expressed through tokenized/shared-signal values.

## Solid naming and compatibility aliases

Solid-first API names are:

- `createClock`
- `createPathInterpolation`
- `createPathValue`

Compatibility aliases (`useClock`, `usePathInterpolation`, `usePathValue`) are still exported for migration but are not the primary API style.
