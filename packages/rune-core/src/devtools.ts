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
  if (g.__RUNE_DEVTOOLS_CONSOLE_INSTALLED__) return;
  g.__RUNE_DEVTOOLS_CONSOLE_INSTALLED__ = true;

  const consoleObj = (g.console ||= {});
  const levels = ["log", "info", "warn", "error", "debug"] as const;

  for (const level of levels) {
    const original = consoleObj[level];
    consoleObj[level] = (...args: unknown[]) => {
      bridge.emit({
        topic: "log/console",
        level,
        tag: "console",
        data: formatConsoleArgs(args),
      });
      if (g.__RUNE_DEVTOOLS_CONSOLE_PASSTHROUGH__ && typeof original === "function") {
        original(...args);
      }
    };
  }
}

export function emitDevtoolsEvent(event: RuneDevtoolsEvent): void {
  ensureDevtoolsBridge()?.emit(event);
}
