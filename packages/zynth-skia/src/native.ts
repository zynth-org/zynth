import { callNativeSync, getNativeModule, unwrapNativeResult } from "@zynth/core";
import {
  type SkiaCapabilities,
  type SkiaDrawCommand,
  type SkiaFeature,
  type SkiaFrameSpec,
  type SkiaInterpolationToken,
  type SkiaSharedSignalToken,
  type SkiaStrokeCap,
  type SkiaStrokeJoin,
} from "./types";

const MODULE_NAME = "Skia";
const BRIDGE_KEY = "__zynth_skia";

type SkiaNativeBridge = {
  createSurface(nodeId: number): boolean;
  disposeSurface(nodeId: number): boolean;
  submitDrawCommands(nodeId: number, commands: SkiaDrawCommand[]): boolean;
  submitDrawCommandsPacked?: (
    nodeId: number,
    ops: ArrayBuffer,
    opCount: number,
    stringTable: Array<string | null>,
  ) => boolean;
  submitFrame(nodeId: number, frame: SkiaFrameSpec): boolean;
  invalidateSurface(nodeId: number): boolean;
  setFrameLoopEnabled(nodeId: number, enabled: boolean): boolean;
  capabilities?: Partial<SkiaCapabilities>;
};

type SkiaSurfacePayload = {
  nodeId: number;
};

type SkiaSubmitPayload = {
  nodeId: number;
  commands?: SkiaDrawCommand[];
  frame?: SkiaFrameSpec;
};

type SkiaFrameLoopPayload = {
  nodeId: number;
  enabled: boolean;
};

const enum PackedOpcode {
  Clear = 1,
  Rect = 2,
  Circle = 3,
  Line = 4,
  Path = 5,
  RuntimeShaderRect = 6,
  RuntimeShaderCircle = 7,
  RuntimeShaderPath = 8,
  Text = 9,
}

const enum PackedColorType {
  Int = 1,
  String = 2,
}

const enum PackedStyle {
  Fill = 0,
  Stroke = 1,
}

const enum PackedStrokeCap {
  Butt = 0,
  Round = 1,
  Square = 2,
}

const enum PackedStrokeJoin {
  Miter = 0,
  Round = 1,
  Bevel = 2,
}

const enum PackedPathVerb {
  MoveTo = 0,
  LineTo = 1,
  QuadTo = 2,
  CubicTo = 3,
  Close = 4,
}

const PACKED_STREAM_MAGIC = 900719;
const PACKED_STREAM_VERSION = 2;

const enum PackedScalarKind {
  Literal = 0,
  SharedSignal = 1,
  Interpolation = 2,
}

type PackedCommands = {
  ops: ArrayBuffer;
  opCount: number;
  stringTable: string[];
};

const defaultCapabilities: SkiaCapabilities = {
  paths: false,
  pathCurves: false,
  paintOpacity: false,
  paintStrokeCap: false,
  paintStrokeJoin: false,
  paintStrokeMiter: false,
  groupTransforms: true,
};

const featureCapabilityMap: Record<SkiaFeature, keyof SkiaCapabilities> = {
  paths: "paths",
  "path.curves": "pathCurves",
  "paint.opacity": "paintOpacity",
  "paint.strokeCap": "paintStrokeCap",
  "paint.strokeJoin": "paintStrokeJoin",
  "paint.strokeMiter": "paintStrokeMiter",
  "group.transforms": "groupTransforms",
};

function parsePackedColor(value: string): number | null {
  const raw = value.trim();
  if (!raw.startsWith("#")) return null;
  const hex = raw.slice(1);
  if (hex.length !== 6 && hex.length !== 8) return null;
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed)) return null;
  const unsigned = hex.length === 6 ? ((0xff << 24) | parsed) >>> 0 : parsed >>> 0;
  return unsigned | 0;
}

function addPackedString(
  table: string[],
  index: Map<string, number>,
  value: string,
): number {
  const existing = index.get(value);
  if (existing != null) return existing;
  const next = table.length;
  table.push(value);
  index.set(value, next);
  return next;
}

