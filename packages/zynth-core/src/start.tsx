import { Platform, OS } from "./platform";
import { render, setHost, withHostBatch } from "./renderer";
import { createIOSHost } from "./host/ios";
import { createAndroidHost } from "./host/android";
import {
  ensureNativeHMRHooks,
  setupEntryPointHMR,
  wrapZynthAppFns,
} from "./hmr";
import { setActiveSurface } from "./surface";
import {
  ensureDevtoolsBridge,
  installDevtoolsConsole,
  installDevtoolsErrorHandlers,
} from "./devtools";

if (typeof globalThis.queueMicrotask !== "function") {
  globalThis.queueMicrotask = function (callback) {
    Promise.resolve()
      .then(callback)
      .catch((error) =>
        setTimeout(() => {
          try {
            throw error;
          } catch (err) {
            const msg = String((err as any)?.message || err);
            const stack = String((err as any)?.stack || "");
            console.error("[microtask-unhandled]", msg);
            if (stack) console.error("[microtask-unhandled:stack]", stack);
            throw err;
          }
        }, 0),
      );
  };
}

let lastRootId: number | null = null;
let currentApp: (() => any) | null = null;
let disposeCurrentApp: (() => void) | null = null;
let disposeDevBanner: (() => void) | null = null;
let devBannerSurfaceId: number | null = null;
let hasStarted = false;

export function start(App: () => any): () => void {
  // Native Platform Initialization
  ensureNativeHMRHooks();
  ensureDevtoolsBridge();
  installDevtoolsConsole();
  installDevtoolsErrorHandlers();
  const g = globalThis as any;

  currentApp = App;

  g.__zynth_rerenderApp = () => {
    if ((globalThis as any).__ZYNTH_HMR_TRACE === true) {
      console.log("[HMR-TRACE] __zynth_rerenderApp called");
      try {
        throw new Error("[HMR-TRACE] stack");
      } catch (error) {
        console.log(String((error as any)?.stack || error));
      }
    }
    if (lastRootId == null) {
      console.warn("[ZynthRuntime] rerender requested before root id set");
      return;
    }
    if (typeof currentApp !== "function") {
      console.warn("[ZynthRuntime] rerender requested before app initialized");
      return;
    }
    try {
      withHostBatch({ kind: "hmr", scope: "app" }, () => {
        disposeCurrentApp?.();
        disposeCurrentApp = render(() => currentApp!(), {
          id: lastRootId,
          type: "root",
        } as any);
      });
      // console.log("[ZynthRuntime] rerender completed");
    } catch (error) {
      const msg = String((error as any)?.message || error);
      const stack = String((error as any)?.stack || "");
      console.error(`[ZynthRuntime] rerender failed: ${msg}`);
      if (stack) console.error(`[ZynthRuntime] rerender stack: ${stack}`);
      throw error;
    }
  };

  g.__zynth_getRootId = () => lastRootId;

  g.__zynth_updateApp = (NextApp: () => any) => {
    if ((globalThis as any).__ZYNTH_HMR_TRACE === true) {
      console.log("[HMR-TRACE] __zynth_updateApp called");
      try {
        throw new Error("[HMR-TRACE] stack");
      } catch (error) {
        console.log(String((error as any)?.stack || error));
      }
    }
    if (typeof NextApp !== "function") {
      console.warn("[ZynthRuntime] updateApp received non-function", NextApp);
      return;
    }
    currentApp = NextApp;
    if (lastRootId != null) {
      try {
        g.__zynth_rerenderApp();
      } catch (error) {
        console.error("[ZynthRuntime] updateApp rerender failed", error);
      }
    }
  };

  const disposeRoot = () => {
    if (typeof disposeCurrentApp === "function") {
      try {
        disposeCurrentApp();
      } catch (error) {
        console.error("[ZynthRuntime] dispose failed", error);
      }
    }
    if (typeof disposeDevBanner === "function") {
      try {
        disposeDevBanner();
      } catch (error) {
        console.error("[ZynthRuntime] dev banner dispose failed", error);
      }
    }
    disposeCurrentApp = null;
    currentApp = null;
    lastRootId = null;
    disposeDevBanner = null;
    devBannerSurfaceId = null;
    hasStarted = false;
    delete g.__zynth_getRootId;
  };

  g.__startApp = (...args: any[]) => {
    if ((globalThis as any).__ZYNTH_HMR_TRACE === true) {
      console.log("[HMR-TRACE] __startApp called with", args[0]);
      try {
        throw new Error("[HMR-TRACE] stack");
      } catch (error) {
        console.log(String((error as any)?.stack || error));
      }
    }
    const rootId = args[0];

    const platform = Platform.OS;
    setHost(platform === OS.ANDROID ? createAndroidHost() : createIOSHost());

    if (typeof rootId !== "number" || isNaN(rootId)) {
      console.error(`Invalid rootId received: ${rootId}`);
      return;
    }

    if (hasStarted && lastRootId === rootId) {
      console.log("[ZynthRuntime] __startApp ignored (already started)");
      return;
    }
    hasStarted = true;
    setActiveSurface(rootId);
    if (typeof currentApp !== "function") {
      console.error("[__startApp] no app registered for rendering");
      return;
    }

    try {
      withHostBatch({ kind: "start", scope: "app" }, () => {
        disposeCurrentApp?.();
        disposeCurrentApp = render(() => currentApp!(), {
          id: rootId,
          type: "root",
        } as any);
      });
      lastRootId = rootId;
    } catch (error) {
      const msg = String((error as any)?.message || error);
      const stack = String((error as any)?.stack || "");
      console.error(`[__startApp] render failed: ${msg}`);
      if (stack) console.error(`[__startApp] stack: ${stack}`);
      throw error;
    }
  };

  g.__zynth_disposeRoot = disposeRoot;

  wrapZynthAppFns();
  setupEntryPointHMR();

  return disposeRoot;
}
