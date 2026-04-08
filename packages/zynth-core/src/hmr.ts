import { installNativeHMRCompat } from "./hmr-compat";

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
  let latestHash: string | null = null;
  let lastAppliedHash: string | null = null;
  let applyInFlight = false;

  function shouldApply(payload: ZynthHMRPayload): boolean {
    if (payload.type === "hash") {
      latestHash = typeof payload.data === "string" ? payload.data : latestHash;
      UPDATE_LOG.log("received hash", latestHash);
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
    if (!latestHash) {
      UPDATE_LOG.log("skipping apply; no hash yet", payload.type);
      return false;
    }
    if (lastAppliedHash === latestHash) {
      UPDATE_LOG.log("skipping apply; hash already applied", latestHash);
      return false;
    }
    return true;
  }

  function requestApply(trigger: string): void {
    if (applyInFlight) {
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
      return;
    }
    applyInFlight = true;
    UPDATE_LOG.log("calling hot.check(true)", {
      trigger,
      latestHash,
      lastAppliedHash,
      status,
    });
    Promise.resolve(hot.check(true)).then(
      (updatedModules) => {
        UPDATE_LOG.log("hot.check resolved", {
          updatedModules,
          latestHash,
        });
        lastAppliedHash = latestHash;
        applyInFlight = false;
      },
      (error) => {
        UPDATE_LOG.error("hot.check failed", error);
        applyInFlight = false;
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
): boolean {
  const g = globalThis as any;
  if (looksLikeAppModule(moduleId)) {
    registerAppModuleCandidate(moduleId);
  } else if (!APP_MODULE_CANDIDATES.has(moduleId)) {
    UPDATE_LOG.log("Module update handled via fallback rerender", moduleId);
    return false;
  }

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

function processUpdatedModules(
  moreModules: Record<string, any> | undefined,
  runtimeHandlers?: any,
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

  let hasSelfAccepted = false;
  for (const moduleId of updatedIds) {
    const factory = moreModules?.[moduleId];
    if (factory) {
      moduleFactories[moduleId] = factory;
    }

    const cached = moduleCache[moduleId];
    if (!cached) continue;

    const hotState = cached.hot;
    if (
      hotState &&
      hotState._selfAccepted &&
      hotState._selfInvalidated !== true
    ) {
      hasSelfAccepted = true;
    }
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

  const anyAppUpdate = updatedIds.some((id) => looksLikeAppModule(id));
  if (!anyAppUpdate && !hasSelfAccepted) {
    for (const candidate of APP_MODULE_CANDIDATES) {
      if (moduleCache[candidate]) {
        delete moduleCache[candidate];
      }
    }
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

  let handledAny = false;
  for (const moduleId of updatedIds) {
    let updatedModuleExports: unknown;
    try {
      updatedModuleExports = runtimeRequire(moduleId);
    } catch (error) {
      console.error(
        `[HMR] Failed to evaluate updated module ${moduleId}`,
        JSON.stringify(error),
      );
    }

    try {
      if (handleAppHotUpdate(moduleId, updatedModuleExports)) {
        handledAny = true;
      }
    } catch (error) {
      console.error(`[HMR] handleHotUpdate failed for ${moduleId}`, error);
    }
  }

  if (!handledAny && !hasSelfAccepted) {
    const nextApp = resolveAppModule(undefined);
    if (
      typeof nextApp === "function" &&
      typeof g.__zynth_updateApp === "function"
    ) {
      try {
        g.__zynth_updateApp(nextApp);
        UPDATE_LOG.log("Fallback updateApp invoked for updated modules");
        return;
      } catch (error) {
        UPDATE_LOG.error("Fallback updateApp failed", error);
      }
    }
    if (typeof g.__zynth_rerenderApp === "function") {
      try {
        g.__zynth_rerenderApp();
        UPDATE_LOG.log("Fallback rerender invoked for updated modules");
      } catch (error) {
        UPDATE_LOG.error("Fallback rerender failed", error);
      }
    }
  }
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
            "original webpackHotUpdate threw; falling back to custom handler",
            error,
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
        console.warn("[Zynth HMR] warning", warning);
      }
    }
  });
  const disposeRspackApplyDriver = installRspackNativeApplyDriver(hot);

  registerAppModuleCandidate("./App");
  registerAppModuleCandidate("./App.tsx");

  const g = globalThis as any;
  g.__zynth_handleHotUpdate = handleAppHotUpdate;
  g.__zynth_registerAppModuleCandidate = registerAppModuleCandidate;

  installNativeHMRCompat();
  BOOT_LOG.log("HMR bootstrap ready");

  return () => {
    disposeNativeWarningListener();
    disposeRspackApplyDriver();
  };
}

let debugWrappersInstalled = false;
export function wrapZynthAppFns() {
  if (!__HMR_DEBUG.on || debugWrappersInstalled) {
    return;
  }
  debugWrappersInstalled = true;
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
