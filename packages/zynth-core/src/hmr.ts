import { installNativeHMRCompat } from "./hmr-compat";
import { callNative } from "./bridge";

const __HMR_DEBUG = (function () {
  const g = globalThis as any;
  const enabled =
    g.__ZYNTH_HMR_DEBUG === true || g.__ZYNTH_HMR_DEBUG === "true";
  function timestamp() {
    try {
      return new Date().toISOString().split("T")[1];
    } catch {
      return "";
    }
  }
  function formatArg(value: any): any {
    if (value == null) return value;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return value;
    try {
      return JSON.stringify(value);
    } catch {
      try {
        return String(value);
      } catch {
        return "[unprintable]";
      }
    }
  }
  function emit(level: "log" | "warn" | "error", tag: string, ...args: any[]) {
    if (!enabled) {
      return;
    }
    const prefix = `[HMR-DEBUG ${timestamp()} ${tag}]`;
    const formatted = args.map((arg) => formatArg(arg));
    (console as any)[level](prefix, ...formatted);
  }
  function channel(tag: string) {
    return {
      log: (...args: any[]) => emit("log", tag, ...args),
      warn: (...args: any[]) => emit("warn", tag, ...args),
      error: (...args: any[]) => emit("error", tag, ...args),
    };
  }
  return {
    on: enabled,
    log: (...args: any[]) => emit("log", "BOOT", ...args),
    warn: (...args: any[]) => emit("warn", "BOOT", ...args),
    error: (...args: any[]) => emit("error", "BOOT", ...args),
    channel,
  };
})();

const BOOT_LOG = __HMR_DEBUG.channel("BOOT");
const NATIVE_LOG = __HMR_DEBUG.channel("NATIVE");
const BUNDLE_LOG = __HMR_DEBUG.channel("BUNDLE");
const UPDATE_LOG = __HMR_DEBUG.channel("UPDATE");

declare const __webpack_require__: any;

let originalHotUpdateFailed = false;

export type ZynthHMRPayload = {
  type: string;
  [key: string]: any;
};

export type ZynthHMRListener = (payload: ZynthHMRPayload) => void;

const nativeListeners = (() => {
  const g = globalThis as any;
  if (!(g.__zynthNativeHMRListeners instanceof Set)) {
    g.__zynthNativeHMRListeners = new Set<ZynthHMRListener>();
  }
  return g.__zynthNativeHMRListeners as Set<ZynthHMRListener>;
})();

const hmrState = (() => {
  const g = globalThis as any;
  if (!g.__zynthHMRState) {
    g.__zynthHMRState = {
      applyInFlight: false,
      latestHash: null as string | null,
      lastAppliedHash: null as string | null,
    };
  }
  return g.__zynthHMRState as {
    applyInFlight: boolean;
    latestHash: string | null;
    lastAppliedHash: string | null;
  };
})();

function parsePayload(payload: unknown): ZynthHMRPayload | null {
  NATIVE_LOG.log("parsePayload", typeof payload);
  if (payload == null) {
    NATIVE_LOG.log("parsePayload: null or undefined payload");
    return null;
  }
  if (typeof payload === "string") {
    try {
      NATIVE_LOG.log("parsePayload: string payload", payload);
      const parsed = JSON.parse(payload);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as ZynthHMRPayload)
        : null;
    } catch (error) {
      NATIVE_LOG.error("parsePayload: failed to parse string payload", error);
      console.error("[Zynth HMR] Failed to parse payload", error);
      return null;
    }
  }
  if (typeof payload === "object") {
    NATIVE_LOG.log("parsePayload: object payload");
    return payload as ZynthHMRPayload;
  }
  return null;
}

function dispatchNativePayload(payload: ZynthHMRPayload) {
  if (nativeListeners.size === 0) {
    // console.warn(
    //   "[Zynth HMR] Received payload but no listeners registered",
    //   payload.type
    // );
    return;
  }
  for (const listener of Array.from(nativeListeners)) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[Zynth HMR] Listener threw", error);
    }
  }
}

