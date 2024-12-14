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
      render(() => currentApp!(), { id: lastRootId, type: "root" } as any);
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
      render(() => currentApp!(), { id: rootId, type: "root" } as any);
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
