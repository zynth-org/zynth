# @zynth/skia

Declarative and imperative Skia rendering for Zynth.

This README is the docs index. Each section is split into a separate page so tooling can parse it independently.

## Docs index

### Basic

- [01 - Basic](./docs/01-basic.md)
  install, first canvas, and minimal setup
- [02 - Declarative Canvas API](./docs/02-declarative-canvas.md)
  `Canvas`, `Group`, `Paint`, `Rect`, `Circle`, `Path`

### Advanced

- [03 - Imperative Surface API](./docs/03-imperative-surface.md)
  `SkiaView`, `createSkiaSurface`, and command submission
- [04 - Shaders and Values](./docs/04-shaders-and-values.md)
  `createShader`, `createSkiaValue`, uniform patterns
- [05 - Paths, Transforms, Capabilities](./docs/05-paths-transforms-capabilities.md)
  SVG path coverage (`A/a` included), group transforms, feature gates
- [06 - Binaries and Native Assets](./docs/06-binaries-and-assets.md)
  manifest contract, sync/update/verify policy
- [08 - Reactive Primitives](./docs/08-reactive-primitives.md)
  shared-signal-first primitives (`createClock`, `createPathInterpolation`, `createPathValue`)

### API reference

- [07 - API Reference](./docs/07-api-reference.md)
  exported functions, components, and core types

## Status

- Binary provisioning is manifest-driven via `binaries.manifest.json`.
- Native `zynth-skia-view` is available on iOS and Android.
- Declarative + imperative paths share the same packed native command flow.

## Maintainers

For release and artifact maintenance, use [06 - Binaries and Native Assets](./docs/06-binaries-and-assets.md).
