import { getGlobalObject, getModulesBridge, getNativeModule } from "./bridge";

export type ZynthDevtoolsEvent = {
  topic: string;
  ts?: number;
  level?: string;
  tag?: string;
  data?: unknown;
  runtime?: Record<string, unknown>;
};

export type ZynthDevtoolsBridge = {
  emit(event: ZynthDevtoolsEvent): void;
  isConnected?: () => boolean;
};

export type ZynthDevtoolsListener = (event: ZynthDevtoolsEvent) => void;

declare const __DEV__: boolean | undefined;

const devtoolsListeners = new Set<ZynthDevtoolsListener>();

function notifyDevtoolsListeners(event: ZynthDevtoolsEvent): void {
  if (!event || typeof event !== "object") return;
  if (devtoolsListeners.size === 0) return;
  const snapshot = Array.from(devtoolsListeners);
  for (const listener of snapshot) {
    try {
      listener(event);
    } catch {
      // Listener failures must never break runtime behavior.
    }
  }
}

export function addDevtoolsListener(listener: ZynthDevtoolsListener): () => void {
  if (typeof listener !== "function") {
    return () => {};
  }
  devtoolsListeners.add(listener);
  return () => {
    devtoolsListeners.delete(listener);
  };
}

function parseDevtoolsEvent(raw: unknown): ZynthDevtoolsEvent | null {
  if (!raw) return null;
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const event = candidate as ZynthDevtoolsEvent;
  if (typeof event.topic !== "string" || event.topic.length === 0) {
    return null;
  }
  return event;
}

function installDevtoolsReceiver(): void {
  const g = getGlobalObject() as any;
  if (g.__ZYNTH_DEVTOOLS_RECEIVER_INSTALLED__) return;
  g.__ZYNTH_DEVTOOLS_RECEIVER_INSTALLED__ = true;

  const handler = (raw: unknown) => {
    try {
      const event = parseDevtoolsEvent(raw);
      if (!event) return;
      notifyDevtoolsListeners(event);
    } catch {
      // Never allow devtools receiver failures to crash the runtime.
    }
  };

  Object.defineProperty(g, "__zynth_onDevtoolsEventRaw", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: handler,
  });
}

function shouldEnableDevtools(): boolean {
  if (typeof __DEV__ !== "undefined") {
    return Boolean(__DEV__);
  }
  const g = getGlobalObject() as any;
  const proc = g?.process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV !== "production";
  }
  return true;
}

export function ensureDevtoolsBridge(): ZynthDevtoolsBridge | null {
  if (!shouldEnableDevtools()) return null;
  const g = getGlobalObject() as any;
  installDevtoolsReceiver();
  const existing = g.__ZYNTH_DEVTOOLS__ as ZynthDevtoolsBridge | undefined;
  if (existing?.emit) {
    return existing;
  }
  const nativeEmitCandidate = getNativeModule<unknown>("__zynth_devtools_emit");
  const nativeEmit =
    typeof nativeEmitCandidate === "function"
      ? (nativeEmitCandidate as (event: ZynthDevtoolsEvent) => void)
      : null;
  const nativeIsConnectedCandidate = getNativeModule<unknown>(
    "__zynth_devtools_isConnected"
  );
  const nativeIsConnected =
    typeof nativeIsConnectedCandidate === "function"
      ? (nativeIsConnectedCandidate as () => boolean)
      : null;

  const bridge: ZynthDevtoolsBridge = {
    emit(event) {
      if (!event || typeof event !== "object") return;
      notifyDevtoolsListeners(event);
      const modulesBridge = getModulesBridge();
      if (modulesBridge?.call) {
        try {
          modulesBridge.call("Devtools", "emit", event);
          return;
        } catch {
          // Devtools transport failures should not break runtime behavior.
        }
      }
      if (nativeEmit) {
        try {
          nativeEmit(event);
        } catch {
          // Devtools transport failures should not break runtime behavior.
        }
      }
    },
    isConnected() {
      const modulesBridge = getModulesBridge();
      if (modulesBridge?.callSync) {
        try {
          return Boolean(modulesBridge.callSync("Devtools", "isConnected", null));
        } catch {
          return false;
        }
      }
      if (nativeIsConnected) {
        try {
          return Boolean(nativeIsConnected());
        } catch {
          return false;
        }
      }
      return false;
    },
  };

  Object.defineProperty(g, "__ZYNTH_DEVTOOLS__", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: bridge,
  });

  return bridge;
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (typeof arg === "number" || typeof arg === "boolean") {
        return String(arg);
      }
      if (arg == null) return String(arg);
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

