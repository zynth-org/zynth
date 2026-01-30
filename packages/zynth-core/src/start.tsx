import { Platform, OS } from "@zynth/apis";
import { Text, View } from "@zynth/components";
import { render, setHost } from "./renderer";
import { createIOSHost } from "./host/ios";
import { createAndroidHost } from "./host/android";
import {
  ensureNativeHMRHooks,
  setupEntryPointHMR,
  wrapZynthAppFns,
} from "./hmr";
import { setActiveSurface } from "./surface";
import {
  addDevtoolsListener,
  ensureDevtoolsBridge,
  installDevtoolsConsole,
  installDevtoolsErrorHandlers,
} from "./devtools";
import {
  ErrorOverlayLayer,
  installErrorOverlayDiagnostics,
  isErrorOverlayEnabled,
  wrapWithErrorOverlay,
} from "@zynth/error-overlay";
import { getActiveSurface } from "./surface";

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
let disposeOverlay: (() => void) | null = null;
let overlaySurfaceId: number | null = null;
let disposeDevBanner: (() => void) | null = null;
let devBannerSurfaceId: number | null = null;
let hasStarted = false;
const gStart = globalThis as any;

const SURFACE_ID_OFFSET = 1 << 20;

function getOverlaySurfaceId(rootId: number): number {
  if (rootId >= SURFACE_ID_OFFSET) {
    return rootId + 1;
  }
  return rootId + SURFACE_ID_OFFSET;
}

function runWithSurface<T>(surfaceId: number, work: () => T): T {
  const previous = getActiveSurface();
  const shouldSwitch = previous !== surfaceId;
  if (shouldSwitch) {
    setActiveSurface(surfaceId);
  }
  try {
    return work();
  } finally {
    if (shouldSwitch) {
      setActiveSurface(previous ?? surfaceId);
    }
  }
}

function mountErrorOverlaySurface(rootId: number) {
  if (!isErrorOverlayEnabled()) return;
  if (disposeOverlay) return;
  const surfaceId = getOverlaySurfaceId(rootId);
  overlaySurfaceId = surfaceId;
  disposeOverlay = render(
    () => runWithSurface(surfaceId, () => <ErrorOverlayLayer />),
    { id: surfaceId, type: "root" } as any,
  );
}

export function start(App: () => any): () => void {
  // Native Platform Initialization
  ensureNativeHMRHooks();
  ensureDevtoolsBridge();
  installDevtoolsConsole();
  installDevtoolsErrorHandlers();
  installErrorOverlayDiagnostics(addDevtoolsListener);
  const g = globalThis as any;

  currentApp = isErrorOverlayEnabled() ? App : wrapWithErrorOverlay(App);

  g.__zynth_rerenderApp = () => {
    if (lastRootId == null) {
      console.warn("[ZynthRuntime] rerender requested before root id set");
      return;
    }
    if (typeof currentApp !== "function") {
      console.warn("[ZynthRuntime] rerender requested before app initialized");
      return;
    }
    try {
      disposeCurrentApp?.();
      disposeCurrentApp = render(() => currentApp!(), {
        id: lastRootId,
        type: "root",
      } as any);
      console.log("[ZynthRuntime] rerender completed");
    } catch (error) {
      const msg = String((error as any)?.message || error);
      const stack = String((error as any)?.stack || "");
      console.error(`[ZynthRuntime] rerender failed: ${msg}`);
      if (stack) console.error(`[ZynthRuntime] rerender stack: ${stack}`);
      throw error;
    }
  };

  g.__zynth_updateApp = (NextApp: () => any) => {
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
    if (typeof disposeOverlay === "function") {
      try {
        disposeOverlay();
      } catch (error) {
        console.error("[ZynthRuntime] overlay dispose failed", error);
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
    disposeOverlay = null;
    overlaySurfaceId = null;
    disposeDevBanner = null;
    devBannerSurfaceId = null;
  };

  g.__startApp = (...args: any[]) => {
    console.log("__startApp called!");
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
    mountErrorOverlaySurface(rootId);
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

  g.__zynth_disposeRoot = disposeRoot;

  wrapZynthAppFns();
  setupEntryPointHMR();

  return disposeRoot;
}
