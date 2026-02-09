import { callNativeSync, getNativeModule, unwrapNativeResult } from "@zynth/core";
import type { SkiaDrawCommand, SkiaFrameSpec } from "./types";

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
}

const enum PackedColorType {
  Int = 1,
  String = 2,
}

const enum PackedStyle {
  Fill = 0,
  Stroke = 1,
}

type PackedCommands = {
  ops: ArrayBuffer;
  opCount: number;
  stringTable: string[];
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

  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]!;
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
        break;
      case "circle":
        encoded.push(PackedOpcode.Circle, command.cx, command.cy, command.r);
        pushPackedColor(encoded, command.color, stringTable, stringIndex);
        encoded.push(command.strokeWidth ?? 1);
        encoded.push(command.style === "stroke" ? PackedStyle.Stroke : PackedStyle.Fill);
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
        break;
    }
  }

  return {
    ops: new Float64Array(encoded).buffer,
    opCount: encoded.length,
    stringTable,
  };
}

function callSync(method: string, payload: unknown): unknown {
  const result = callNativeSync(MODULE_NAME, method, payload);
  return unwrapNativeResult(result);
}

function getBridge(): SkiaNativeBridge | null {
  return getNativeModule<SkiaNativeBridge>(BRIDGE_KEY);
}

export function createNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.createSurface) {
    bridge.createSurface(nodeId);
    return;
  }
  callSync("createSurface", { nodeId } satisfies SkiaSurfacePayload);
}

export function disposeNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.disposeSurface) {
    bridge.disposeSurface(nodeId);
    return;
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
    bridge.submitDrawCommandsPacked(
      nodeId,
      packed.ops,
      packed.opCount,
      packed.stringTable,
    );
    return;
  }
  if (bridge?.submitDrawCommands) {
    bridge.submitDrawCommands(nodeId, commands);
    return;
  }
  callSync("submitDrawCommands", {
    nodeId,
    commands,
  } satisfies SkiaSubmitPayload);
}

export function submitNativeFrame(nodeId: number, frame: SkiaFrameSpec): void {
  const bridge = getBridge();
  if (bridge?.submitFrame) {
    bridge.submitFrame(nodeId, frame);
    return;
  }
  callSync("submitFrame", {
    nodeId,
    frame,
  } satisfies SkiaSubmitPayload);
}

export function invalidateNativeSurface(nodeId: number): void {
  const bridge = getBridge();
  if (bridge?.invalidateSurface) {
    bridge.invalidateSurface(nodeId);
    return;
  }
  callSync("invalidateSurface", { nodeId } satisfies SkiaSurfacePayload);
}

export function setNativeFrameLoopEnabled(nodeId: number, enabled: boolean): void {
  const bridge = getBridge();
  if (bridge?.setFrameLoopEnabled) {
    bridge.setFrameLoopEnabled(nodeId, enabled);
    return;
  }
  callSync("setFrameLoopEnabled", {
    nodeId,
    enabled,
  } satisfies SkiaFrameLoopPayload);
}
