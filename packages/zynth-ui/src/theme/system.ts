import { sharedNativeEventEmitter } from "@zynthjs/core";
import { runWithOwner } from "solid-js";
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
  var NativeConstants: Record<string, unknown> | undefined;
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
  const matchMedia = (globalThis as unknown as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
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

  return resolved;
}

export function subscribeToSystemColorScheme(
  listener: (scheme: ColorScheme) => void,
): () => void {
  const unsubscribers: Array<() => void> = [];

  const safeNotify = (scheme: ColorScheme) => {
    runWithOwner(null, () => listener(scheme));
  };

  const globalObj = getGlobalObject() as {
    __ZYNTH_APPEARANCE__?: NativeAppearanceModule;
  };
  const module = globalObj.__ZYNTH_APPEARANCE__;
  if (module?.addColorSchemeListener) {
    unsubscribers.push(module.addColorSchemeListener((scheme) => safeNotify(scheme)));
  }

  const subscription = sharedNativeEventEmitter.addListener(
    EVENT_NAME,
    (payload) => {
      if (!payload) return;
      if (typeof payload === "string") {
        const scheme = normalizeScheme(payload);
        if (scheme) safeNotify(scheme);
        return;
      }
      if (typeof payload === "object") {
        const snapshot = payload as AppearanceSnapshot;
        const scheme = normalizeScheme(snapshot.colorScheme ?? snapshot.scheme);
        if (scheme) safeNotify(scheme);
      }
    },
  );
  unsubscribers.push(() => subscription.remove());

  const globalMatchMedia = (getGlobalObject() as unknown as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof globalMatchMedia === "function") {
    const query = globalMatchMedia("(prefers-color-scheme: dark)");
    const handler = () => safeNotify(query.matches ? "dark" : "light");
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      unsubscribers.push(() => query.removeEventListener("change", handler));
    } else if (typeof (query as unknown as { addListener?: (h: () => void) => void }).addListener === "function") {
      (query as unknown as { addListener: (h: () => void) => void }).addListener(handler);
      unsubscribers.push(() => (query as unknown as { removeListener: (h: () => void) => void }).removeListener(handler));
    }
  }

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
