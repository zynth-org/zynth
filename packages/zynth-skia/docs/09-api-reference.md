# API Reference

This page lists the public exports from `@zynthjs/skia` as they are exposed from `src/index.ts`. The package surface is split across view components, declarative drawing nodes, imperative surface helpers, resource loaders, shader utilities, reactive primitives, capability checks, and public types.

Use the focused pages for narrative guidance. Use this page as the package index when you need to locate a specific export quickly.

## Basic usage

```tsx
import {
  Canvas,
  Rect,
  createImage,
  createPath,
  createRuntimeEffect,
} from "@zynthjs/skia";
```

## Advanced examples

### Mixed declarative and resource exports

```tsx
import { Canvas, Image, ImageSVG, createImage, createSVG } from "@zynthjs/skia";

const image = createImage({ uri: "https://example.com/hero.png" });
const icon = createSVG({ uri: "https://example.com/icon.svg" });
```

### Namespace-style helpers

```tsx
import { Skia } from "@zynthjs/skia";

const effect = Skia.RuntimeEffect.Make(`
uniform float t;
half4 main(vec2 fragCoord) {
  return half4(t, 0.4, 0.8, 1.0);
}
`);
```

## Special cases and unusual features

- `useImage`, `useSVG`, `useSkottie`, `useClock`, `usePathInterpolation`, and `usePathValue` remain exported as compatibility aliases. The primary naming style is `createXxx`.
- `interpolateShared` and `toSharedScalar` are re-exported from `@zynthjs/core`.
- Some lower-level font manager factories exist through the `Skia` namespace but are not exported as top-level functions.
- The public type surface includes both declarative props and imperative command unions so that callers can author draw systems without importing private files.

## API Reference

### Components

- `SkiaView`
- `SkottieView`
- `Canvas`
- `Group`
- `Paint`
- `Rect`
- `Circle`
- `Path`
- `Text`
- `Image`
- `ImageSVG`
- `Skottie`
- `Shader`
- `LinearGradient`
- `Mask`

### Surface and drawing helpers

- `createSkiaSurface`
- `createPath`

### Shaders and values

- `createShader`
- `createRuntimeEffect`
- `createSkiaValue`
- `Skia`
- `interpolateShared`
- `toSharedScalar`

### Reactive primitives

- `createClock`
- `createPathInterpolation`
- `createPathValue`
- `useClock`
- `usePathInterpolation`
- `usePathValue`

### Fonts

- `createFont`
- `createFontFromStyle`
- `createFontLoader`
- `listFontFamilies`
- `matchFont`
- `useFont`
- `vec`

### Images

- `createImage`
- `makeImage`
- `makeImageFromEncoded`
- `makeSkiaDataFromBase64`
- `makeSkiaDataFromBytes`
- `useImage`
- `AlphaType`
- `ColorType`
- `CubicSampling`
- `FilterMode`
- `MipmapMode`

### SVG

- `createSVG`
- `makeSVGFromData`
- `makeSVGFromString`
- `useSVG`

### Skottie

- `createSkottie`
- `makeSkottie`
- `makeSkottieFromData`
- `makeSkottieFromString`
- `useSkottie`

### Capability helpers

- `getSkiaCapabilities`
- `supportsSkiaFeature`
- `assertSkiaFeature`

### Main component and controller types

- `SkiaViewProps`
- `SkiaSurface`
- `SkiaSurfaceController`
- `LayoutRectangle`
- `LayoutChangeEvent`

### Declarative prop types

- `SkiaCanvasProps`
- `SkiaGroupProps`
- `SkiaPaintProps`
- `SkiaRectProps`
- `SkiaCircleProps`
- `SkiaPathProps`
- `SkiaTextProps`
- `SkiaImageProps`
- `SkiaSVGProps`
- `SkiaSkottieProps`
- `SkiaShaderProps`
- `SkiaLinearGradientProps`
- `SkiaMaskProps`

### Draw command types

- `SkiaDrawCommand`
- `SkiaDrawClear`
- `SkiaDrawRect`
- `SkiaDrawCircle`
- `SkiaDrawLine`
- `SkiaDrawPath`
- `SkiaDrawText`
- `SkiaDrawImage`
- `SkiaDrawSVG`
- `SkiaDrawSkottie`
- `SkiaDrawRuntimeShaderRect`
- `SkiaDrawRuntimeShaderCircle`
- `SkiaDrawRuntimeShaderPath`
- `SkiaDrawSaveLayer`
- `SkiaDrawSaveLayerLuminanceMask`
- `SkiaDrawRestore`
- `SkiaFrameSpec`

### Path, shader, and value types

- `SkiaPathCommand`
- `SkiaPathObject`
- `SkiaPathSource`
- `SkiaShaderInput`
- `SkiaShaderProgram`
- `SkiaShaderSource`
- `SkiaRuntimeEffect`
- `SkiaRuntimeShaderUniform`
- `SkiaRuntimeShaderUniformMap`
- `SkiaRuntimeUniforms`
- `SkiaUniformMap`
- `SkiaUniformPrimitive`
- `SkiaUniformValue`
- `SkiaScalarValue`
- `CreateSkiaValueOptions`
- `SkiaValueTuple`
- `SkiaClockOptions`
- `SkiaProgressValue`
- `SkiaUsePathValueUpdater`
- `SkiaInterpolationToken`
- `SharedSignalAccessor`
- `SharedScalarRef`
- `InterpolatedScalarRef`

### Geometry, paint, and capability types

- `SkiaPoint`
- `SkiaPointLike`
- `SkiaTileMode`
- `SkiaLinearGradient`
- `SkiaStrokeCap`
- `SkiaStrokeJoin`
- `SkiaFeature`
- `SkiaCapabilities`

### Font and text types

- `SkiaFont`
- `SkiaFontManager`
- `SkiaFontStyle`
- `SkiaFontStyleSlant`
- `SkiaFontWeight`
- `SkiaTypeface`
- `SkiaTypefaceFontProvider`

### Image, SVG, and animation types

- `SkiaData`
- `SkiaImage`
- `SkiaImageSource`
- `SkiaImageInfo`
- `SkiaImageFit`
- `SkiaImageCubicSampling`
- `SkiaImageFilterMode`
- `SkiaImageMipmapMode`
- `SkiaImageSampling`
- `SkiaSVG`
- `SkiaSVGSource`
- `SkiaSkottie`
- `SkiaSkottieSource`
