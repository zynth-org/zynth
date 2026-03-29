import { createSignal, untrack, type Accessor, type Setter } from "solid-js";
import { createWorklet, type WorkletFunction } from "./worklet";

type SyncSignalBridge = {
  createSyncSignal?: (initialValue: string) => number;
  getSyncSignal?: (id: number) => string;
  setSyncSignal?: (id: number, value: string) => void;
  removeSyncSignal?: (id: number) => void;
};

export type SyncSignalAccessor<T extends string = string> = Accessor<T> & {
  __zynth_sync_signal_id?: number;
  __zynth_sync_signal_current?: T;
};

export type SyncSignalSetter<T extends string = string> = Setter<T> & {
  __zynth_sync_signal_id?: number;
};

const syncSignalNodeBindings = new Map<number, Set<number>>();
let fallbackNextId = 1;
const fallbackStore = new Map<number, string>();
let cachedBridge: SyncSignalBridge | null | undefined = undefined;

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function asSyncSignalBridge(value: unknown): SyncSignalBridge | null {
  if (!value || typeof value !== "object") return null;
  const bridge = value as SyncSignalBridge;
  if (
    typeof bridge.createSyncSignal === "function" ||
    typeof bridge.getSyncSignal === "function" ||
    typeof bridge.setSyncSignal === "function"
  ) {
    return bridge;
  }
  return null;
}

function getSyncSignalBridge(): SyncSignalBridge | null {
  if (cachedBridge !== undefined) {
    return cachedBridge;
  }
  const globalObj = getGlobalObject();
  cachedBridge = asSyncSignalBridge((globalObj as { __zynth_sync_signals?: unknown }).__zynth_sync_signals);
  return cachedBridge;
}

function createNativeSyncSignal(initialValue: string): number {
  const bridge = getSyncSignalBridge();
  if (bridge?.createSyncSignal) {
    try {
      return bridge.createSyncSignal(initialValue);
    } catch {
      // fall through to in-memory fallback
    }
  }
  const id = fallbackNextId++;
  fallbackStore.set(id, initialValue);
  return id;
}

function getNativeSyncSignal(id: number): string | null {
  const bridge = getSyncSignalBridge();
  if (bridge?.getSyncSignal) {
    try {
      const value = bridge.getSyncSignal(id);
      return typeof value === "string" ? value : String(value ?? "");
    } catch {
      // fall through
    }
  }
  return fallbackStore.get(id) ?? null;
}

function setNativeSyncSignal(id: number, value: string): void {
  const bridge = getSyncSignalBridge();
  if (bridge?.setSyncSignal) {
    try {
      bridge.setSyncSignal(id, value);
    } catch {
      // keep fallback store in sync
    }
  }
  fallbackStore.set(id, value);
}

function pushValueToBoundNodes(
  signalId: number,
  value: string,
  nativeText?: string,
  selectionStart?: number,
  selectionEnd?: number,
): void {
  const nodeIds = syncSignalNodeBindings.get(signalId);
  if (!nodeIds || nodeIds.size === 0) return;

  const globalObj = getGlobalObject() as {
    __ui?: {
      setProp?: (id: number, name: string, value: unknown) => void;
      syncInputState?: (
        id: number,
        newText: string,
        nativeText: string,
        selStart: number,
        selEnd: number,
      ) => void;
    };
  };
  
  const ui = globalObj.__ui;
  if (!ui) return;

  for (const nodeId of nodeIds) {
    try {
      if (typeof ui.syncInputState === "function") {
        ui.syncInputState(
          nodeId,
          value,
          nativeText ?? "",
          selectionStart ?? -1,
          selectionEnd ?? -1,
        );
      } else if (typeof ui.setProp === "function") {
        ui.setProp(nodeId, "value", value);
      }
    } catch {
      // keep other bindings alive even if one write fails
    }
  }
}

export function bindSyncSignalNode(signalId: number, nodeId: number): void {
  let nodes = syncSignalNodeBindings.get(signalId);
  if (!nodes) {
    nodes = new Set<number>();
    syncSignalNodeBindings.set(signalId, nodes);
  }
  nodes.add(nodeId);
}

export function unbindSyncSignalNode(signalId: number, nodeId: number): void {
  const nodes = syncSignalNodeBindings.get(signalId);
  if (!nodes) return;
  nodes.delete(nodeId);
  if (nodes.size === 0) {
    syncSignalNodeBindings.delete(signalId);
  }
}

type SyncSignalGlobalBindings = {
  __zynth_bindSyncSignalNode?: (signalId: number, nodeId: number) => void;
  __zynth_unbindSyncSignalNode?: (signalId: number, nodeId: number) => void;
};

const runtimeGlobalBindings = getGlobalObject() as SyncSignalGlobalBindings;
runtimeGlobalBindings.__zynth_bindSyncSignalNode = bindSyncSignalNode;
runtimeGlobalBindings.__zynth_unbindSyncSignalNode = unbindSyncSignalNode;

export function createSyncSignal<T extends string = string>(
  initialValue: T,
): [SyncSignalAccessor<T>, SyncSignalSetter<T>] {
  const normalizedInitial = String(initialValue) as T;
  const [value, setValue] = createSignal<T>(normalizedInitial);
  const syncId = createNativeSyncSignal(normalizedInitial);
  let cached = normalizedInitial;

  const accessor = (() => {
    const trackedValue = value();
    const nativeValue = getNativeSyncSignal(syncId);
    if (nativeValue !== null && nativeValue !== trackedValue) {
      cached = nativeValue as T;
      // Use a microtask to ensure the reactive update happens outside the getter
      // and avoids potential SolidJS re-entry issues during the render phase.
      Promise.resolve().then(() => {
        if (getNativeSyncSignal(syncId) === cached) {
          setValue(() => cached);
        }
      });
      return cached;
    }
    cached = trackedValue;
    return trackedValue;
  }) as SyncSignalAccessor<T>;

  accessor.__zynth_sync_signal_id = syncId;
  accessor.__zynth_sync_signal_current = cached;

  const setter = ((...args: [T | ((prev: T) => T)] | []) => {
    const next = args.length > 0 ? args[0] : (undefined as unknown as T);
    const resolved =
      typeof next === "function"
        ? (next as (prev: T) => T)(untrack(value))
        : next;

    const nextText = String(resolved ?? "") as T;
    setNativeSyncSignal(syncId, nextText);
    
    // We pass the new text as the "native" baseline for the diff check.
    // If the caller provided selection info (e.g. from a formatter worklet), we pass it along.
    const sel = (resolved as any)?.__zynth_selection;
    pushValueToBoundNodes(
      syncId, 
      nextText, 
      nextText, 
      sel?.start ?? -1, 
      sel?.end ?? -1
    );

    cached = nextText;
    accessor.__zynth_sync_signal_current = cached;
    setValue(() => cached);
    return cached;
  }) as SyncSignalSetter<T>;

  setter.__zynth_sync_signal_id = syncId;

  return [accessor, setter];
}

export function createInputHandler<T extends (...args: unknown[]) => unknown>(
  callback: T,
): WorkletFunction<T> {
  return createWorklet(callback);
}
