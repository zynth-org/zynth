const __HMR_DEBUG = (function () {
  const g = globalThis as any;
  const enabled = g.__RUNE_HMR_DEBUG ?? true;
  function timestamp() {
    try {
      return new Date().toISOString().split("T")[1];
    } catch {
      return "";
    }
  }
  function emit(level: "log" | "warn" | "error", tag: string, ...args: any[]) {
    if (!enabled) {
      return;
    }
    // const prefix = `[HMR-DEBUG ${timestamp()} ${tag}]`;
    // (console as any)[level](prefix, ...args);
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

export type RuneHMRPayload = {
  type: string;
  [key: string]: any;
};

export type RuneHMRListener = (payload: RuneHMRPayload) => void;

const nativeListeners = new Set<RuneHMRListener>();
let nativeHooksInstalled = false;

function parsePayload(payload: unknown): RuneHMRPayload | null {
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
        ? (parsed as RuneHMRPayload)
        : null;
    } catch (error) {
      NATIVE_LOG.error("parsePayload: failed to parse string payload", error);
      console.error("[Rune HMR] Failed to parse payload", error);
      return null;
    }
  }
  if (typeof payload === "object") {
    NATIVE_LOG.log("parsePayload: object payload");
    return payload as RuneHMRPayload;
  }
  return null;
}

function dispatchNativePayload(payload: RuneHMRPayload) {
  if (nativeListeners.size === 0) {
    // console.warn(
    //   "[Rune HMR] Received payload but no listeners registered",
    //   payload.type
    // );
    return;
  }
  for (const listener of Array.from(nativeListeners)) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[Rune HMR] Listener threw", error);
    }
  }
}

