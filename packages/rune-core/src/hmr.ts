// [HMR-DEBUG] logger for hmr.ts
const __HMR_LOG = (function () {
  function t() {
    try {
      return new Date().toISOString().split("T")[1];
    } catch {
      return "";
    }
  }
  function out(level: "log" | "warn" | "error", tag: string, ...args: any[]) {
    (console as any)[level](`[HMR-DEBUG ${t()} ${tag}]`, ...args);
  }
  return {
    log: (...a: any[]) => out("log", "HMR", ...a),
    warn: (...a: any[]) => out("warn", "HMR", ...a),
    error: (...a: any[]) => out("error", "HMR", ...a),
  };
})();
export type RuneHMRPayload = {
  type: string;
  [key: string]: any;
};

export type RuneHMRListener = (payload: RuneHMRPayload) => void;

const listeners = new Set<RuneHMRListener>();
let installed = false;
__HMR_LOG.log("hmr.ts loaded; console OK?", typeof console !== "undefined");

function parsePayload(payload: unknown): RuneHMRPayload | null {
  __HMR_LOG.log("parsePayload", typeof payload);
  if (payload == null) {
    __HMR_LOG.log("parsePayload: null or undefined payload");
    return null;
  }
  if (typeof payload === "string") {
    try {
      __HMR_LOG.log("parsePayload: string payload", payload);
      const parsed = JSON.parse(payload);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as RuneHMRPayload)
        : null;
    } catch (error) {
      __HMR_LOG.error("parsePayload: failed to parse string payload", error);
      console.error("[Rune HMR] Failed to parse payload", error);
      return null;
    }
  }
  if (typeof payload === "object") {
    __HMR_LOG.log("parsePayload: object payload");
    return payload as RuneHMRPayload;
  }
  return null;
}

function dispatch(payload: RuneHMRPayload) {
  if (listeners.size === 0) {
    console.warn(
      "[Rune HMR] Received payload but no listeners registered",
      payload.type
    );
    return;
  }
  for (const listener of Array.from(listeners)) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[Rune HMR] Listener threw", error);
    }
  }
}

export function ensureNativeHMRHooks() {
  if (installed) {
    return;
  }
  installed = true;
  const g = globalThis as any;
  const previous =
    typeof g.__rune_refresh === "function" ? g.__rune_refresh : undefined;
  const isDefaultStub = (() => {
    if (typeof previous !== "function") return false;
    const src = String(previous);
    return src.includes("Refresh invoked with no runtime listener");
  })();

  g.__rune_refresh = (value: unknown) => {
    const payload = parsePayload(value);
    __HMR_LOG.log("rune_refresh", payload);
    if (!payload) {
      __HMR_LOG.log("[Rune HMR] Ignoring invalid payload", value);
      return;
    }
    if (previous && previous !== g.__rune_refresh && !isDefaultStub) {
      __HMR_LOG.log("[Rune HMR] calling previous handler", previous);
      try {
        previous(payload);
      } catch (error) {
        __HMR_LOG.error("[Rune HMR] Previous refresh handler failed", error);
      }
    }
    dispatch(payload);
  };
}

export function onNativeHMR(listener: RuneHMRListener): () => void {
  __HMR_LOG.log("onNativeHMR: add listener");
  ensureNativeHMRHooks();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFallbackFullReload(
  handler: (payload: RuneHMRPayload) => void
) {
  const g = globalThis as any;
  g.__rune_requestFullReload = handler;
  __HMR_LOG.warn("setFallbackFullReload handler installed");
}

// Install hooks eagerly for modules that import this helper.
ensureNativeHMRHooks();

// [HMR-DEBUG] Patch __rune_emitDevMessage to trace
(function traceEmitter() {
  const g = globalThis as any;
  const prev = g.__rune_emitDevMessage;
  g.__rune_emitDevMessage = function (payload: any) {
    __HMR_LOG.log("emitDevMessage ->", payload?.type, payload);
    return prev ? prev(payload) : undefined;
  };
  __HMR_LOG.log("__rune_emitDevMessage tracer attached");
})();