export function ensureNativeHMRHooks() {
  const g = globalThis as any;
  if (g.__zynthNativeHMRHooksInstalled === true) {
    return;
  }
  g.__zynthNativeHMRHooksInstalled = true;
  const previous =
    typeof g.__zynth_refresh === "function" ? g.__zynth_refresh : undefined;
  const isDefaultStub = (() => {
    if (typeof previous !== "function") return false;
    if ((previous as any).__isZynthDefaultStub === true) return true;
    const src = String(previous);
    return src.includes("Refresh invoked with no runtime listener");
  })();

  g.__zynth_refresh = (value: unknown) => {
    const payload = parsePayload(value);
    NATIVE_LOG.log("zynth_refresh", payload);
    if (!payload) {
      NATIVE_LOG.warn("Ignoring invalid payload", value);
      return;
    }
    if (previous && previous !== g.__zynth_refresh && !isDefaultStub) {
      NATIVE_LOG.log("Calling previous refresh handler", previous);
      try {
        previous(payload);
      } catch (error) {
        NATIVE_LOG.error("Previous refresh handler failed", error);
      }
    }
    dispatchNativePayload(payload);
  };
}

export function onNativeHMR(listener: ZynthHMRListener): () => void {
  ensureNativeHMRHooks();
  nativeListeners.add(listener);
  NATIVE_LOG.log("onNativeHMR: add listener (total)", nativeListeners.size);
  return () => {
    nativeListeners.delete(listener);
    NATIVE_LOG.log(
      "onNativeHMR: remove listener (total)",
      nativeListeners.size,
    );
  };
}

export function setFallbackFullReload(
  handler: (payload: ZynthHMRPayload) => void,
) {
  const g = globalThis as any;
  g.__zynth_requestFullReload = handler;
  NATIVE_LOG.warn("setFallbackFullReload handler installed");
}

declare const __DEV__: boolean | undefined;

declare const module: {
  hot?: {
    accept(
      deps?: string | string[],
      callback?: (updatedModule?: { default?: unknown }) => void,
    ): void;
    check?: (autoApply?: boolean) => Promise<unknown> | unknown;
    status?: () => string;
  };
};

const APP_MODULE_CANDIDATES = new Set<string>([
  "./src/App.tsx",
  "./App.tsx",
  "./App",
]);

const getGlobalBootFlag = (name: string): boolean => {
  return (globalThis as any)[`__zynth_hmr_boot_${name}`] === true;
};
const setGlobalBootFlag = (name: string, value: boolean) => {
  (globalThis as any)[`__zynth_hmr_boot_${name}`] = value;
};

function registerAppModuleCandidate(id?: string) {
  if (typeof id !== "string") {
    return;
  }
  const normalized = id.trim();
  if (!normalized) {
    return;
  }
  APP_MODULE_CANDIDATES.add(normalized);
}

function detectHotContext(): any {
  let hot: any;
  try {
    hot = (import.meta as any).hot;
  } catch {
    // import.meta not available
  }
  if (!hot && typeof module !== "undefined" && module?.hot) {
    hot = module.hot;
  }
  return hot;
}

function shouldEnableDevHMR(hot: any): boolean {
  const g = globalThis as any;
  if (typeof g.__ZYNTH_FORCE_HMR === "boolean") {
    return g.__ZYNTH_FORCE_HMR;
  }
  if (hot) {
    return true;
  }
  if (typeof __DEV__ !== "undefined") {
    return Boolean(__DEV__);
  }
  const proc = g.process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV !== "production";
  }
  return false;
}

