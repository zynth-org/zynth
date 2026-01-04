export type RuneDevtoolsEvent = {
  topic: string;
  ts?: number;
  level?: string;
  tag?: string;
  data?: unknown;
  runtime?: Record<string, unknown>;
};

export type RuneDevtoolsBridge = {
  emit(event: RuneDevtoolsEvent): void;
  isConnected?: () => boolean;
};

declare const __DEV__: boolean | undefined;

function shouldEnableDevtools(): boolean {
  if (typeof __DEV__ !== "undefined") {
    return Boolean(__DEV__);
  }
  const g = globalThis as any;
  const proc = g.process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV !== "production";
  }
  return true;
}

export function ensureDevtoolsBridge(): RuneDevtoolsBridge | null {
  if (!shouldEnableDevtools()) return null;
  const g = globalThis as any;
  const existing = g.__RUNE_DEVTOOLS__ as RuneDevtoolsBridge | undefined;
  if (existing?.emit) {
    return existing;
  }

  const bridge: RuneDevtoolsBridge = {
    emit(event) {
      if (!event || typeof event !== "object") return;
      if (typeof g.__modules?.call === "function") {
        g.__modules.call("Devtools", "emit", event);
      }
    },
    isConnected() {
      if (typeof g.__modules?.callSync === "function") {
        try {
          return Boolean(g.__modules.callSync("Devtools", "isConnected", null));
        } catch {
          return false;
        }
      }
      return false;
    },
  };

  Object.defineProperty(g, "__RUNE_DEVTOOLS__", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: bridge,
  });

  return bridge;
}

export function emitDevtoolsEvent(event: RuneDevtoolsEvent): void {
  ensureDevtoolsBridge()?.emit(event);
}
