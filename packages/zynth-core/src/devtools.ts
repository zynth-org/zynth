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

export function ensureDevtoolsBridge(): ZynthDevtoolsBridge | null {
  if (!shouldEnableDevtools()) return null;
  const g = globalThis as any;
  const existing = g.__ZYNTH_DEVTOOLS__ as ZynthDevtoolsBridge | undefined;
  if (existing?.emit) {
    return existing;
  }

  const bridge: ZynthDevtoolsBridge = {
    emit(event) {
      if (!event || typeof event !== "object") return;
      if (typeof g.__modules?.call === "function") {
        try {
          g.__modules.call("Devtools", "emit", event);
        } catch {
          // Devtools transport failures should not break runtime behavior.
        }
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
  const g = globalThis as any;
  if (g.__ZYNTH_DEVTOOLS_CONSOLE_INSTALLED__) return;
  g.__ZYNTH_DEVTOOLS_CONSOLE_INSTALLED__ = true;

  const consoleObj = (g.console ||= {});
  const levels = ["log", "info", "warn", "error", "debug"] as const;

  for (const level of levels) {
    const original = consoleObj[level];
    consoleObj[level] = (...args: unknown[]) => {
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
