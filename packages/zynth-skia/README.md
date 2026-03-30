# @zynth/skia

Skia rendering for Zynth, with declarative drawing nodes, imperative surface submission, resource loading helpers, runtime shaders, and reactive path utilities.

### Core

- [01 - Basic](./docs/01-basic.md)
  package overview, renderer model, and first canvas
- [02 - Declarative Canvas](./docs/02-declarative-canvas.md)
  `Canvas`, shape nodes, paint inheritance, gradients, masks, images, SVG, and Skottie
- [03 - Imperative Surface](./docs/03-imperative-surface.md)
  `SkiaView`, `createSkiaSurface()`, frames, and direct command submission

### Advanced

- [04 - Shaders and Values](./docs/04-shaders-and-values.md)
  `createShader()`, runtime effects, `Skia`, and shared values
- [05 - Paths, Transforms, and Capabilities](./docs/05-paths-transforms-capabilities.md)
  `createPath()`, SVG path parsing, transform props, and runtime feature checks
- [06 - Animations](./docs/06-animations.md)
  shared numeric values, scalar interpolation, and animated Skia props
- [07 - Reactive Primitives](./docs/07-reactive-primitives.md)
  `createClock()`, `createPathInterpolation()`, and `createPathValue()`
- [08 - Fonts](./docs/08-fonts.md)
  font creation, resource loading, matching, and text setup

### Reference

- [09 - API Reference](./docs/09-api-reference.md)
  public exports, command types, prop types, and package-level helpers

## Platform support

- Native rendering is available on iOS and Android.
- Web support is partial. Some helpers can run in browser-like environments, but there is no dedicated web renderer export in this package.