function installRspackNativeApplyDriver(hot: any): () => void {
  function shouldApply(payload: ZynthHMRPayload): boolean {
    if (payload.type === "hash") {
      hmrState.latestHash =
        typeof payload.data === "string" ? payload.data : hmrState.latestHash;
      UPDATE_LOG.log("received hash", hmrState.latestHash);
      return false;
    }
    if (
      payload.type !== "ok" &&
      payload.type !== "still-ok" &&
      payload.type !== "built" &&
      payload.type !== "sync"
    ) {
      return false;
    }
    if (!hmrState.latestHash) {
      UPDATE_LOG.log("skipping apply; no hash yet", payload.type);
      return false;
    }
    if (hmrState.lastAppliedHash === hmrState.latestHash) {
      UPDATE_LOG.log("skipping apply; hash already applied", hmrState.latestHash);
      return false;
    }
    return true;
  }

  function requestApply(trigger: string): void {
    if (hmrState.applyInFlight) {
      UPDATE_LOG.log("apply already in flight", trigger);
      return;
    }
    if (!hot || typeof hot.check !== "function") {
      UPDATE_LOG.warn("hot.check unavailable; cannot apply", trigger);
      return;
    }
    const status = typeof hot.status === "function" ? hot.status() : "unknown";
    if (status !== "idle" && status !== "unknown") {
      UPDATE_LOG.log("hot runtime not idle", { trigger, status });
      if (status === "fail") {
        const reload = (globalThis as any).__zynth_reloadFromDevServer;
        if (typeof reload === "function") {
          reload();
        }
      }
      return;
    }
    hmrState.applyInFlight = true;
    UPDATE_LOG.log("calling hot.check(true)", {
      trigger,
      latestHash: hmrState.latestHash,
      lastAppliedHash: hmrState.lastAppliedHash,
      status,
    });

    Promise.resolve(hot.check(true)).then(
      (updatedModules) => {
        UPDATE_LOG.log("hot.check resolved", {
          updatedModules,
          latestHash: hmrState.latestHash,
        });

        // Only trigger a fallback re-render if an App-like module was updated
        // and we haven't already handled it via a more specific hot.accept handler.
        if (Array.isArray(updatedModules) && updatedModules.length > 0) {
          const g = globalThis as any;
          const anyAppUpdated = updatedModules.some((id) =>
            looksLikeAppModule(id),
          );
          if (anyAppUpdated) {
            UPDATE_LOG.log(
              "App-like module updated; triggering fallback rerender",
            );
            if (typeof g.__zynth_rerenderApp === "function") {
              try {
                g.__zynth_rerenderApp();
              } catch (error) {
                UPDATE_LOG.error("Fallback rerender failed", error);
              }
            }
          }
        }

        void callNative("WebSocket", "pulseHmrIndicator", {}).catch(
          (error) => {
            UPDATE_LOG.warn("pulseHmrIndicator failed", error);
          },
        );
        hmrState.lastAppliedHash = hmrState.latestHash;
        hmrState.applyInFlight = false;
      },
      (error) => {
        UPDATE_LOG.error("hot.check failed", error);
        hmrState.applyInFlight = false;
        const reload = (globalThis as any).__zynth_reloadFromDevServer;
        if (typeof reload === "function") {
          reload();
        }
      },
    );
  }

  return onNativeHMR((payload) => {
    if (!shouldApply(payload)) return;
    requestApply(payload.type);
  });
}

function ensureModuleTables() {
  const g = globalThis as any;

  let runtimeRequire: any =
    typeof g.__webpack_require__ === "function"
      ? g.__webpack_require__
      : undefined;

  if (!runtimeRequire && typeof __webpack_require__ === "function") {
    runtimeRequire = __webpack_require__;
  }

  if (!runtimeRequire && typeof (g as any).__webpack_require__ === "function") {
    runtimeRequire = (g as any).__webpack_require__;
  }

  if (!runtimeRequire) {
    if (!g.__webpack_modules__) {
      g.__webpack_modules__ = Object.create(null);
    }
    if (!g.__webpack_module_cache__) {
      g.__webpack_module_cache__ = Object.create(null);
    }
    return undefined;
  }

  const existingFactories =
    runtimeRequire.m && typeof runtimeRequire.m === "object"
      ? runtimeRequire.m
      : undefined;
  const existingCache =
    runtimeRequire.c && typeof runtimeRequire.c === "object"
      ? runtimeRequire.c
      : undefined;

  const factories =
    existingFactories ?? g.__webpack_modules__ ?? Object.create(null);
  const cache =
    existingCache ?? g.__webpack_module_cache__ ?? Object.create(null);

  if (existingFactories && factories !== existingFactories) {
    Object.assign(factories, existingFactories);
  }
  if (existingCache && cache !== existingCache) {
    Object.assign(cache, existingCache);
  }

  runtimeRequire.m = factories;
  runtimeRequire.c = cache;

  g.__webpack_modules__ = factories;
  g.__webpack_module_cache__ = cache;

  if (typeof g.__webpack_require__ !== "function") {
    g.__webpack_require__ = runtimeRequire;
  }

  return runtimeRequire;
}

function looksLikeAppModule(moduleId: string) {
  if (typeof moduleId !== "string") {
    return false;
  }
  if (APP_MODULE_CANDIDATES.has(moduleId)) {
    return true;
  }
  // Be more strict: only match App.tsx if it's at the start or follows a slash,
  // to avoid matching things like "SomeOtherComponentApp.tsx" (if that existed).
  return (
    moduleId === "./App" ||
    moduleId === "App" ||
    /(^|\/|\\)App\.(ts|js)x?$/.test(moduleId)
  );
}

function pickAppExport(updatedExports?: unknown): (() => any) | undefined {
  if (typeof updatedExports === "function") {
    return updatedExports as () => any;
  }
  if (
    !updatedExports ||
    (typeof updatedExports !== "object" && typeof updatedExports !== "function")
  ) {
    return undefined;
  }
  const maybeDefault = (updatedExports as { default?: unknown }).default;
  if (typeof maybeDefault === "function") {
    return maybeDefault as () => any;
  }
  const maybeNamed = (updatedExports as { App?: unknown }).App;
  if (typeof maybeNamed === "function") {
    return maybeNamed as () => any;
  }
  return undefined;
}

