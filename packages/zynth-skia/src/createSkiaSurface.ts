import type { HostNode } from "@zynthjs/core";
import {
  createNativeSurface,
  disposeNativeSurface,
  invalidateNativeSurface,
  setNativeFrameLoopEnabled,
  submitNativeCommands,
  submitNativeFrame,
} from "./native";
import type { SkiaDrawCommand, SkiaFrameSpec, SkiaSurface } from "./types";

export type SkiaSurfaceController = {
  bind(node: HostNode | null): void;
  currentNodeId(): number | null;
} & SkiaSurface;

export function createSkiaSurface(): SkiaSurfaceController {
  let nodeId: number | null = null;

  const withNodeId = (fn: (id: number) => void) => {
    if (nodeId == null) return;
    fn(nodeId);
  };

  return {
    bind(node) {
      const nextId = node?.id ?? null;
      if (nodeId === nextId) return;
      if (nodeId != null) {
        disposeNativeSurface(nodeId);
      }
      nodeId = nextId;
      if (nodeId != null) {
        createNativeSurface(nodeId);
      }
    },
    currentNodeId() {
      return nodeId;
    },
    submit(commands: SkiaDrawCommand[]) {
      withNodeId((id) => submitNativeCommands(id, commands));
    },
    submitFrame(frame: SkiaFrameSpec) {
      withNodeId((id) => submitNativeFrame(id, frame));
    },
    invalidate() {
      withNodeId((id) => invalidateNativeSurface(id));
    },
    setFrameLoopEnabled(enabled: boolean) {
      withNodeId((id) => setNativeFrameLoopEnabled(id, enabled));
    },
    dispose() {
      if (nodeId == null) return;
      disposeNativeSurface(nodeId);
      nodeId = null;
    },
  };
}
