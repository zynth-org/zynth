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

function pushValueToBoundNodes(signalId: number, value: string): void {
  const nodeIds = syncSignalNodeBindings.get(signalId);
  if (!nodeIds || nodeIds.size === 0) return;

  const globalObj = getGlobalObject() as {
    __ui?: {
      setProp?: (id: number, name: string, value: unknown) => void;
    };
  };
  const setProp = globalObj.__ui?.setProp;
  if (typeof setProp !== "function") return;

  for (const nodeId of nodeIds) {
    try {
      setProp(nodeId, "value", value);
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
      setValue(() => cached);
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
    pushValueToBoundNodes(syncId, nextText);

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
