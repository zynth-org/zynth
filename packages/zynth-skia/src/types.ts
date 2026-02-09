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
};

export type SkiaDrawCircle = {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  color: SkiaColorValue;
  strokeWidth?: number;
  style?: "fill" | "stroke";
};

export type SkiaDrawLine = {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: SkiaColorValue;
  strokeWidth?: number;
};

export type SkiaDrawCommand =
  | SkiaDrawClear
  | SkiaDrawRect
  | SkiaDrawCircle
  | SkiaDrawLine;

export type SkiaFrameSpec = {
  clear?: SkiaColorValue;
  commands: SkiaDrawCommand[];
};

export type SkiaViewProps = {
  style?: Style;
  clearColor?: SkiaColorValue;
  frameLoop?: boolean;
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
};

export type SkiaPaintStyle = "fill" | "stroke";

export type SkiaPaintProps = {
  color?: SkiaColorValue;
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  shader?: SkiaShaderProgram;
  children?: JSX.Element;
};

export type SkiaCanvasProps = {
  style?: Style;
  clearColor?: SkiaColorValue;
  frameLoop?: boolean;
  time?: number | Accessor<number>;
  ref?: (node: HostNode | null) => void;
  onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void;
  children?: JSX.Element;
};

export type SkiaGroupProps = {
  x?: number;
  y?: number;
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
  shader?: SkiaShaderProgram;
};

export type SkiaCircleProps = {
  cx: number;
  cy: number;
  r: number;
  color?: SkiaColorValue;
  strokeWidth?: number;
  style?: SkiaPaintStyle;
  shader?: SkiaShaderProgram;
};

export type SkiaPathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | { type: "close" };

export type SkiaPathObject = {
  readonly commands: readonly SkiaPathCommand[];
  moveTo(x: number, y: number): SkiaPathObject;
  lineTo(x: number, y: number): SkiaPathObject;
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
  shader?: SkiaShaderProgram;
};

export type CreateSkiaValueOptions = {
  shared?: boolean;
};

export type SkiaValueTuple<T> = [Accessor<T>, Setter<T>];
