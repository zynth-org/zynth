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

export function start(App: () => any) {
  ensureNativeHMRHooks();
  const platform =
    typeof globalThis !== "undefined"
      ? (globalThis as any).__RUNE_PLATFORM
      : undefined;
  const isAndroid = platform === "android";

  setHost(isAndroid ? createAndroidHost() : createIOSHost());

  // Export the __startApp function for the native runtime to call
  (globalThis as any).__startApp = (...args: any[]) => {
    console.log("__startApp called!");
    const rootId = args[0];

    if (typeof rootId !== "number" || isNaN(rootId)) {
      console.error(`Invalid rootId received: ${rootId}`);
      return;
    }

    console.log(`Starting render with rootId: ${rootId}`);
    try {
      render(() => <App />, { id: rootId, type: "root" } as any);
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
