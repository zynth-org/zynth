import type { Accessor, JSX, Setter } from "solid-js";
import type {
  HostNode,
  InterpolatedScalarRef,
  SharedScalarRef,
  Style,
} from "@zynth/core";

export type SkiaColorValue = string;
export type SkiaTileMode = "clamp" | "repeat" | "mirror" | "decal";

export type SkiaPoint = {
  x: SkiaScalarValue;
  y: SkiaScalarValue;
};

export type SkiaPointLike = SkiaPoint | readonly [number, number];

export type SkiaLinearGradient = {
  start: SkiaPoint;
  end: SkiaPoint;
  colors: readonly [SkiaColorValue, SkiaColorValue, ...SkiaColorValue[]];
  positions?: readonly SkiaScalarValue[];
  mode?: SkiaTileMode;
  flags?: SkiaScalarValue;
};

export type SkiaDrawClear = {
  type: "clear";
  color: SkiaColorValue;
};

export type SkiaDrawRect = {
  type: "rect";
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width: SkiaScalarValue;
  height: SkiaScalarValue;
  color: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  linearGradient?: SkiaLinearGradient;
};

export type SkiaDrawCircle = {
  type: "circle";
  cx: SkiaScalarValue;
  cy: SkiaScalarValue;
  r: SkiaScalarValue;
  color: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  linearGradient?: SkiaLinearGradient;
};

export type SkiaDrawLine = {
  type: "line";
  x1: SkiaScalarValue;
  y1: SkiaScalarValue;
  x2: SkiaScalarValue;
  y2: SkiaScalarValue;
  color: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
};

export type SkiaFontStyleSlant = "normal" | "italic" | "oblique";
export type SkiaFontWeight = "normal" | "bold" | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type SkiaFontStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: SkiaFontStyleSlant;
  fontWeight?: SkiaFontWeight;
};

export type SkiaTypeface = {
  familyName: string;
  fontStyle: SkiaFontStyleSlant;
  fontWeight: Exclude<SkiaFontWeight, "normal" | "bold"> | 400 | 700;
};

export type SkiaMeasuredText = {
  width: number;
};

export type SkiaFont = {
  familyName: string;
  size: number;
  fontStyle: SkiaFontStyleSlant;
  fontWeight: Exclude<SkiaFontWeight, "normal" | "bold"> | 400 | 700;
  measureText(text: string): SkiaMeasuredText;
};

export type SkiaFontManager = {
  listFontFamilies(): string[];
  matchFamilyStyle(
    familyName: string,
    style?: Partial<Pick<SkiaFontStyle, "fontStyle" | "fontWeight">>,
  ): SkiaTypeface | null;
};

export type SkiaTypefaceFontProvider = {
  registerTypeface(typeface: SkiaTypeface, familyName?: string): void;
  asFontManager(): SkiaFontManager;
};

export type SkiaDrawText = {
  type: "text";
  text: string;
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  color: SkiaColorValue;
  fontFamily: string;
  fontSize: SkiaScalarValue;
  fontStyle?: SkiaFontStyleSlant;
  fontWeight?: SkiaFontWeight;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  matrix?: readonly [number, number, number, number, number, number];
  linearGradient?: SkiaLinearGradient;
};

export type SkiaImageInfo = {
  width: number;
  height: number;
  alphaType: number;
  colorType: number;
};

export type SkiaImage = {
  readonly __skiaImage: true;
  readonly id: number;
  width(): number;
  height(): number;
  getImageInfo(): SkiaImageInfo;
  encodeToBytes(): Uint8Array;
  encodeToBase64(): string;
  readPixels(): Uint8Array | Float32Array;
  dispose(): void;
};

export type SkiaSVG = {
  readonly __skiaSVG: true;
  readonly id: number;
  width(): number;
  height(): number;
  dispose(): void;
};

export type SkiaSkottie = {
  readonly __skiaSkottie: true;
  readonly id: number;
  width(): number;
  height(): number;
  duration(): number;
  fps(): number;
  version(): string;
  dispose(): void;
};

export type SkiaImageFit =
  | "contain"
  | "fill"
  | "cover"
  | "fitHeight"
  | "fitWidth"
  | "scaleDown"
  | "none";

export type SkiaImageCubicSampling = {
  B: number;
  C: number;
};

export type SkiaImageFilterMode = "nearest" | "linear";
export type SkiaImageMipmapMode = "none" | "nearest" | "linear";

export type SkiaImageFilterSampling = {
  filter?: SkiaImageFilterMode;
  mipmap?: SkiaImageMipmapMode;
};

export type SkiaImageSampling = SkiaImageCubicSampling | SkiaImageFilterSampling;

export type SkiaDrawImage = {
  type: "image";
  imageId: number;
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width: SkiaScalarValue;
  height: SkiaScalarValue;
  fit?: SkiaImageFit;
  sampling?: SkiaImageSampling;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
};

