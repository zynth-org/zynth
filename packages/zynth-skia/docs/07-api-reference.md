# @zynth/skia - API Reference

## Exports

### Components

- `SkiaView`
- `Canvas`
- `Group`
- `Paint`
- `Rect`
- `Circle`
- `Path`
- `Shader`
- `LinearGradient`
- `Mask`
- `Text`

### Factories / helpers

- `createSkiaSurface`
- `createPath`
- `createShader`
- `createRuntimeEffect`
- `createSkiaValue`
- `toSharedScalar`
- `interpolateShared`
- `createFont`
- `useFont`
- `matchFont`
- `listFontFamilies`
- `vec`
- `createClock`
- `createPathInterpolation`
- `createPathValue`
- `Skia`
- `getSkiaCapabilities`
- `supportsSkiaFeature`
- `assertSkiaFeature`

## Core runtime types

- `SkiaSurface`
  - `submit(commands)`
  - `submitFrame(frame)`
  - `invalidate()`
  - `setFrameLoopEnabled(enabled)`
  - `dispose()`

- `SkiaSurfaceController`
  - `bind(node)`
  - `currentNodeId()`
  - includes all `SkiaSurface` methods

## Draw command union

`SkiaDrawCommand`:

- `SkiaDrawClear`
  - `{ type: "clear", color }`
- `SkiaDrawSaveLayer`
  - `{ type: "saveLayer" }`
- `SkiaDrawSaveLayerLuminanceMask`
  - `{ type: "saveLayerLuminanceMask" }`
- `SkiaDrawRestore`
  - `{ type: "restore" }`
- `SkiaDrawRect`
  - `{ type: "rect", x, y, width, height, color, linearGradient?, ...paintFields }`
- `SkiaDrawCircle`
  - `{ type: "circle", cx, cy, r, color, linearGradient?, ...paintFields }`
- `SkiaDrawLine`
  - `{ type: "line", x1, y1, x2, y2, color, ...paintFields }`
- `SkiaDrawPath`
  - `{ type: "path", commands, color, linearGradient?, ...paintFields }`
- `SkiaDrawText`
  - `{ type: "text", text, x, y, color, fontFamily, fontSize, fontStyle?, fontWeight?, antiAlias?, opacity?, linearGradient? }`
- `SkiaDrawRuntimeShaderRect`
  - `{ type: "runtimeShaderRect", x, y, width, height, source, uniforms, antiAlias?, opacity? }`

Shared paint fields:

- `strokeWidth?`
- `style?: "fill" | "stroke"`
- `antiAlias?`
- `opacity?`
- `strokeCap?: "butt" | "round" | "square"`
- `strokeJoin?: "miter" | "round" | "bevel"`
- `strokeMiter?`

## Declarative props

- `SkiaCanvasProps`
- `SkiaGroupProps`
- `SkiaPaintProps`
- `SkiaRectProps`
- `SkiaCircleProps`
- `SkiaPathProps`
- `SkiaTextProps`
- `SkiaLinearGradientProps`
- `SkiaMaskProps`

## Path types

- `SkiaPathCommand`
  - `moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`
- `SkiaPathObject`
  - `moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`, `reset`, `clone`
- `SkiaPathSource`
  - `SkiaPathObject | SkiaPathCommand[] | string`

## Shader and value types

- `SkiaShaderInput`
- `SkiaLinearGradient`
- `SkiaPoint`
- `SkiaPointLike`
- `SkiaTileMode`
- `SkiaShaderProps`
- `SkiaShaderProgram`
- `SkiaShaderSource`
- `SkiaFontStyle`
- `SkiaFontStyleSlant`
- `SkiaFontWeight`
- `SkiaTypeface`
- `SkiaFont`
- `SkiaFontManager`
- `SkiaTypefaceFontProvider`
- `SkiaRuntimeEffect`
- `SkiaRuntimeShaderUniform`
- `SkiaRuntimeShaderUniformMap`
- `SkiaRuntimeUniforms`
- `SkiaUniformPrimitive`
- `SkiaUniformValue`
- `SkiaUniformMap`
- `CreateSkiaValueOptions`
- `SkiaValueTuple<T>`
- `SkiaClockOptions`
- `SkiaProgressValue`
- `SkiaUsePathValueUpdater`
- `SkiaSharedSignalToken`
- `SkiaInterpolationToken`

Compatibility note:

- Legacy `SkiaSharedSignalToken` / `SkiaInterpolationToken` object literals remain supported for migration, but `toSharedScalar` and `interpolateShared` are the preferred API.
- `SkiaScalarValue`
- `SharedSignalAccessor`
- `SharedScalarRef`
- `InterpolatedScalarRef`

## Feature-gate types

- `SkiaFeature`
  - `paths`
  - `path.curves`
  - `paint.opacity`
  - `paint.strokeCap`
  - `paint.strokeJoin`
  - `paint.strokeMiter`
- `group.transforms`
  - `text`
  - `font.measure`
  - `mask.luminance`
  - `shader.linearGradient`
  - `group.layer`
- `SkiaCapabilities`
