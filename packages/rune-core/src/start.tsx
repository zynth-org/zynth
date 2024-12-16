// [HMR-DEBUG] bootstrap
const __HMR_DEBUG = (function () {
  const g = globalThis as any;
  const enabled = g.__RUNE_HMR_DEBUG ?? true;
  function t() {
    try {
      return new Date().toISOString().split("T")[1];
    } catch {
      return "";
    }
  }
  function log(level: "log" | "warn" | "error", tag: string, ...args: any[]) {
    const prefix = `[HMR-DEBUG ${t()} ${tag}]`;
    (console as any)[level](prefix, ...args);
  }
  return {
    on: enabled,
    log: (...a: any[]) => log("log", "BOOT", ...a),
    warn: (...a: any[]) => log("warn", "BOOT", ...a),
    error: (...a: any[]) => log("error", "BOOT", ...a),
    raw: { log },
  };
})();
__HMR_DEBUG.log(
  "start.tsx loaded; console OK? ->",
  typeof console !== "undefined"
);

// Polyfill for queueMicrotask
if (typeof globalThis.queueMicrotask !== "function") {
  globalThis.queueMicrotask = function (callback) {
    Promise.resolve()
      .then(callback)
      .catch((e) =>
        setTimeout(() => {
          try {
            throw e;
          } catch (err) {
            const msg = String((err as any)?.message || err);
            const stack = String((err as any)?.stack || "");
            console.error("[microtask-unhandled]", msg);
            if (stack) console.error("[microtask-unhandled:stack]", stack);
            // rethrow to keep behavior consistent with original polyfill
            throw err;
          }
        }, 0)
      );
  };
}

import { render, setHost } from "./renderer";
import { createIOSHost } from "./host/ios";
import { createAndroidHost } from "./host/android";
import { ensureNativeHMRHooks } from "./hmr";

let lastRootId: number | null = null;
let currentApp: (() => any) | null = null;
let disposeCurrentApp: (() => void) | null = null;

export function start(App: () => any) {
  ensureNativeHMRHooks();
  const g = globalThis as any;

  currentApp = App;

  g.__rune_rerenderApp = () => {
    if (lastRootId == null) {
      console.warn("[RuneRuntime] rerender requested before root id set");
      return;
    }
    if (typeof currentApp !== "function") {
      console.warn("[RuneRuntime] rerender requested before app initialized");
      return;
    }
    try {
      disposeCurrentApp?.();
      disposeCurrentApp = render(() => currentApp!(), {
        id: lastRootId,
        type: "root",
      } as any);
      console.log("[RuneRuntime] rerender completed");
    } catch (error) {
      const msg = String((error as any)?.message || error);
      const stack = String((error as any)?.stack || "");
      console.error(`[RuneRuntime] rerender failed: ${msg}`);
      if (stack) console.error(`[RuneRuntime] rerender stack: ${stack}`);
      throw error;
    }
  };

  g.__rune_updateApp = (NextApp: () => any) => {
    if (typeof NextApp !== "function") {
      console.warn("[RuneRuntime] updateApp received non-function", NextApp);
      return;
    }
    currentApp = NextApp;
    if (lastRootId != null) {
      try {
        g.__rune_rerenderApp();
      } catch (error) {
        console.error("[RuneRuntime] updateApp rerender failed", error);
      }
    }
  };

  // Export the __startApp function for the native runtime to call
  g.__startApp = (...args: any[]) => {
    console.log("__startApp called!");
    const rootId = args[0];

    // Initialize the host here, now that we are in the native-invoked entry point.
    // This ensures native bindings like `__ui` are available.
    const platform =
      typeof globalThis !== "undefined"
        ? (globalThis as any).__RUNE_PLATFORM
        : undefined;
    setHost(platform === "android" ? createAndroidHost() : createIOSHost());

    if (typeof rootId !== "number" || isNaN(rootId)) {
      console.error(`Invalid rootId received: ${rootId}`);
      return;
    }

    console.log(`Starting render with rootId: ${rootId}`);
    if (typeof currentApp !== "function") {
      console.error("[__startApp] no app registered for rendering");
      return;
    }

    try {
      disposeCurrentApp?.();
      disposeCurrentApp = render(() => currentApp!(), {
        id: rootId,
        type: "root",
      } as any);
      lastRootId = rootId;
      console.log("Render completed successfully");
    } catch (error) {
      const msg = String((error as any)?.message || error);
      const stack = String((error as any)?.stack || "");
      console.error(`[__startApp] render failed: ${msg}`);
      if (stack) console.error(`[__startApp] stack: ${stack}`);
      throw error;
    }
  };
}