export type SkiaDrawSVG = {
  type: "svg";
  svgId: number;
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width?: SkiaScalarValue;
  height?: SkiaScalarValue;
  opacity?: SkiaScalarValue;
};

export type SkiaDrawSkottie = {
  type: "skottie";
  animationId: number;
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  frame: SkiaScalarValue;
  width?: SkiaScalarValue;
  height?: SkiaScalarValue;
  opacity?: SkiaScalarValue;
};

export type SkiaPathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | { type: "quadTo"; cpx: number; cpy: number; x: number; y: number }
  | {
    type: "cubicTo";
    cp1x: number;
    cp1y: number;
    cp2x: number;
    cp2y: number;
    x: number;
    y: number;
  }
  | { type: "close" };

export type SkiaDrawPath = {
  type: "path";
  commands: readonly SkiaPathCommand[];
  color: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  linearGradient?: SkiaLinearGradient;
};

export type SkiaDrawSaveLayer = {
  type: "saveLayer";
};

export type SkiaDrawSaveLayerLuminanceMask = {
  type: "saveLayerLuminanceMask";
};

export type SkiaDrawRestore = {
  type: "restore";
};

export type SkiaSharedSignalToken = {
  __zynth_shared_value: number;
  __zynth_shared_signal_current: number;
};

export type SkiaInterpolationToken = SkiaSharedSignalToken & {
  __zynth_skia_interp_input: readonly number[];
  __zynth_skia_interp_output: readonly number[];
  __zynth_skia_interp_left?: "clamp" | "extend" | "identity";
  __zynth_skia_interp_right?: "clamp" | "extend" | "identity";
};

export type SkiaScalarValue =
  | number
  | SharedScalarRef
  | InterpolatedScalarRef
  | SkiaSharedSignalToken
  | SkiaInterpolationToken;

export type SkiaRuntimeShaderScalar = SkiaScalarValue;
export type SkiaRuntimeShaderUniform =
  | SkiaRuntimeShaderScalar
  | readonly SkiaRuntimeShaderScalar[];
export type SkiaRuntimeShaderUniformMap = Record<string, SkiaRuntimeShaderUniform>;

export type SkiaDrawRuntimeShaderRect = {
  type: "runtimeShaderRect";
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width: SkiaScalarValue;
  height: SkiaScalarValue;
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
};

export type SkiaDrawRuntimeShaderCircle = {
  type: "runtimeShaderCircle";
  cx: SkiaScalarValue;
  cy: SkiaScalarValue;
  r: SkiaScalarValue;
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
};

export type SkiaDrawRuntimeShaderPath = {
  type: "runtimeShaderPath";
  commands: readonly SkiaPathCommand[];
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
};

export type SkiaDrawCommand =
  | SkiaDrawClear
  | SkiaDrawSaveLayer
  | SkiaDrawSaveLayerLuminanceMask
  | SkiaDrawRestore
  | SkiaDrawRect
  | SkiaDrawCircle
  | SkiaDrawLine
  | SkiaDrawText
  | SkiaDrawImage
  | SkiaDrawSVG
  | SkiaDrawSkottie
  | SkiaDrawPath
  | SkiaDrawRuntimeShaderRect
  | SkiaDrawRuntimeShaderCircle
  | SkiaDrawRuntimeShaderPath;

export type SkiaFrameSpec = {
  clear?: SkiaColorValue;
  commands: SkiaDrawCommand[];
};

export type SkiaViewProps = {
  style?: Style;
  clearColor?: SkiaColorValue;
  frameLoop?: boolean;
  allowFallback?: boolean;
  commands?: SkiaDrawCommand[] | (() => SkiaDrawCommand[]);
  ref?: (node: HostNode | null) => void;
  onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void;
  children?: JSX.Element;
};

export type SkiaSurface = {
  submit(commands: SkiaDrawCommand[]): void;
  submitFrame(frame: SkiaFrameSpec): void;
  invalidate(): void;
  setFrameLoopEnabled(enabled: boolean): void;
  dispose(): void;
};

export type SkiaUniformPrimitive = number | string | readonly number[];
export type SkiaUniformValue =
  | SkiaUniformPrimitive
  | Accessor<SkiaUniformPrimitive>;

export type SkiaUniformMap = Record<string, SkiaUniformValue>;
export type SkiaRuntimeUniforms = SkiaUniformMap | Accessor<SkiaUniformMap>;

export type SkiaShaderInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  time: number;
};

export type SkiaShaderProgram = {
  source: string;
  uniforms: SkiaUniformMap;
  evaluate(input: SkiaShaderInput): SkiaColorValue;
  setUniform(name: string, value: SkiaUniformValue): void;
  runtimeEffect?: SkiaRuntimeEffect;
};

export type SkiaRuntimeEffect = {
  source: string;
  makeShader(uniforms?: SkiaRuntimeUniforms): SkiaShaderProgram;
};

export type SkiaShaderSource = SkiaShaderProgram | SkiaRuntimeEffect;

