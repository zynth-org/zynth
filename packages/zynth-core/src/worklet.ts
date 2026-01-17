import { emitDevtoolsEvent } from "./devtools";

type WorkletMetadata = {
  code?: string;
  location?: string;
};

export type WorkletFunction<T extends (...args: unknown[]) => unknown> = T & {
  __zynth_worklet?: WorkletMetadata;
  __zynth_worklet_id?: number;
  __zynth_worklet_closure?: Record<string, unknown>;
};

type WorkletPayload = {
  code: string;
  location?: string;
  closure?: Record<string, unknown>;
};

type WorkletsBridge = {
  register: (payload: WorkletPayload) => number;
  run?: (id: number) => void;
};

let cachedBridge: WorkletsBridge | null | undefined = undefined;

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
  const metadata = fn.__zynth_worklet ?? {};
  if (!metadata.code) {
    const code = fn.toString();
    if (!/\[bytecode\]/i.test(code)) {
      metadata.code = code;
    }
  }
  fn.__zynth_worklet = metadata;
  return fn;
}

export function createWorklet<T extends (...args: unknown[]) => unknown>(
  fn: T
): WorkletFunction<T> {
  const worklet = ensureWorkletMetadata(fn as WorkletFunction<T>);
  const bridge = getWorkletsBridge();
  const metadata = worklet.__zynth_worklet;
  const closure = worklet.__zynth_worklet_closure;
  const payloadClosure: Record<string, unknown> = {};

  if (closure && typeof closure === "object") {
    for (const [key, value] of Object.entries(closure)) {
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

  if (bridge && metadata?.code) {
    const id = bridge.register({
      code: metadata.code,
      location: metadata.location,
      closure: Object.keys(payloadClosure).length > 0 ? payloadClosure : undefined,
    });
    worklet.__zynth_worklet_id = id;
    if (bridge.run) {
      bridge.run(id);
      return worklet;
    }
  }
  if (!bridge) {
    emitDevtoolsEvent({
      topic: "worklet/js",
      level: "debug",
      tag: "worklet",
      data: { reason: "missing-bridge" },
    });
  } else if (!metadata?.code) {
    emitDevtoolsEvent({
      topic: "worklet/js",
      level: "debug",
      tag: "worklet",
      data: { reason: "missing-code", location: metadata?.location },
    });
  }

  if (worklet.length === 0) {
    worklet();
  }
  return worklet;
}

export type { WorkletMetadata, WorkletPayload };
