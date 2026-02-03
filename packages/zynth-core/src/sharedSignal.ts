import { createSignal, untrack, type Accessor, type Setter } from "solid-js";
import { emitDevtoolsEvent } from "./devtools";

const SHARED_SIGNAL_MARKER = "__zynth_shared_value";

type SharedSignalToken = {
  [SHARED_SIGNAL_MARKER]: number;
  __zynth_shared_signal_current: number;
  valueOf: () => number;
  toString: () => string;
};

type SharedSignalCaptureContext = {
  tokens: Map<number, SharedSignalToken>;
};

type SharedSignalBridge = {
  createSharedSignal?: (initialValue: number) => number;
  getSharedSignal?: (id: number) => number;
  setSharedSignal?: (id: number, value: number) => void;
  removeSharedSignal?: (id: number) => void;
  createSharedValue?: (initialValue: number) => number;
  getSharedValue?: (id: number) => number;
  setSharedValue?: (id: number, value: number) => void;
  cancelSharedValue?: (id: number) => void;
};

export type SharedSignalAccessor<T> = Accessor<T> & {
  __zynth_shared_signal_id?: number;
  __zynth_shared_signal_current?: T;
};

let captureContext: SharedSignalCaptureContext | null = null;
let cachedBridge: SharedSignalBridge | null | undefined = undefined;

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

function shouldDebugSharedSignals(): boolean {
  const g = getGlobalObject() as {
    __ZYNTH_SHARED_SIGNAL_DEBUG__?: boolean;
    process?: { env?: Record<string, string | undefined> };
  };
  if (g.__ZYNTH_SHARED_SIGNAL_DEBUG__ === true) return true;
  const env = g.process?.env;
  if (!env) return false;
  const flag = env.ZYNTH_SHARED_SIGNAL_DEBUG;
  return flag === "1" || flag === "true";
}

function debugLog(message: string, data?: Record<string, unknown>): void {
  if (!shouldDebugSharedSignals()) return;
  if (data) {
    console.log(`[ZynthSharedSignal] ${message}`, data);
    emitDevtoolsEvent({
      topic: "shared-signal",
      level: "debug",
      tag: "shared-signal",
      data: { message, ...data },
    });
    return;
  }
  console.log(`[ZynthSharedSignal] ${message}`);
  emitDevtoolsEvent({
    topic: "shared-signal",
    level: "debug",
    tag: "shared-signal",
    data: { message },
  });
}

function asSharedSignalBridge(value: unknown): SharedSignalBridge | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as SharedSignalBridge;
  if (
    typeof obj.createSharedSignal === "function" ||
    typeof obj.createSharedValue === "function"
  ) {
    return obj;
  }
  return null;
}

function getSharedSignalBridge(): SharedSignalBridge | null {
  if (cachedBridge !== undefined) {
    return cachedBridge;
  }
  const globalObj = getGlobalObject();
  const direct = asSharedSignalBridge(globalObj.__zynth_shared_signals);
  if (direct) {
    cachedBridge = direct;
    return direct;
  }
  const animate = asSharedSignalBridge(globalObj.__zynth_animate);
  cachedBridge = animate;
  return animate;
}

function createNativeSharedSignal(initialValue: number): number | null {
  const bridge = getSharedSignalBridge();
  if (!bridge) return null;
  try {
    if (bridge.createSharedSignal) {
      return bridge.createSharedSignal(initialValue);
    }
    if (bridge.createSharedValue) {
      return bridge.createSharedValue(initialValue);
    }
  } catch (error) {
    console.error("[ZynthCore] createSharedSignal failed:", error);
  }
  return null;
}

function getNativeSharedSignal(id: number): number | null {
  const bridge = getSharedSignalBridge();
  if (!bridge) return null;
  try {
    if (bridge.getSharedSignal) {
      return bridge.getSharedSignal(id);
    }
    if (bridge.getSharedValue) {
      return bridge.getSharedValue(id);
    }
  } catch (error) {
    console.error("[ZynthCore] getSharedSignal failed:", error);
  }
  return null;
}

function setNativeSharedSignal(id: number, value: number): boolean {
  const bridge = getSharedSignalBridge();
  if (!bridge) return false;
  try {
    if (bridge.setSharedSignal) {
      bridge.setSharedSignal(id, value);
      return true;
    }
    if (bridge.setSharedValue) {
      bridge.setSharedValue(id, value);
      return true;
    }
  } catch (error) {
    console.error("[ZynthCore] setSharedSignal failed:", error);
  }
  return false;
}

export function createSharedSignal<T>(
  initialValue: T,
): [SharedSignalAccessor<T>, Setter<T>] {
  const [value, setValue] = createSignal(initialValue);
  let cachedValue = initialValue;
  let nativeId: number | null = null;

  if (typeof initialValue === "number") {
    nativeId = createNativeSharedSignal(initialValue);
    if (nativeId === null) {
      debugLog("native bridge unavailable", { initialValue });
    } else {
      debugLog(
        "created native shared signal",
        JSON.stringify({ id: nativeId, initialValue }) as any,
      );
    }
  }

  const accessor: SharedSignalAccessor<T> = (() => {
    const trackedValue = value();
    if (
      nativeId !== null &&
      captureContext &&
      typeof cachedValue === "number"
    ) {
      const token: SharedSignalToken = {
        [SHARED_SIGNAL_MARKER]: nativeId,
        __zynth_shared_signal_current: cachedValue,
        valueOf: () => cachedValue as number,
        toString: () => String(cachedValue),
      };
      captureContext.tokens.set(nativeId, token);
      return token as T;
    }
    return trackedValue;
  }) as SharedSignalAccessor<T>;

  accessor.__zynth_shared_signal_id = nativeId ?? undefined;
  accessor.__zynth_shared_signal_current = cachedValue;

  const setter = ((...args: [T | ((prev: T) => T)] | []) => {
    const next = args.length > 0 ? args[0] : (undefined as T);
    const resolved =
      typeof next === "function"
        ? (next as (prev: T) => T)(untrack(value))
        : next;
    cachedValue = resolved as T;
    accessor.__zynth_shared_signal_current = cachedValue;
    setValue(() => resolved as T);
    if (nativeId !== null && typeof resolved === "number") {
      const applied = setNativeSharedSignal(nativeId, resolved);
      debugLog(
        "set shared signal",
        JSON.stringify({
          id: nativeId,
          value: resolved,
          applied,
        }) as any,
      );
    }
    return resolved as T;
  }) as Setter<T>;

  return [accessor, setter];
}

export function captureSharedSignals<T>(fn: () => T): {
  result: T;
  tokens: SharedSignalToken[];
} {
  captureContext = { tokens: new Map() };
  try {
    const result = fn();
    const tokens = Array.from(captureContext.tokens.values());
    return { result, tokens };
  } finally {
    captureContext = null;
  }
}

export function readSharedSignal<T>(signal: SharedSignalAccessor<T>): T {
  if (signal.__zynth_shared_signal_current !== undefined) {
    return signal.__zynth_shared_signal_current as T;
  }
  const previous = captureContext;
  captureContext = null;
  try {
    return signal() as T;
  } finally {
    captureContext = previous;
  }
}

export type { SharedSignalToken };