function pushPackedColor(
  encoded: number[],
  color: string,
  table: string[],
  index: Map<string, number>,
) {
  const parsed = parsePackedColor(color);
  if (parsed != null) {
    encoded.push(PackedColorType.Int, parsed);
    return;
  }
  const stringIndex = addPackedString(table, index, color);
  encoded.push(PackedColorType.String, stringIndex);
}

function isSharedSignalToken(value: unknown): value is SkiaSharedSignalToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<SkiaSharedSignalToken>;
  return (
    typeof token.__zynth_shared_value === "number"
    && typeof token.__zynth_shared_signal_current === "number"
  );
}

function isInterpolationToken(value: unknown): value is SkiaInterpolationToken {
  if (!isSharedSignalToken(value)) return false;
  const token = value as Partial<SkiaInterpolationToken>;
  return Array.isArray(token.__zynth_skia_interp_input)
    && Array.isArray(token.__zynth_skia_interp_output);
}

function encodeExtrapolationMode(mode: unknown): number {
  if (mode === "identity") return 2;
  if (mode === "extend") return 1;
  return 0;
}

function interpolateSnapshot(
  source: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  leftMode: number,
  rightMode: number,
): number {
  if (inputRange.length !== outputRange.length || inputRange.length < 2) {
    return outputRange[0] ?? 0;
  }
  if (source <= inputRange[0]!) {
    if (leftMode === 2) return source;
    if (leftMode === 0) return outputRange[0]!;
  }
  if (source >= inputRange[inputRange.length - 1]!) {
    if (rightMode === 2) return source;
    if (rightMode === 0) return outputRange[outputRange.length - 1]!;
  }

  let index = 0;
  for (let i = 0; i < inputRange.length - 1; i += 1) {
    const start = inputRange[i]!;
    const end = inputRange[i + 1]!;
    if (source >= start && source <= end) {
      index = i;
      break;
    }
    if (source > end) {
      index = i;
    }
  }

  const inMin = inputRange[index]!;
  const inMax = inputRange[index + 1]!;
  const outMin = outputRange[index]!;
  const outMax = outputRange[index + 1]!;
  const span = inMax - inMin;
  if (span === 0) return outMin;
  const t = (source - inMin) / span;
  return outMin + (outMax - outMin) * t;
}

function normalizePackedNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pushPackedScalar(encoded: number[], value: unknown, fallback = 0): void {
  if (isInterpolationToken(value)) {
    const inputRange = value.__zynth_skia_interp_input;
    const outputRange = value.__zynth_skia_interp_output;
    const count = Math.min(inputRange.length, outputRange.length);
    if (count < 2) {
      encoded.push(
        PackedScalarKind.SharedSignal,
        value.__zynth_shared_value,
        normalizePackedNumber(value.__zynth_shared_signal_current, fallback),
      );
      return;
    }
    const inValues = inputRange.slice(0, count);
    const outValues = outputRange.slice(0, count);
    const leftMode = encodeExtrapolationMode(value.__zynth_skia_interp_left);
    const rightMode = encodeExtrapolationMode(value.__zynth_skia_interp_right);
    const snapshot = interpolateSnapshot(
      normalizePackedNumber(value.__zynth_shared_signal_current, fallback),
      inValues,
      outValues,
      leftMode,
      rightMode,
    );
    encoded.push(
      PackedScalarKind.Interpolation,
      value.__zynth_shared_value,
      snapshot,
      count,
      ...inValues,
      ...outValues,
      leftMode,
      rightMode,
    );
    return;
  }
  if (isSharedSignalToken(value)) {
    encoded.push(
      PackedScalarKind.SharedSignal,
      value.__zynth_shared_value,
      normalizePackedNumber(value.__zynth_shared_signal_current, fallback),
    );
    return;
  }
  encoded.push(PackedScalarKind.Literal, normalizePackedNumber(value, fallback));
}

