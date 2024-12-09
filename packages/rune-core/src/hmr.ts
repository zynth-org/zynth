export type RuneHMRPayload = {
  type: string;
  [key: string]: any;
};

export type RuneHMRListener = (payload: RuneHMRPayload) => void;

const listeners = new Set<RuneHMRListener>();
let installed = false;

function parsePayload(payload: unknown): RuneHMRPayload | null {
  if (payload == null) {
    return null;
  }
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return typeof parsed === "object" && parsed !== null ? (parsed as RuneHMRPayload) : null;
    } catch (error) {
      console.error("[Rune HMR] Failed to parse payload", error);
      return null;
    }
  }
  if (typeof payload === "object") {
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
  const previous = typeof g.__rune_refresh === "function" ? g.__rune_refresh : undefined;

  g.__rune_refresh = (value: unknown) => {
    const payload = parsePayload(value);
    if (!payload) {
      return;
    }
    if (previous && previous !== g.__rune_refresh) {
      try {
        previous(payload);
      } catch (error) {
        console.error("[Rune HMR] Previous refresh handler failed", error);
      }
    }
    dispatch(payload);
  };
}

export function onNativeHMR(listener: RuneHMRListener): () => void {
  ensureNativeHMRHooks();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFallbackFullReload(handler: (payload: RuneHMRPayload) => void) {
  const g = globalThis as any;
  g.__rune_requestFullReload = handler;
}

// Install hooks eagerly for modules that import this helper.
ensureNativeHMRHooks();
