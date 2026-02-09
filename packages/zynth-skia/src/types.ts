import type { HostNode, Style } from "@zynth/core";
import type { JSX } from "solid-js";

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