export function ensureNativeHMRHooks() {
  if (nativeHooksInstalled) {
    return;
  }
  nativeHooksInstalled = true;
  const g = globalThis as any;
  const previous =
    typeof g.__rune_refresh === "function" ? g.__rune_refresh : undefined;
  const isDefaultStub = (() => {
    if (typeof previous !== "function") return false;
    if ((previous as any).__isRuneDefaultStub === true) return true;
    const src = String(previous);
    return src.includes("Refresh invoked with no runtime listener");
  })();

  g.__rune_refresh = (value: unknown) => {
    const payload = parsePayload(value);
    NATIVE_LOG.log("rune_refresh", payload);
    if (!payload) {
      NATIVE_LOG.warn("Ignoring invalid payload", value);
      return;
    }
    if (previous && previous !== g.__rune_refresh && !isDefaultStub) {
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

export function onNativeHMR(listener: RuneHMRListener): () => void {
  ensureNativeHMRHooks();
  nativeListeners.add(listener);
  NATIVE_LOG.log("onNativeHMR: add listener (total)", nativeListeners.size);
  return () => {
    nativeListeners.delete(listener);
    NATIVE_LOG.log(
      "onNativeHMR: remove listener (total)",
      nativeListeners.size
    );
  };
}

export function setFallbackFullReload(
  handler: (payload: RuneHMRPayload) => void
) {
  const g = globalThis as any;
  g.__rune_requestFullReload = handler;
  NATIVE_LOG.warn("setFallbackFullReload handler installed");
}

declare const __DEV__: boolean | undefined;

declare const module: {
  hot?: {
    accept(
      deps?: string | string[],
      callback?: (updatedModule?: { default?: unknown }) => void
    ): void;
  };
};

const APP_MODULE_CANDIDATES = new Set<string>([
  "./src/App.tsx",
  "./App.tsx",
  "./App",
]);
let devHMRBootstrapInstalled = false;

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
  if (typeof g.__RUNE_FORCE_HMR === "boolean") {
    return g.__RUNE_FORCE_HMR;
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
  return (
    moduleId === "./App" ||
    moduleId === "App" ||
    moduleId.includes("App.ts") ||
    moduleId.includes("App.js") ||
    moduleId.includes("App.jsx") ||
    moduleId.includes("App.tsx")
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

function resolveAppModule(updatedExports?: unknown, preferredModuleId?: string) {
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
      ? (id: string) => Object.prototype.hasOwnProperty.call(moduleFactories, id)
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

function handleAppHotUpdate(moduleId: string, updatedExports?: unknown) {
  const g = globalThis as any;
  if (looksLikeAppModule(moduleId)) {
    registerAppModuleCandidate(moduleId);
  } else if (!APP_MODULE_CANDIDATES.has(moduleId)) {
    UPDATE_LOG.log("Ignoring hot update for", moduleId);
    return;
  }

  const nextApp = resolveAppModule(updatedExports, moduleId);

  if (typeof nextApp === "function") {
    if (typeof g.__rune_updateApp === "function") {
      try {
        g.__rune_updateApp(nextApp);
        UPDATE_LOG.log("__rune_updateApp invoked for", moduleId);
        return;
      } catch (error) {
        UPDATE_LOG.error("__rune_updateApp failed", error);
      }
    }
    if (typeof g.__rune_rerenderApp === "function") {
      try {
        g.__rune_rerenderApp();
        UPDATE_LOG.log("__rune_rerenderApp invoked for", moduleId);
        return;
      } catch (error) {
        UPDATE_LOG.error("__rune_rerenderApp failed", error);
      }
    }
  }

  console.warn(
    "[Rune HMR] No suitable update handler for",
    moduleId,
    typeof nextApp
  );
}

function processUpdatedModules(
  moreModules: Record<string, any> | undefined,
  runtimeHandlers?: any
) {
  const g = globalThis as any;
  const runtimeRequire = ensureModuleTables();
  if (!runtimeRequire) {
    BUNDLE_LOG.warn("processUpdatedModules: runtimeRequire unavailable");
    return;
  }

  const moduleFactories = ((runtimeRequire as any).m ??
    g.__webpack_modules__) as Record<string, any>;
  const moduleCache = ((runtimeRequire as any).c ??
    g.__webpack_module_cache__) as Record<string, any>;

  const updatedIds = Object.keys(moreModules ?? {});

  const hmrDataMap = ((runtimeRequire as any)?.hmrD ??
    (g.__webpack_require__ as any)?.hmrD ??
    undefined) as Record<string, unknown> | undefined;

  for (const moduleId of updatedIds) {
    const factory = moreModules?.[moduleId];
    if (factory) {
      moduleFactories[moduleId] = factory;
    }

    const cached = moduleCache[moduleId];
    if (!cached) continue;

    const hotState = cached.hot;
    if (hotState && Array.isArray(hotState._disposeHandlers)) {
      const data = (hotState.data = hotState.data ?? {});
      for (const dispose of hotState._disposeHandlers) {
        try {
          dispose(data);
        } catch (error) {
          console.error(`[HMR] dispose failed for ${moduleId}`, error);
        }
      }
      if (hmrDataMap) {
        hmrDataMap[moduleId] = data;
      }
    } else if (hmrDataMap && hotState?.data) {
      hmrDataMap[moduleId] = hotState.data;
    }

    delete moduleCache[moduleId];
  }

  const runtimeFns = Array.isArray(runtimeHandlers)
    ? runtimeHandlers
    : runtimeHandlers
    ? [runtimeHandlers]
    : [];
  for (const fn of runtimeFns) {
    if (typeof fn === "function") {
      try {
        fn(runtimeRequire);
      } catch (error) {
        console.error("[HMR] runtime handler failed", error);
      }
    }
  }

  for (const moduleId of updatedIds) {
    let updatedModuleExports: unknown;
    try {
      updatedModuleExports = runtimeRequire(moduleId);
    } catch (error) {
      console.error(
        `[HMR] Failed to evaluate updated module ${moduleId}`,
        error
      );
    }

    try {
      handleAppHotUpdate(moduleId, updatedModuleExports);
    } catch (error) {
      console.error(`[HMR] handleHotUpdate failed for ${moduleId}`, error);
    }
  }
}

function installWebpackHotUpdateHook() {
  const g = globalThis as any;
  ensureModuleTables();
  const original = g.webpackHotUpdate;

  g.webpackHotUpdate = function (
    chunkId: any,
    moreModules: Record<string, any> | undefined,
    runtime?: any
  ) {
    ensureModuleTables();
    BUNDLE_LOG.log(
      "webpackHotUpdate invoked:",
      chunkId,
      "ids",
      moreModules ? Object.keys(moreModules) : "none"
    );
    if (!originalHotUpdateFailed && typeof original === "function") {
      try {
        original.call(g, chunkId, moreModules, runtime);
      } catch (error) {
        originalHotUpdateFailed = true;
        if (__HMR_DEBUG.on) {
          BUNDLE_LOG.warn(
            "original webpackHotUpdate threw; falling back to custom handler",
            error
          );
        }
      }
    }

    try {
      processUpdatedModules(moreModules, runtime);
    } catch (error) {
      BUNDLE_LOG.error("post-apply processing failed", error);
    }
  };

  BUNDLE_LOG.log(
    "webpackHotUpdate wrapper installed?",
    typeof g.webpackHotUpdate
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
          typeof updated?.default
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
  if (devHMRBootstrapInstalled) {
    return;
  }

  const hot = detectHotContext();
  if (!shouldEnableDevHMR(hot)) {
    BOOT_LOG.log("Entry HMR bootstrap disabled (no dev context)");
    return;
  }

  devHMRBootstrapInstalled = true;
  BOOT_LOG.log("Installing dev HMR bootstrap");

  ensureModuleTables();

  ensureNativeHMRHooks();

  const disposeNativeWarningListener = onNativeHMR((payload) => {
    if (payload?.type === "warnings") {
      const warnings = (payload.warnings as unknown[]) ?? [];
      for (const warning of warnings) {
        console.warn("[Rune HMR] warning", warning);
      }
    }
  });

  registerAppModuleCandidate("./App");
  registerAppModuleCandidate("./App.tsx");

  const g = globalThis as any;
  g.__rune_handleHotUpdate = handleAppHotUpdate;
  g.__rune_registerAppModuleCandidate = registerAppModuleCandidate;

  installWebpackHotUpdateHook();
  setupModuleHotAccept(hot);

  return () => {
    disposeNativeWarningListener();
  };
}

let debugWrappersInstalled = false;
export function wrapRuneAppFns() {
  if (!__HMR_DEBUG.on || debugWrappersInstalled) {
    return;
  }
  debugWrappersInstalled = true;
  const g = globalThis as any;
  const prevUpdate = g.__rune_updateApp;
  const prevRerender = g.__rune_rerenderApp;
  if (typeof prevUpdate === "function") {
    g.__rune_updateApp = function (next: any) {
      UPDATE_LOG.log("__rune_updateApp called with", typeof next);
      try {
        return prevUpdate(next);
      } finally {
        UPDATE_LOG.log("__rune_updateApp returned");
      }
    };
  } else {
    UPDATE_LOG.warn("__rune_updateApp not defined yet at wrap time");
  }
  if (typeof prevRerender === "function") {
    g.__rune_rerenderApp = function () {
      UPDATE_LOG.log("__rune_rerenderApp called");
      try {
        return prevRerender();
      } finally {
        UPDATE_LOG.log("__rune_rerenderApp returned");
      }
    };
  } else {
    UPDATE_LOG.warn("__rune_rerenderApp not defined yet at wrap time");
  }
}

ensureNativeHMRHooks();

(function traceEmitter() {
  const g = globalThis as any;
  const prev = g.__rune_emitDevMessage;
  g.__rune_emitDevMessage = function (payload: any) {
    NATIVE_LOG.log("emitDevMessage ->", payload?.type, payload);
    return prev ? prev(payload) : undefined;
  };
  NATIVE_LOG.log("__rune_emitDevMessage tracer attached");
})();