function materializeScalar(value: unknown, fallback = 0): number {
  if (isInterpolationToken(value)) {
    const inputRange = value.__zynth_skia_interp_input;
    const outputRange = value.__zynth_skia_interp_output;
    const count = Math.min(inputRange.length, outputRange.length);
    if (count < 2) {
      return normalizePackedNumber(value.__zynth_shared_signal_current, fallback);
    }
    const leftMode = encodeExtrapolationMode(value.__zynth_skia_interp_left);
    const rightMode = encodeExtrapolationMode(value.__zynth_skia_interp_right);
    return interpolateSnapshot(
      normalizePackedNumber(value.__zynth_shared_signal_current, fallback),
      inputRange.slice(0, count),
      outputRange.slice(0, count),
      leftMode,
      rightMode,
    );
  }
  if (isSharedSignalToken(value)) {
    return normalizePackedNumber(value.__zynth_shared_signal_current, fallback);
  }
  return normalizePackedNumber(value, fallback);
}

function materializeCommandsForFallback(commands: SkiaDrawCommand[]): SkiaDrawCommand[] {
  return commands.map((command) => {
    switch (command.type) {
      case "clear":
        return command;
      case "rect":
        return {
          ...command,
          x: materializeScalar(command.x),
          y: materializeScalar(command.y),
          width: materializeScalar(command.width),
          height: materializeScalar(command.height),
          strokeWidth: command.strokeWidth == null ? undefined : materializeScalar(command.strokeWidth, 1),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          strokeMiter: command.strokeMiter == null ? undefined : materializeScalar(command.strokeMiter, 4),
        };
      case "circle":
        return {
          ...command,
          cx: materializeScalar(command.cx),
          cy: materializeScalar(command.cy),
          r: materializeScalar(command.r),
          strokeWidth: command.strokeWidth == null ? undefined : materializeScalar(command.strokeWidth, 1),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          strokeMiter: command.strokeMiter == null ? undefined : materializeScalar(command.strokeMiter, 4),
        };
      case "line":
        return {
          ...command,
          x1: materializeScalar(command.x1),
          y1: materializeScalar(command.y1),
          x2: materializeScalar(command.x2),
          y2: materializeScalar(command.y2),
          strokeWidth: command.strokeWidth == null ? undefined : materializeScalar(command.strokeWidth, 1),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          strokeMiter: command.strokeMiter == null ? undefined : materializeScalar(command.strokeMiter, 4),
        };
      case "path":
        return {
          ...command,
          strokeWidth: command.strokeWidth == null ? undefined : materializeScalar(command.strokeWidth, 1),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          strokeMiter: command.strokeMiter == null ? undefined : materializeScalar(command.strokeMiter, 4),
          commands: command.commands.map((pathCommand) => {
            if (pathCommand.type === "moveTo" || pathCommand.type === "lineTo") {
              return {
                ...pathCommand,
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            if (pathCommand.type === "quadTo") {
              return {
                ...pathCommand,
                cpx: materializeScalar(pathCommand.cpx),
                cpy: materializeScalar(pathCommand.cpy),
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            if (pathCommand.type === "cubicTo") {
              return {
                ...pathCommand,
                cp1x: materializeScalar(pathCommand.cp1x),
                cp1y: materializeScalar(pathCommand.cp1y),
                cp2x: materializeScalar(pathCommand.cp2x),
                cp2y: materializeScalar(pathCommand.cp2y),
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            return pathCommand;
          }),
        };
      case "text":
        return {
          ...command,
          x: materializeScalar(command.x),
          y: materializeScalar(command.y),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
        };
      case "runtimeShaderRect":
        return {
          ...command,
          x: materializeScalar(command.x),
          y: materializeScalar(command.y),
          width: materializeScalar(command.width),
          height: materializeScalar(command.height),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          uniforms: Object.fromEntries(
            Object.entries(command.uniforms).map(([name, uniform]) => {
              if (Array.isArray(uniform)) {
                return [name, uniform.map((item) => materializeScalar(item))];
              }
              return [name, materializeScalar(uniform)];
            }),
          ),
        };
      case "runtimeShaderCircle":
        return {
          ...command,
          cx: materializeScalar(command.cx),
          cy: materializeScalar(command.cy),
          r: materializeScalar(command.r),
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          uniforms: Object.fromEntries(
            Object.entries(command.uniforms).map(([name, uniform]) => {
              if (Array.isArray(uniform)) {
                return [name, uniform.map((item) => materializeScalar(item))];
              }
              return [name, materializeScalar(uniform)];
            }),
          ),
        };
      case "runtimeShaderPath":
        return {
          ...command,
          opacity: command.opacity == null ? undefined : materializeScalar(command.opacity, 1),
          uniforms: Object.fromEntries(
            Object.entries(command.uniforms).map(([name, uniform]) => {
              if (Array.isArray(uniform)) {
                return [name, uniform.map((item) => materializeScalar(item))];
              }
              return [name, materializeScalar(uniform)];
            }),
          ),
          commands: command.commands.map((pathCommand) => {
            if (pathCommand.type === "moveTo" || pathCommand.type === "lineTo") {
              return {
                ...pathCommand,
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            if (pathCommand.type === "quadTo") {
              return {
                ...pathCommand,
                cpx: materializeScalar(pathCommand.cpx),
                cpy: materializeScalar(pathCommand.cpy),
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            if (pathCommand.type === "cubicTo") {
              return {
                ...pathCommand,
                cp1x: materializeScalar(pathCommand.cp1x),
                cp1y: materializeScalar(pathCommand.cp1y),
                cp2x: materializeScalar(pathCommand.cp2x),
                cp2y: materializeScalar(pathCommand.cp2y),
                x: materializeScalar(pathCommand.x),
                y: materializeScalar(pathCommand.y),
              };
            }
            return pathCommand;
          }),
        };
    }
  });
}

function encodePackedCommands(commands: SkiaDrawCommand[]): PackedCommands {
  const encoded: number[] = [PACKED_STREAM_MAGIC, PACKED_STREAM_VERSION];
  const stringTable: string[] = [];
  const stringIndex = new Map<string, number>();
  const caps = getSkiaCapabilities();

  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
    if (
      command.type !== "clear"
      && command.type !== "text"
      && command.type !== "runtimeShaderRect"
      && command.type !== "runtimeShaderCircle"
      && command.type !== "runtimeShaderPath"
    ) {
      if (command.opacity != null && !caps.paintOpacity) {
        throw new Error("Skia feature unsupported: paint.opacity");
      }
      if (command.strokeCap != null && !caps.paintStrokeCap) {
        throw new Error("Skia feature unsupported: paint.strokeCap");
      }
      if (command.strokeJoin != null && !caps.paintStrokeJoin) {
        throw new Error("Skia feature unsupported: paint.strokeJoin");
      }
      if (command.strokeMiter != null && !caps.paintStrokeMiter) {
        throw new Error("Skia feature unsupported: paint.strokeMiter");
      }
    }
    switch (command.type) {
      case "clear":
        encoded.push(PackedOpcode.Clear);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        break;
      case "rect":
        encoded.push(PackedOpcode.Rect);
        pushPackedScalar(encoded, command.x);
        pushPackedScalar(encoded, command.y);
        pushPackedScalar(encoded, command.width);
        pushPackedScalar(encoded, command.height);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        pushPackedScalar(encoded, command.strokeWidth ?? 1, 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        pushPackedScalar(encoded, command.strokeMiter ?? 4, 4);
        break;
      case "circle":
        encoded.push(PackedOpcode.Circle);
        pushPackedScalar(encoded, command.cx);
        pushPackedScalar(encoded, command.cy);
        pushPackedScalar(encoded, command.r);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        pushPackedScalar(encoded, command.strokeWidth ?? 1, 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        pushPackedScalar(encoded, command.strokeMiter ?? 4, 4);
        break;
      case "line":
        encoded.push(PackedOpcode.Line);
        pushPackedScalar(encoded, command.x1);
        pushPackedScalar(encoded, command.y1);
        pushPackedScalar(encoded, command.x2);
        pushPackedScalar(encoded, command.y2);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        pushPackedScalar(encoded, command.strokeWidth ?? 1, 1);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        pushPackedScalar(encoded, command.strokeMiter ?? 4, 4);
        break;
      case "path":
        if (!caps.paths) {
          throw new Error(
            "Skia feature unsupported: paths (native runtime does not advertise path support)",
          );
        }
        encoded.push(PackedOpcode.Path);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        pushPackedScalar(encoded, command.strokeWidth ?? 1, 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        pushPackedScalar(encoded, command.strokeMiter ?? 4, 4);
        encoded.push(command.commands.length);
        for (let cmdIndex = 0; cmdIndex < command.commands.length; cmdIndex += 1) {
          const pathCommand = command.commands[cmdIndex]!;
          switch (pathCommand.type) {
            case "moveTo":
              encoded.push(PackedPathVerb.MoveTo);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "lineTo":
              encoded.push(PackedPathVerb.LineTo);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "quadTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (quadTo requires curve support)",
                );
              }
              encoded.push(PackedPathVerb.QuadTo);
              pushPackedScalar(encoded, pathCommand.cpx);
              pushPackedScalar(encoded, pathCommand.cpy);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "cubicTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (cubicTo requires curve support)",
                );
              }
              encoded.push(PackedPathVerb.CubicTo);
              pushPackedScalar(encoded, pathCommand.cp1x);
              pushPackedScalar(encoded, pathCommand.cp1y);
              pushPackedScalar(encoded, pathCommand.cp2x);
              pushPackedScalar(encoded, pathCommand.cp2y);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "close":
              encoded.push(PackedPathVerb.Close);
              break;
          }
        }
        break;
      case "runtimeShaderRect": {
        encoded.push(PackedOpcode.RuntimeShaderRect);
        pushPackedScalar(encoded, command.x);
        pushPackedScalar(encoded, command.y);
        pushPackedScalar(encoded, command.width);
        pushPackedScalar(encoded, command.height);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        const sourceIndex = addPackedString(stringTable, stringIndex, command.source);
        encoded.push(sourceIndex);
        const uniformNames = Object.keys(command.uniforms);
        encoded.push(uniformNames.length);
        for (let uniformIndex = 0; uniformIndex < uniformNames.length; uniformIndex += 1) {
          const name = uniformNames[uniformIndex]!;
          const uniformNameIndex = addPackedString(stringTable, stringIndex, name);
          const uniformValue = command.uniforms[name]!;
          encoded.push(uniformNameIndex);
          if (Array.isArray(uniformValue)) {
            encoded.push(uniformValue.length);
            for (let valueIndex = 0; valueIndex < uniformValue.length; valueIndex += 1) {
              pushPackedScalar(encoded, uniformValue[valueIndex] ?? 0);
            }
          } else {
            encoded.push(1);
            pushPackedScalar(encoded, uniformValue);
          }
        }
        break;
      }
      case "runtimeShaderCircle": {
        encoded.push(PackedOpcode.RuntimeShaderCircle);
        pushPackedScalar(encoded, command.cx);
        pushPackedScalar(encoded, command.cy);
        pushPackedScalar(encoded, command.r);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        const sourceIndex = addPackedString(stringTable, stringIndex, command.source);
        encoded.push(sourceIndex);
        const uniformNames = Object.keys(command.uniforms);
        encoded.push(uniformNames.length);
        for (let uniformIndex = 0; uniformIndex < uniformNames.length; uniformIndex += 1) {
          const name = uniformNames[uniformIndex]!;
          const uniformNameIndex = addPackedString(stringTable, stringIndex, name);
          const uniformValue = command.uniforms[name]!;
          encoded.push(uniformNameIndex);
          if (Array.isArray(uniformValue)) {
            encoded.push(uniformValue.length);
            for (let valueIndex = 0; valueIndex < uniformValue.length; valueIndex += 1) {
              pushPackedScalar(encoded, uniformValue[valueIndex] ?? 0);
            }
          } else {
            encoded.push(1);
            pushPackedScalar(encoded, uniformValue);
          }
        }
        break;
      }
      case "runtimeShaderPath": {
        if (!caps.paths) {
          throw new Error(
            "Skia feature unsupported: paths (native runtime does not advertise path support)",
          );
        }
        encoded.push(
          PackedOpcode.RuntimeShaderPath,
          command.antiAlias === false ? 0 : 1,
        );
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        const sourceIndex = addPackedString(stringTable, stringIndex, command.source);
        encoded.push(sourceIndex);
        const uniformNames = Object.keys(command.uniforms);
        encoded.push(uniformNames.length);
        for (let uniformIndex = 0; uniformIndex < uniformNames.length; uniformIndex += 1) {
          const name = uniformNames[uniformIndex]!;
          const uniformNameIndex = addPackedString(stringTable, stringIndex, name);
          const uniformValue = command.uniforms[name]!;
          encoded.push(uniformNameIndex);
          if (Array.isArray(uniformValue)) {
            encoded.push(uniformValue.length);
            for (let valueIndex = 0; valueIndex < uniformValue.length; valueIndex += 1) {
              pushPackedScalar(encoded, uniformValue[valueIndex] ?? 0);
            }
          } else {
            encoded.push(1);
            pushPackedScalar(encoded, uniformValue);
          }
        }
        encoded.push(command.commands.length);
        for (let cmdIndex = 0; cmdIndex < command.commands.length; cmdIndex += 1) {
          const pathCommand = command.commands[cmdIndex]!;
          switch (pathCommand.type) {
            case "moveTo":
              encoded.push(PackedPathVerb.MoveTo);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "lineTo":
              encoded.push(PackedPathVerb.LineTo);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "quadTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (quadTo requires curve support)",
                );
              }
              encoded.push(PackedPathVerb.QuadTo);
              pushPackedScalar(encoded, pathCommand.cpx);
              pushPackedScalar(encoded, pathCommand.cpy);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "cubicTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (cubicTo requires curve support)",
                );
              }
              encoded.push(PackedPathVerb.CubicTo);
              pushPackedScalar(encoded, pathCommand.cp1x);
              pushPackedScalar(encoded, pathCommand.cp1y);
              pushPackedScalar(encoded, pathCommand.cp2x);
              pushPackedScalar(encoded, pathCommand.cp2y);
              pushPackedScalar(encoded, pathCommand.x);
              pushPackedScalar(encoded, pathCommand.y);
              break;
            case "close":
              encoded.push(PackedPathVerb.Close);
              break;
          }
        }
        break;
      }
      case "text": {
        encoded.push(PackedOpcode.Text);
        pushPackedScalar(encoded, command.x);
        pushPackedScalar(encoded, command.y);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        pushPackedScalar(encoded, command.fontSize, 14);
        encoded.push(command.antiAlias === false ? 0 : 1);
        pushPackedScalar(encoded, caps.paintOpacity ? (command.opacity ?? 1) : 1, 1);
        const familyIndex = addPackedString(stringTable, stringIndex, command.fontFamily);
        const styleIndex = addPackedString(stringTable, stringIndex, command.fontStyle ?? "normal");
        const weightIndex = addPackedString(
          stringTable,
          stringIndex,
          command.fontWeight == null ? "normal" : String(command.fontWeight),
        );
        const textIndex = addPackedString(stringTable, stringIndex, command.text);
        encoded.push(familyIndex, styleIndex, weightIndex, textIndex);
        if (command.matrix) {
          encoded.push(1);
          for (let matrixIndex = 0; matrixIndex < 6; matrixIndex += 1) {
            encoded.push(command.matrix[matrixIndex] ?? 0);
          }
        } else {
          encoded.push(0);
        }
        break;
      }
    }
  }

  return {
    ops: new Float64Array(encoded).buffer,
    opCount: encoded.length,
    stringTable,
  };
}

function encodeStrokeCap(value: SkiaStrokeCap | undefined): number {
  if (value === "round") return PackedStrokeCap.Round;
  if (value === "square") return PackedStrokeCap.Square;
  return PackedStrokeCap.Butt;
}

function encodeStrokeJoin(value: SkiaStrokeJoin | undefined): number {
  if (value === "round") return PackedStrokeJoin.Round;
  if (value === "bevel") return PackedStrokeJoin.Bevel;
  return PackedStrokeJoin.Miter;
}

function callSync(method: string, payload: unknown): unknown {
  const result = callNativeSync(MODULE_NAME, method, payload);
  return unwrapNativeResult(result);
}

function getBridge(): SkiaNativeBridge | null {
  return getNativeModule<SkiaNativeBridge>(BRIDGE_KEY);
}

function readBridgeCapabilities(): Partial<SkiaCapabilities> | null {
  const bridge = getBridge();
  if (!bridge || !bridge.capabilities || typeof bridge.capabilities !== "object") {
    return null;
  }
  return bridge.capabilities;
}

export function getSkiaCapabilities(): SkiaCapabilities {
  const bridgeCaps = readBridgeCapabilities();
  return {
    ...defaultCapabilities,
    ...(bridgeCaps ?? null),
  };
}

export function supportsSkiaFeature(feature: SkiaFeature): boolean {
  const caps = getSkiaCapabilities();
  return Boolean(caps[featureCapabilityMap[feature]]);
}

export function assertSkiaFeature(feature: SkiaFeature, context?: string): void {
  if (supportsSkiaFeature(feature)) return;
  const suffix = context ? ` (${context})` : "";
  throw new Error(`Skia feature unsupported: ${feature}${suffix}`);
}

export function createNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.createSurface) {
    const ok = bridge.createSurface(nodeId);
    if (ok) return;
  }
  callSync("createSurface", { nodeId } satisfies SkiaSurfacePayload);
}

export function disposeNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.disposeSurface) {
    const ok = bridge.disposeSurface(nodeId);
    if (ok) return;
  }
  callSync("disposeSurface", { nodeId } satisfies SkiaSurfacePayload);
}

