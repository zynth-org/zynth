# @zynth/skia

Skia rendering for Zynth, with declarative drawing nodes, imperative surface submission, resource loading helpers, runtime shaders, and reactive path utilities.

### Core

- [Basic](./docs/01-basic)
  package overview, renderer model, and first canvas
- [Declarative Canvas](./docs/02-declarative-canvas)
  `Canvas`, shape nodes, paint inheritance, gradients, masks, images, SVG, and Skottie
- [Imperative Surface](./docs/03-imperative-surface)
  `SkiaView`, `createSkiaSurface()`, frames, and direct command submission

### Advanced

- [Shaders and Values](./docs/04-shaders-and-values)
  `createShader()`, runtime effects, `Skia`, and shared values
- [Paths, Transforms, and Capabilities](./docs/05-paths-transforms-capabilities)
  `createPath()`, SVG path parsing, transform props, and runtime feature checks
- [Animations](./docs/06-animations)
  shared numeric values, scalar interpolation, and animated Skia props
- [Reactive Primitives](./docs/07-reactive-primitives)
  `createClock()`, `createPathInterpolation()`, and `createPathValue()`
- [Fonts](./docs/08-fonts)
  font creation, resource loading, matching, and text setup

### Reference

- [API Reference](./docs/09-api-reference)
  public exports, command types, prop types, and package-level helpers

## Platform support

- Native rendering is available on iOS and Android.
- Web support is partial. Some helpers can run in browser-like environments, but there is no dedicated web renderer export in this package.
