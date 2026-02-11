import { callNativeSync, getNativeModule, unwrapNativeResult } from "@zynth/core";
import {
  type SkiaCapabilities,
  type SkiaDrawCommand,
  type SkiaFeature,
  type SkiaFrameSpec,
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

function encodePackedCommands(commands: SkiaDrawCommand[]): PackedCommands {
  const encoded: number[] = [];
  const stringTable: string[] = [];
  const stringIndex = new Map<string, number>();
  const caps = getSkiaCapabilities();

  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
    if (command.type !== "clear") {
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
        encoded.push(
          PackedOpcode.Rect,
          command.x,
          command.y,
          command.width,
          command.height,
        );
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        encoded.push(command.strokeWidth ?? 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        encoded.push(caps.paintOpacity ? (command.opacity ?? 1) : 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        encoded.push(command.strokeMiter ?? 4);
        break;
      case "circle":
        encoded.push(PackedOpcode.Circle, command.cx, command.cy, command.r);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        encoded.push(command.strokeWidth ?? 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        encoded.push(caps.paintOpacity ? (command.opacity ?? 1) : 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        encoded.push(command.strokeMiter ?? 4);
        break;
      case "line":
        encoded.push(
          PackedOpcode.Line,
          command.x1,
          command.y1,
          command.x2,
          command.y2,
        );
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        encoded.push(command.strokeWidth ?? 1);
        encoded.push(command.antiAlias === false ? 0 : 1);
        encoded.push(caps.paintOpacity ? (command.opacity ?? 1) : 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        encoded.push(command.strokeMiter ?? 4);
        break;
      case "path":
        if (!caps.paths) {
          throw new Error(
            "Skia feature unsupported: paths (native runtime does not advertise path support)",
          );
        }
        encoded.push(PackedOpcode.Path);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        encoded.push(command.strokeWidth ?? 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
        encoded.push(command.antiAlias === false ? 0 : 1);
        encoded.push(caps.paintOpacity ? (command.opacity ?? 1) : 1);
        encoded.push(encodeStrokeCap(command.strokeCap));
        encoded.push(encodeStrokeJoin(command.strokeJoin));
        encoded.push(command.strokeMiter ?? 4);
        encoded.push(command.commands.length);
        for (let cmdIndex = 0; cmdIndex < command.commands.length; cmdIndex += 1) {
          const pathCommand = command.commands[cmdIndex]!;
          switch (pathCommand.type) {
            case "moveTo":
              encoded.push(PackedPathVerb.MoveTo, pathCommand.x, pathCommand.y);
              break;
            case "lineTo":
              encoded.push(PackedPathVerb.LineTo, pathCommand.x, pathCommand.y);
              break;
            case "quadTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (quadTo requires curve support)",
                );
              }
              encoded.push(
                PackedPathVerb.QuadTo,
                pathCommand.cpx,
                pathCommand.cpy,
                pathCommand.x,
                pathCommand.y,
              );
              break;
            case "cubicTo":
              if (!caps.pathCurves) {
                throw new Error(
                  "Skia feature unsupported: path.curves (cubicTo requires curve support)",
                );
              }
              encoded.push(
                PackedPathVerb.CubicTo,
                pathCommand.cp1x,
                pathCommand.cp1y,
                pathCommand.cp2x,
                pathCommand.cp2y,
                pathCommand.x,
                pathCommand.y,
              );
              break;
            case "close":
              encoded.push(PackedPathVerb.Close);
              break;
          }
        }
        break;
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
  if (bridge?.submitDrawCommands) {
    const ok = bridge.submitDrawCommands(nodeId, commands);
    if (ok) return;
  }
  callSync("submitDrawCommands", {
    nodeId,
    commands,
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
