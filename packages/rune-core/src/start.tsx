import { render, setHost } from "./renderer";
import { createIOSHost } from "./host/ios";
import { createAndroidHost } from "./host/android";
import {
  ensureNativeHMRHooks,
  setupEntryPointHMR,
  wrapRuneAppFns,
} from "./hmr";

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
        }, 0)
      );
  };
}

let lastRootId: number | null = null;
let currentApp: (() => any) | null = null;
let disposeCurrentApp: (() => void) | null = null;

export function start(App: () => any): () => void {
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

  const disposeRoot = () => {
    if (typeof disposeCurrentApp === "function") {
      try {
        disposeCurrentApp();
      } catch (error) {
        console.error("[RuneRuntime] dispose failed", error);
      }
    }
    disposeCurrentApp = null;
    currentApp = null;
    lastRootId = null;
  };

  g.__startApp = (...args: any[]) => {
    console.log("__startApp called!");
    const rootId = args[0];

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

  g.__rune_disposeRoot = disposeRoot;

  wrapRuneAppFns();
  setupEntryPointHMR();

  return disposeRoot;
}
