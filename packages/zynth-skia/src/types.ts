import type { Accessor, JSX, Setter } from "solid-js";
import type { HostNode, Style } from "@zynth/core";

export type SkiaColorValue = string;

export type SkiaDrawClear = {
  type: "clear";
  color: SkiaColorValue;
};

export type SkiaDrawRect = {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  color: SkiaColorValue;
  strokeWidth?: number;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
};

export type SkiaDrawCircle = {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  color: SkiaColorValue;
  strokeWidth?: number;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
};

export type SkiaDrawLine = {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: SkiaColorValue;
  strokeWidth?: number;
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
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
  x: number;
  y: number;
  color: SkiaColorValue;
  fontFamily: string;
  fontSize: number;
  fontStyle?: SkiaFontStyleSlant;
  fontWeight?: SkiaFontWeight;
  antiAlias?: boolean;
  opacity?: number;
  matrix?: readonly [number, number, number, number, number, number];
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
  strokeWidth?: number;
  style?: "fill" | "stroke";
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
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

export type SkiaRuntimeShaderScalar = number | SkiaSharedSignalToken;
export type SkiaRuntimeShaderUniform =
  | SkiaRuntimeShaderScalar
  | readonly SkiaRuntimeShaderScalar[];
export type SkiaRuntimeShaderUniformMap = Record<string, SkiaRuntimeShaderUniform>;

export type SkiaDrawRuntimeShaderRect = {
  type: "runtimeShaderRect";
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: number;
};

export type SkiaDrawRuntimeShaderCircle = {
  type: "runtimeShaderCircle";
  cx: number;
  cy: number;
  r: number;
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: number;
};

export type SkiaDrawRuntimeShaderPath = {
  type: "runtimeShaderPath";
  commands: readonly SkiaPathCommand[];
  source: string;
  uniforms: SkiaRuntimeShaderUniformMap;
  antiAlias?: boolean;
  opacity?: number;
};

export type SkiaDrawCommand =
  | SkiaDrawClear
  | SkiaDrawRect
  | SkiaDrawCircle
  | SkiaDrawLine
  | SkiaDrawText
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

export type SkiaPaintStyle = "fill" | "stroke";
export type SkiaStrokeCap = "butt" | "round" | "square";
export type SkiaStrokeJoin = "miter" | "round" | "bevel";

export type SkiaPaintProps = {
  color?: SkiaColorValue;
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
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
  children?: JSX.Element;
};

export type SkiaRectProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: SkiaColorValue;
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaCircleProps = {
  cx: number;
  cy: number;
  r: number;
  color?: SkiaColorValue;
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
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
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  antiAlias?: boolean;
  opacity?: number;
  strokeCap?: SkiaStrokeCap;
  strokeJoin?: SkiaStrokeJoin;
  strokeMiter?: number;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaTextProps = {
  text: string;
  font: SkiaFont | Accessor<SkiaFont | null>;
  x?: number;
  y?: number;
  color?: SkiaColorValue;
  antiAlias?: boolean;
  opacity?: number;
  children?: JSX.Element;
};

export type SkiaFeature =
  | "paths"
  | "path.curves"
  | "paint.opacity"
  | "paint.strokeCap"
  | "paint.strokeJoin"
  | "paint.strokeMiter"
  | "group.transforms";

export type SkiaCapabilities = {
  paths: boolean;
  pathCurves: boolean;
  paintOpacity: boolean;
  paintStrokeCap: boolean;
  paintStrokeJoin: boolean;
  paintStrokeMiter: boolean;
  groupTransforms: boolean;
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