export function installDevtoolsConsole(): void {
  const bridge = ensureDevtoolsBridge();
  if (!bridge) return;
  const g = getGlobalObject() as any;
  if (g.__ZYNTH_DEVTOOLS_CONSOLE_INSTALLED__) return;
  g.__ZYNTH_DEVTOOLS_CONSOLE_INSTALLED__ = true;

  const consoleObj = (g.console ||= {});
  const nativeConsoleOwnsDevtools = Boolean(g.__ZYNTH_NATIVE_CONSOLE_DEVTOOLS__);
  const levels = ["log", "info", "warn", "error", "debug"] as const;

  for (const level of levels) {
    const original = consoleObj[level];
    consoleObj[level] = (...args: unknown[]) => {
      if (!nativeConsoleOwnsDevtools) {
        try {
          bridge.emit({
            topic: "log/console",
            level,
            tag: "console",
            data: formatConsoleArgs(args),
          });
        } catch {
          // Ignore console bridge failures.
        }
      }
      if (typeof original === "function") {
        try {
          original(...args);
        } catch {
          // Ignore console passthrough failures.
        }
      }
    };
  }
}

export function emitDevtoolsEvent(event: ZynthDevtoolsEvent): void {
  try {
    ensureDevtoolsBridge()?.emit(event);
  } catch {
    // Ignore devtools failures.
  }
}


export function installDevtoolsErrorHandlers(): void {
  const bridge = ensureDevtoolsBridge();
  if (!bridge) return;
  const g = getGlobalObject() as any;
  if (g.__ZYNTH_DEVTOOLS_ERRORS_INSTALLED__) return;
  g.__ZYNTH_DEVTOOLS_ERRORS_INSTALLED__ = true;

  const report = (error: unknown, source?: string) => {
    const err = error as any;
    const message = String(err?.message || err || "Unknown error");
    const stack = err?.stack ? String(err.stack) : undefined;
    bridge.emit({
      topic: "error/js",
      level: "error",
      tag: "js",
      data: stack ? { message, stack, source } : { message, source },
    });
  };

  if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === "function") {
    const previous =
      typeof g.ErrorUtils.getGlobalHandler === "function"
        ? g.ErrorUtils.getGlobalHandler()
        : null;
    g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      report(error, isFatal ? "fatal" : "nonfatal");
      if (typeof previous === "function") {
        try {
          previous(error, isFatal);
        } catch {
          // Ignore error handler failures.
        }
      }
    });
  }

  if (typeof g.addEventListener === "function") {
    g.addEventListener("error", (event: any) => {
      report(event?.error || event?.message || event, "window.error");
    });
    g.addEventListener("unhandledrejection", (event: any) => {
      report(event?.reason || event, "unhandledrejection");
    });
    return;
  }

  if ("onerror" in g) {
    const previousOnError = g.onerror;
    g.onerror = (...args: any[]) => {
      report(args[0], "onerror");
      if (typeof previousOnError === "function") {
        return previousOnError(...args);
      }
      return false;
    };
  }

  if ("onunhandledrejection" in g) {
    const previousOnRejection = g.onunhandledrejection;
    g.onunhandledrejection = (event: any) => {
      report(event?.reason || event, "onunhandledrejection");
      if (typeof previousOnRejection === "function") {
        return previousOnRejection(event);
      }
      return undefined;
    };
  }
}