export function submitNativeCommands(
  nodeId: number,
  commands: SkiaDrawCommand[],
): void {
  const bridge = getBridge();
  if (bridge?.submitDrawCommandsPacked) {
    const packed = encodePackedCommands(commands);
    const ok = bridge.submitDrawCommandsPacked(
      nodeId,
      packed.ops,
      packed.opCount,
      packed.stringTable,
    );
    if (ok) return;
  }
  const fallbackCommands = materializeCommandsForFallback(commands);
  if (bridge?.submitDrawCommands) {
    const ok = bridge.submitDrawCommands(nodeId, fallbackCommands);
    if (ok) return;
  }
  callSync("submitDrawCommands", {
    nodeId,
    commands: fallbackCommands,
  } satisfies SkiaSubmitPayload);
}

export function submitNativeFrame(nodeId: number, frame: SkiaFrameSpec): void {
  const bridge = getBridge();
  if (bridge?.submitFrame) {
    const ok = bridge.submitFrame(nodeId, frame);
    if (ok) return;
  }
  callSync("submitFrame", {
    nodeId,
    frame,
  } satisfies SkiaSubmitPayload);
}

export function invalidateNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.invalidateSurface) {
    const ok = bridge.invalidateSurface(nodeId);
    if (ok) return;
  }
  callSync("invalidateSurface", { nodeId } satisfies SkiaSurfacePayload);
}

export function setNativeFrameLoopEnabled(nodeId: number, enabled: boolean): void {
  const bridge = getBridge();
  if (bridge?.setFrameLoopEnabled) {
    const ok = bridge.setFrameLoopEnabled(nodeId, enabled);
    if (ok) return;
  }
  callSync("setFrameLoopEnabled", {
    nodeId,
    enabled,
  } satisfies SkiaFrameLoopPayload);
}