function resolveAppModule(
  updatedExports?: unknown,
  preferredModuleId?: string,
) {
  const direct = pickAppExport(updatedExports);
  if (direct) {
    return direct;
  }

  if (preferredModuleId) {
    registerAppModuleCandidate(preferredModuleId);
  }

  const runtimeRequire = ensureModuleTables();
  if (!runtimeRequire) {
    BUNDLE_LOG.warn("resolveAppModule: runtimeRequire unavailable");
    return undefined;
  }

  const g = globalThis as any;
  const moduleFactories =
    (runtimeRequire as any).m ?? (g.__webpack_modules__ as Record<string, any>);
  const hasFactory =
    moduleFactories && typeof moduleFactories === "object"
      ? (id: string) =>
          Object.prototype.hasOwnProperty.call(moduleFactories, id)
      : undefined;

  const candidates = new Set<string>(APP_MODULE_CANDIDATES);
  if (preferredModuleId) {
    candidates.add(preferredModuleId);
  }

  for (const id of candidates) {
    if (hasFactory && !hasFactory(id)) {
      continue;
    }
    try {
      const exports = runtimeRequire(id);
      const next = pickAppExport(exports);
      if (typeof next === "function") {
        registerAppModuleCandidate(id);
        return next as () => any;
      }
    } catch (error) {
      BUNDLE_LOG.log("resolveAppModule require failed", id, error);
    }
  }

  return undefined;
}

function handleAppHotUpdate(
  moduleId: string,
  updatedExports?: unknown,
  dryRun: boolean = false
): boolean {
  const g = globalThis as any;
  if (looksLikeAppModule(moduleId)) {
    registerAppModuleCandidate(moduleId);
  } else if (!APP_MODULE_CANDIDATES.has(moduleId)) {
    UPDATE_LOG.log("Module update handled via fallback rerender", moduleId);
    return false;
  }

  if (dryRun) return true;

  const nextApp = resolveAppModule(updatedExports, moduleId);

  if (typeof nextApp === "function") {
    if (typeof g.__zynth_updateApp === "function") {
      try {
        g.__zynth_updateApp(nextApp);
        UPDATE_LOG.log("__zynth_updateApp invoked for", moduleId);
        return true;
      } catch (error) {
        UPDATE_LOG.error("__zynth_updateApp failed", error);
      }
    }
    if (typeof g.__zynth_rerenderApp === "function") {
      try {
        g.__zynth_rerenderApp();
        UPDATE_LOG.log("__zynth_rerenderApp invoked for", moduleId);
        return true;
      } catch (error) {
        UPDATE_LOG.error("__zynth_rerenderApp failed", error);
      }
    }
  }

  console.warn(
    "[Zynth HMR] No suitable update handler for",
    moduleId,
    typeof nextApp,
  );
  return false;
}

function installWebpackHotUpdateHook() {
  const g = globalThis as any;
  if (g.__zynthWebpackHotUpdateHookInstalled === true) {
    return;
  }
  g.__zynthWebpackHotUpdateHookInstalled = true;
  ensureModuleTables();
  const original = g.webpackHotUpdate;

  g.webpackHotUpdate = function (
    chunkId: any,
    moreModules: Record<string, any> | undefined,
    runtime?: any,
  ) {
    ensureModuleTables();
    BUNDLE_LOG.log(
      "webpackHotUpdate invoked:",
      chunkId,
      "ids",
      moreModules ? Object.keys(moreModules) : "none",
    );
    if (!originalHotUpdateFailed && typeof original === "function") {
      try {
        original.call(g, chunkId, moreModules, runtime);
      } catch (error) {
        originalHotUpdateFailed = true;
        if (__HMR_DEBUG.on) {
          BUNDLE_LOG.log(
            "original webpackHotUpdate threw",
            error,
          );
        }
      }
    }
  };

  BUNDLE_LOG.log(
    "webpackHotUpdate wrapper installed?",
    typeof g.webpackHotUpdate,
  );
}

