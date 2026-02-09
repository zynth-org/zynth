import { callNativeSync, getNativeModule, unwrapNativeResult } from "@zynth/core";
import type { SkiaDrawCommand, SkiaFrameSpec } from "./types";

const MODULE_NAME = "Skia";
const BRIDGE_KEY = "__zynth_skia";

type SkiaNativeBridge = {
  createSurface(nodeId: number): boolean;
  disposeSurface(nodeId: number): boolean;
  submitDrawCommands(nodeId: number, commands: SkiaDrawCommand[]): boolean;
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
