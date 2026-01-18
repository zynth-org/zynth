import { emitDevtoolsEvent } from "./devtools";
import { getSignalRefId } from "./signalRef";
import type { WorkletFunction } from "./worklet";

export type SignalRuntimeKind = "ui" | "js";

export type SignalRuntime = {
  kind: SignalRuntimeKind;
};

type WorkletPayload = {
  code: string;
  location?: string;
  closure?: Record<string, unknown>;
};

type WorkletsBridge = {
  register: (payload: WorkletPayload) => number;
  run?: (id: number) => void;
  runAfter?: (id: number, delayMs: number) => void;
};

type WorkletMetadata = {
  code?: string;
  location?: string;
};

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

function asWorkletsBridge(value: unknown): WorkletsBridge | null {
  if (!value || typeof value !== "object") return null;
  const bridge = value as WorkletsBridge;
  if (typeof bridge.register === "function") {
    return bridge;
  }
  return null;
}

let cachedBridge: WorkletsBridge | null | undefined = undefined;

function getWorkletsBridge(): WorkletsBridge | null {
  if (cachedBridge !== undefined) {
    return cachedBridge;
  }
  const globalObj = getGlobalObject();
  cachedBridge = asWorkletsBridge(globalObj.__zynth_worklets);
  return cachedBridge;
}

function ensureWorkletMetadata<T extends (...args: unknown[]) => unknown>(
  fn: WorkletFunction<T>
): WorkletFunction<T> {
  const metadata = (fn.__zynth_worklet ?? {}) as WorkletMetadata;
  if (!metadata.code) {
    const code = fn.toString();
    if (!/\[bytecode\]/i.test(code)) {
      metadata.code = code;
    }
  }
  fn.__zynth_worklet = metadata;
  return fn;
}

function buildWorkletPayload<T extends (...args: unknown[]) => unknown>(
  worklet: WorkletFunction<T>
): WorkletPayload | null {
  const metadata = (worklet.__zynth_worklet ?? {}) as WorkletMetadata;
  if (!metadata.code) return null;
  const closure = worklet.__zynth_worklet_closure;
  const payloadClosure: Record<string, unknown> = {};

  if (closure && typeof closure === "object") {
    for (const [key, value] of Object.entries(closure)) {
      const signalRefId = getSignalRefId(value);
      if (typeof signalRefId === "number") {
        payloadClosure[key] = signalRefId;
        continue;
      }
      if (value && typeof value === "function") {
        const sharedId = (value as { __zynth_shared_signal_id?: unknown })
          .__zynth_shared_signal_id;
        if (typeof sharedId === "number") {
          payloadClosure[key] = { __zynth_shared_value: sharedId };
        }
        continue;
      }
      if (
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "boolean"
      ) {
        payloadClosure[key] = value;
      }
    }
  }

  return {
    code: metadata.code,
    location: metadata.location,
    closure: Object.keys(payloadClosure).length > 0 ? payloadClosure : undefined,
  };
}

function registerWorklet<T extends (...args: unknown[]) => unknown>(
  fn: T
): WorkletFunction<T> {
  const worklet = ensureWorkletMetadata(fn as WorkletFunction<T>);
  if (typeof worklet.__zynth_worklet_id === "number") {
    return worklet;
  }
  const bridge = getWorkletsBridge();
  const payload = buildWorkletPayload(worklet);
  if (bridge && payload) {
    const id = bridge.register(payload);
    worklet.__zynth_worklet_id = id;
    return worklet;
  }
  if (!bridge) {
    emitDevtoolsEvent({
      topic: "worklet/js",
      level: "debug",
      tag: "worklet",
      data: { reason: "missing-bridge" },
    });
  } else if (!payload) {
    emitDevtoolsEvent({
      topic: "worklet/js",
      level: "debug",
      tag: "worklet",
      data: { reason: "missing-code" },
    });
  }
  return worklet;
}

function scheduleFallback<T extends (...args: unknown[]) => unknown>(
  worklet: WorkletFunction<T>,
  delayMs: number
): void {
  const run = () => {
    if (worklet.length === 0) {
      worklet();
    }
  };
  if (delayMs > 0 && typeof setTimeout === "function") {
    setTimeout(run, delayMs);
    return;
  }
  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
    return;
  }
  if (typeof Promise !== "undefined") {
    Promise.resolve().then(run).catch(() => undefined);
    return;
  }
  run();
}

export function createSignalRuntime(kind: SignalRuntimeKind): SignalRuntime {
  return { kind };
}

export function getRuntimeKind(runtime: SignalRuntime): SignalRuntimeKind {
  return runtime.kind;
}

export function isWorklet<T extends (...args: unknown[]) => unknown>(
  fn: unknown
): fn is WorkletFunction<T> {
  if (typeof fn !== "function") return false;
  return Boolean((fn as WorkletFunction<T>).__zynth_worklet);
}

export function scheduleOnUI<T extends (...args: unknown[]) => unknown>(
  fn: T
): WorkletFunction<T> {
  return scheduleOnUIAfter(fn, 0);
}

export function scheduleOnUIAfter<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): WorkletFunction<T> {
  const worklet = registerWorklet(fn);
  const bridge = getWorkletsBridge();
  const workletId = worklet.__zynth_worklet_id;
  if (bridge && typeof workletId === "number") {
    if (delayMs > 0 && typeof bridge.runAfter === "function") {
      bridge.runAfter(workletId, delayMs);
      return worklet;
    }
    if (delayMs > 0 && typeof bridge.run === "function") {
      setTimeout(() => bridge.run?.(workletId), delayMs);
      return worklet;
    }
    bridge.run?.(workletId);
    return worklet;
  }

  scheduleFallback(worklet, delayMs);
  return worklet;
}