function setupModuleHotAccept(hot: any) {
  if (!hot || typeof hot.accept !== "function") {
    BUNDLE_LOG.warn("module.hot not available in HMR bootstrap scope");
    return;
  }

  const attempted = new Set<string>();
  for (const id of APP_MODULE_CANDIDATES) {
    if (attempted.has(id)) continue;
    attempted.add(id);
    try {
      hot.accept(id, (updated: any) => {
        UPDATE_LOG.log(
          "hot.accept callback for",
          id,
          "default?",
          typeof updated?.default,
        );
        handleAppHotUpdate(id, updated);
      });
    } catch (error) {
      UPDATE_LOG.warn("hot.accept registration failed", id, error);
    }
  }

  try {
    hot.accept();
  } catch (error) {
    UPDATE_LOG.warn("hot.accept without deps failed", error);
  }
}

export function setupEntryPointHMR(): (() => void) | undefined {
  const g = globalThis as any;
  if (getGlobalBootFlag("bootstrap")) {
    return;
  }

  const hot = detectHotContext();
  if (!shouldEnableDevHMR(hot)) {
    BOOT_LOG.log("Entry HMR bootstrap disabled (no dev context)");
    return;
  }

  setGlobalBootFlag("bootstrap", true);
  BOOT_LOG.log("Installing dev HMR bootstrap");

  const previousEntryDispose = g.__zynth_entry_hmr_dispose;
  if (typeof previousEntryDispose === "function") {
    BOOT_LOG.log("Disposing previous entry HMR bootstrap");
    previousEntryDispose();
  }

  ensureModuleTables();
  installWebpackHotUpdateHook();

  ensureNativeHMRHooks();
  setupModuleHotAccept(hot);

  const disposeNativeWarningListener = onNativeHMR((payload) => {
    if (payload?.type === "warnings") {
      const warnings = (payload.warnings as unknown[]) ?? [];
      for (const warning of warnings) {
        console.warn("[Zynth HMR] warning", warning);
      }
    }
  });
  const disposeRspackApplyDriver = installRspackNativeApplyDriver(hot);

  registerAppModuleCandidate("./App");
  registerAppModuleCandidate("./App.tsx");

  g.__zynth_handleHotUpdate = handleAppHotUpdate;
  g.__zynth_registerAppModuleCandidate = registerAppModuleCandidate;

  installNativeHMRCompat();
  BOOT_LOG.log("HMR bootstrap ready");

  const disposeEntryHMR = () => {
    disposeNativeWarningListener();
    disposeRspackApplyDriver();
    if (g.__zynth_entry_hmr_dispose === disposeEntryHMR) {
      g.__zynth_entry_hmr_dispose = undefined;
    }
    setGlobalBootFlag("bootstrap", false);
  };
  g.__zynth_entry_hmr_dispose = disposeEntryHMR;

  return disposeEntryHMR;
}

export function wrapZynthAppFns() {
  if (!__HMR_DEBUG.on || getGlobalBootFlag("wrappers")) {
    return;
  }
  setGlobalBootFlag("wrappers", true);
  const g = globalThis as any;
  const prevUpdate = g.__zynth_updateApp;
  const prevRerender = g.__zynth_rerenderApp;
  if (typeof prevUpdate === "function") {
    g.__zynth_updateApp = function (next: any) {
      UPDATE_LOG.log("__zynth_updateApp called with", typeof next);
      try {
        return prevUpdate(next);
      } finally {
        UPDATE_LOG.log("__zynth_updateApp returned");
      }
    };
  } else {
    UPDATE_LOG.warn("__zynth_updateApp not defined yet at wrap time");
  }
  if (typeof prevRerender === "function") {
    g.__zynth_rerenderApp = function () {
      UPDATE_LOG.log("__zynth_rerenderApp called");
      try {
        return prevRerender();
      } finally {
        UPDATE_LOG.log("__zynth_rerenderApp returned");
      }
    };
  } else {
    UPDATE_LOG.warn("__zynth_rerenderApp not defined yet at wrap time");
  }
}

ensureNativeHMRHooks();

(function traceEmitter() {
  const g = globalThis as any;
  if (g.__zynth_emitDevMessageTracerInstalled === true) {
    return;
  }

  const existing = g.__zynth_emitDevMessage;
  if (typeof g.__zynth_emitDevMessageRaw !== "function") {
    g.__zynth_emitDevMessageRaw = existing;
  }

  g.__zynth_emitDevMessage = function (payload: any) {
    NATIVE_LOG.log("emitDevMessage ->", payload?.type, payload);
    const raw = g.__zynth_emitDevMessageRaw;
    return typeof raw === "function" ? raw(payload) : undefined;
  };
  g.__zynth_emitDevMessageTracerInstalled = true;
  NATIVE_LOG.log("__zynth_emitDevMessage tracer attached");
})();
