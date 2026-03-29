import { emitDevtoolsEvent } from "./devtools";
import { getSignalRefId } from "./signalRef";

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
  fn: WorkletFunction<T>,
): WorkletFunction<T> {
  let metadata = fn.__zynth_worklet ?? {};
  let code = metadata.code || fn.toString();

  if (code && !/\[bytecode\]/i.test(code)) {
    // Basic cleaning for runtime-created worklets
    if (code.includes(": ") || code.includes("as ")) {
      code = code
        .replace(/:\s*(unknown|any|string|number|boolean|void)/g, "")
        .replace(/\s*as\s*(string|any|number|boolean)/g, "");
    }

    // Wrap in a safe IIFE to ensure it evaluates to the function value.
    // This handles all function syntaxes (arrow, shorthand, etc.) reliably.
    metadata.code = `(function() { return ${code.trim()}; })()`;
  }

  fn.__zynth_worklet = metadata;
  return fn;
}

export function createWorklet<T extends (...args: unknown[]) => unknown>(
  fn: T,
): WorkletFunction<T> {
  const func = fn as WorkletFunction<T>;
  
  // If it's already a registered worklet, return it
  if (func.__zynth_worklet_id !== undefined) {
    return func;
  }

  const worklet = ensureWorkletMetadata(func);
  const bridge = getWorkletsBridge();
  const metadata = worklet.__zynth_worklet;
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

  if (bridge && metadata?.code) {
    const id = bridge.register({
      code: metadata.code,
      location: metadata.location,
      closure: Object.keys(payloadClosure).length > 0 ? payloadClosure : undefined,
    });
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
