import { sharedNativeEventEmitter } from "@zynth/core";
import type { ColorScheme } from "./types";

type AppearanceSnapshot = {
  colorScheme?: ColorScheme;
  scheme?: ColorScheme;
};

type NativeBridge = {
  callSync?: (name: string, method: string, args?: unknown) => unknown;
  call?: (name: string, method: string, args?: unknown) => unknown;
};

type NativeAppearanceModule = {
  getColorScheme?: () => ColorScheme | null;
  addColorSchemeListener?: (
    listener: (scheme: ColorScheme) => void,
  ) => () => void;
};

const MODULE_KEY = "ZynthAppearance";
const EVENT_NAME = "ZynthAppearance:change";

declare global {
  var NativeConstants: Record<string, any>;
  var __ZYNTH_APPEARANCE__: NativeAppearanceModule | undefined;
}

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

function normalizeScheme(value: unknown): ColorScheme | null {
  if (value === "light" || value === "dark") {
    return value;
  }
  return null;
}

function unwrapSnapshot(value: unknown): AppearanceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  if ("result" in (value as Record<string, unknown>)) {
    const result = (value as Record<string, unknown>).result;
    return result && typeof result === "object"
      ? (result as AppearanceSnapshot)
      : null;
  }
  return value as AppearanceSnapshot;
}

function readNativeConstants(): ColorScheme | null {
  const globalObj = getGlobalObject();
  const constants = globalObj.NativeConstants as
    | Record<string, unknown>
    | undefined;
  // console.log("[UITheme] NativeConstants", constants ? Object.keys(constants) : null);
  if (!constants) return null;

  const rawSnapshot =
    (constants[MODULE_KEY] as AppearanceSnapshot | undefined) ??
    (constants.Appearance as AppearanceSnapshot | undefined);

  const snapshot = unwrapSnapshot(rawSnapshot);
  if (!snapshot) return null;
  return normalizeScheme(snapshot.colorScheme ?? snapshot.scheme);
}

function readFromBridge(): ColorScheme | null {
  const globalObj = getGlobalObject();
  const bridge = (globalObj as { __modules?: unknown }).__modules as
    | NativeBridge
    | undefined;
  // console.log("[UITheme] __modules", bridge ? Object.keys(bridge as object) : null);
  if (!bridge?.callSync) return null;
  try {
    const result = bridge.callSync(MODULE_KEY, "getCurrent", null);
    const snapshot = unwrapSnapshot(result);
    if (!snapshot) return null;
    return normalizeScheme(snapshot.colorScheme ?? snapshot.scheme);
  } catch {
    // Try async call for runtimes that only support `call`.
    try {
      if (bridge?.call) {
        const result = bridge.call(MODULE_KEY, "getCurrent", null);
        const snapshot = unwrapSnapshot(result);
        if (snapshot) {
          return normalizeScheme(snapshot.colorScheme ?? snapshot.scheme);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }
}

function readFromNativeModule(): ColorScheme | null {
  const globalObj = getGlobalObject() as {
    __ZYNTH_APPEARANCE__?: NativeAppearanceModule;
  };
  const module = globalObj.__ZYNTH_APPEARANCE__ ?? null;
  if (!module?.getColorScheme) return null;
  return module.getColorScheme() ?? null;
}

function readFromMatchMedia(): ColorScheme | null {
  if (typeof globalThis === "undefined") return null;
  const matchMedia = (globalThis as any).matchMedia as
    | ((query: string) => MediaQueryList)
    | undefined;
  if (typeof matchMedia !== "function") return null;
  const query = matchMedia("(prefers-color-scheme: dark)");
  return query.matches ? "dark" : "light";
}

export function getSystemColorScheme(): ColorScheme {
  const fromNativeModule = readFromNativeModule();
  const fromBridge = readFromBridge();
  const fromConstants = readNativeConstants();
  const fromMatchMedia = readFromMatchMedia();
  const resolved =
    fromNativeModule ??
    fromBridge ??
    fromConstants ??
    fromMatchMedia ??
    "light";

  // console.log("[UITheme] system scheme", {
  //   resolved,
  //   fromNativeModule,
  //   fromConstants,
  //   fromBridge,
  //   fromMatchMedia,
  // });

  return resolved;
}

export function subscribeToSystemColorScheme(
  listener: (scheme: ColorScheme) => void,
): () => void {
  const unsubscribers: Array<() => void> = [];

  const globalObj = getGlobalObject() as {
    __ZYNTH_APPEARANCE__?: NativeAppearanceModule;
  };
  const module = globalObj.__ZYNTH_APPEARANCE__;
  if (module?.addColorSchemeListener) {
    unsubscribers.push(module.addColorSchemeListener(listener));
  }

  const subscription = sharedNativeEventEmitter.addListener(
    EVENT_NAME,
    (payload) => {
      // console.log("[UITheme] native event", EVENT_NAME, payload);
      if (!payload) return;
      if (typeof payload === "string") {
        const scheme = normalizeScheme(payload);
        if (scheme) listener(scheme);
        return;
      }
      if (typeof payload === "object") {
        const snapshot = payload as AppearanceSnapshot;
        const scheme = normalizeScheme(snapshot.colorScheme ?? snapshot.scheme);
        if (scheme) listener(scheme);
      }
    },
  );
  unsubscribers.push(() => subscription.remove());

  const globalMatchMedia = (getGlobalObject() as any).matchMedia as
    | ((query: string) => MediaQueryList)
    | undefined;
  if (typeof globalMatchMedia === "function") {
    const query = globalMatchMedia("(prefers-color-scheme: dark)");
    const handler = () => listener(query.matches ? "dark" : "light");
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      unsubscribers.push(() => query.removeEventListener("change", handler));
    } else if (typeof query.addListener === "function") {
      query.addListener(handler);
      unsubscribers.push(() => query.removeListener(handler));
    }
  }

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