export type SkiaShaderProps = {
  source: SkiaShaderSource;
  uniforms?: SkiaRuntimeUniforms;
};

export type SkiaLinearGradientProps = {
  start: SkiaPointLike;
  end: SkiaPointLike;
  colors: readonly [SkiaColorValue, SkiaColorValue, ...SkiaColorValue[]];
  positions?: readonly SkiaScalarValue[];
  mode?: SkiaTileMode;
  flags?: SkiaScalarValue;
};

export type SkiaMaskProps = {
  mode?: "luminance";
  mask?: JSX.Element;
  children?: JSX.Element;
};

export type SkiaPaintStyle = "fill" | "stroke";
export type SkiaStrokeCap = "butt" | "round" | "square";
export type SkiaStrokeJoin = "miter" | "round" | "bevel";

export type SkiaPaintProps = {
  color?: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaCanvasProps = {
  style?: Style;
  clearColor?: SkiaColorValue;
  frameLoop?: boolean;
  allowFallback?: boolean;
  time?: number | Accessor<number>;
  ref?: (node: HostNode | null) => void;
  onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void;
  children?: JSX.Element;
};

export type SkiaGroupProps = {
  x?: number;
  y?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  originX?: number;
  originY?: number;
  layer?: boolean;
  children?: JSX.Element;
};

export type SkiaRectProps = {
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width: SkiaScalarValue;
  height: SkiaScalarValue;
  color?: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaCircleProps = {
  cx: SkiaScalarValue;
  cy: SkiaScalarValue;
  r: SkiaScalarValue;
  color?: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaPathObject = {
  readonly commands: readonly SkiaPathCommand[];
  moveTo(x: number, y: number): SkiaPathObject;
  lineTo(x: number, y: number): SkiaPathObject;
  quadTo(cpx: number, cpy: number, x: number, y: number): SkiaPathObject;
  cubicTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): SkiaPathObject;
  close(): SkiaPathObject;
  reset(): SkiaPathObject;
  clone(): SkiaPathObject;
};

export type SkiaPathSource = SkiaPathObject | readonly SkiaPathCommand[] | string;

export type SkiaPathProps = {
  path: SkiaPathSource;
  color?: SkiaColorValue;
  strokeWidth?: SkiaScalarValue;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: SkiaScalarValue;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaTextProps = {
  text: string;
  font: SkiaFont | Accessor<SkiaFont | null>;
  x?: SkiaScalarValue;
  y?: SkiaScalarValue;
  color?: SkiaColorValue;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
  children?: JSX.Element;
};

export type SkiaImageProps = {
  image: SkiaImage | Accessor<SkiaImage | null> | null;
  x: SkiaScalarValue;
  y: SkiaScalarValue;
  width: SkiaScalarValue;
  height: SkiaScalarValue;
  fit?: SkiaImageFit;
  sampling?: SkiaImageSampling;
  antiAlias?: boolean;
  opacity?: SkiaScalarValue;
};

export type SkiaSVGProps = {
  svg: SkiaSVG | Accessor<SkiaSVG | null> | null;
  x?: SkiaScalarValue;
  y?: SkiaScalarValue;
  width?: SkiaScalarValue;
  height?: SkiaScalarValue;
  opacity?: SkiaScalarValue;
};

export type SkiaSkottieProps = {
  animation: SkiaSkottie | Accessor<SkiaSkottie | null> | null;
  frame: SkiaScalarValue;
  x?: SkiaScalarValue;
  y?: SkiaScalarValue;
  width?: SkiaScalarValue;
  height?: SkiaScalarValue;
  opacity?: SkiaScalarValue;
};

export type SkiaFeature =
  | "paths"
  | "path.curves"
  | "paint.opacity"
  | "paint.strokeCap"
  | "paint.strokeJoin"
  | "paint.strokeMiter"
  | "group.transforms"
  | "text"
  | "font.measure"
  | "mask.luminance"
  | "shader.linearGradient"
  | "group.layer"
  | "images"
  | "svg"
  | "skottie";

export type SkiaCapabilities = {
  paths: boolean;
  pathCurves: boolean;
  paintOpacity: boolean;
  paintStrokeCap: boolean;
  paintStrokeJoin: boolean;
  paintStrokeMiter: boolean;
  groupTransforms: boolean;
  text: boolean;
  fontMeasure: boolean;
  maskLuminance: boolean;
  shaderLinearGradient: boolean;
  groupLayer: boolean;
  images: boolean;
  svg: boolean;
  skottie: boolean;
};

export type CreateSkiaValueOptions = {
  shared?: boolean;
};

export type SkiaValueTuple<T> = [Accessor<T>, Setter<T>];

export type SkiaClockOptions = {
  autoStart?: boolean;
  durationMs?: number;
  fallbackStepMs?: number;
};

export type SkiaProgressValue = number | Accessor<number>;

export type SkiaUsePathValueUpdater = (path: SkiaPathObject) => void;