// [HMR-DEBUG] attach webpack bridges & accept boundary
(function attachHMRBridges() {
  const g = globalThis as any;
  const req = (g.__webpack_require__ ||
    (globalThis as any).__webpack_require__) as any;
  __HMR_DEBUG.log("attachHMRBridges: __webpack_require__ =", typeof req);

  // Bridge module tables to globals so update chunks can find them.
  try {
    const factories =
      (req && req.m) || g.__webpack_modules__ || Object.create(null);
    const cache =
      (req && req.c) || g.__webpack_module_cache__ || Object.create(null);
    g.__webpack_modules__ = factories;
    g.__webpack_module_cache__ = cache;
    if (req) {
      req.m = factories;
      req.c = cache;
    }
    const facCount = factories ? Object.keys(factories).length : -1;
    const cacheCount = cache ? Object.keys(cache).length : -1;
    __HMR_DEBUG.log(
      "bridged module tables: factories=",
      facCount,
      "cache=",
      cacheCount
    );
  } catch (e) {
    __HMR_DEBUG.error("module table bridging failed", e);
  }

  // Accept boundary for App if hot exists in this scope
  const m: any = typeof module !== "undefined" ? (module as any) : undefined;
  let hot: any;
  try {
    hot = (import.meta as any).hot;
  } catch {
    // import.meta not available
  }
  if (!hot) {
    hot = m && m.hot;
  }
  if (hot && typeof hot.accept === "function") {
    const APP_ID = "./src/App.tsx";
    __HMR_DEBUG.log("registering hot.accept for", APP_ID);
    try {
      hot.accept(APP_ID, (updated: any) => {
        const exp =
          updated?.default ?? (req ? req(APP_ID)?.default : undefined);
        __HMR_DEBUG.log(
          "hot.accept callback for",
          APP_ID,
          "default?",
          typeof exp
        );
        try {
          (globalThis as any).__rune_updateApp?.(exp);
          __HMR_DEBUG.log("__rune_updateApp invoked");
        } catch (e) {
          __HMR_DEBUG.error("__rune_updateApp failed", e);
          (globalThis as any).__rune_rerenderApp?.();
        }
      });
    } catch (e) {
      __HMR_DEBUG.error("hot.accept registration failed", e);
    }
  } else {
    __HMR_DEBUG.warn("module.hot not available in start.tsx scope");
  }

  // Wrap webpackHotUpdate to trace update flow
  const original = (globalThis as any).webpackHotUpdate;
  (globalThis as any).webpackHotUpdate = function (
    chunkId: any,
    moreModules: any,
    runtime?: any
  ) {
    __HMR_DEBUG.log(
      "webpackHotUpdate invoked:",
      chunkId,
      "ids",
      moreModules ? Object.keys(moreModules) : "none"
    );
    try {
      if (typeof original === "function")
        original(chunkId, moreModules, runtime);
    } catch (e) {
      __HMR_DEBUG.error("original webpackHotUpdate threw", e);
    }
    try {
      const ids = moreModules ? Object.keys(moreModules) : [];
      for (const id of ids) {
        __HMR_DEBUG.log("evaluating updated id", id);
        try {
          (req || (globalThis as any).__webpack_require__)(id);
        } catch (e) {
          __HMR_DEBUG.error("require failed for", id, e);
        }
        if (id === "./src/App.tsx") {
          const next = (req || (globalThis as any).__webpack_require__)(
            id
          )?.default;
          __HMR_DEBUG.log("updated App default type:", typeof next);
          try {
            (globalThis as any).__rune_updateApp?.(next);
          } catch (e) {
            __HMR_DEBUG.error("updateApp in webpackHotUpdate failed", e);
          }
        }
      }
    } catch (e) {
      __HMR_DEBUG.error("post-apply tracing failed", e);
    }
  };
  __HMR_DEBUG.log(
    "webpackHotUpdate wrapper installed?",
    typeof (globalThis as any).webpackHotUpdate
  );
})();

// [HMR-DEBUG] wrap __rune_updateApp / __rune_rerenderApp to trace calls
(function wrapRuneAppFns() {
  const g = globalThis as any;
  const prevUpdate = g.__rune_updateApp;
  const prevRerender = g.__rune_rerenderApp;
  if (typeof prevUpdate === "function") {
    g.__rune_updateApp = function (next: any) {
      __HMR_DEBUG.log("__rune_updateApp called with", typeof next);
      try {
        return prevUpdate(next);
      } finally {
        __HMR_DEBUG.log("__rune_updateApp returned");
      }
    };
  } else {
    __HMR_DEBUG.warn("__rune_updateApp not defined yet at wrap time");
  }
  if (typeof prevRerender === "function") {
    g.__rune_rerenderApp = function () {
      __HMR_DEBUG.log("__rune_rerenderApp called");
      try {
        return prevRerender();
      } finally {
        __HMR_DEBUG.log("__rune_rerenderApp returned");
      }
    };
  } else {
    __HMR_DEBUG.warn("__rune_rerenderApp not defined yet at wrap time");
  }
})();

// [HMR-DEBUG-END]
