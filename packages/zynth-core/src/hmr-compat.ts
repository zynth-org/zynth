import "./polyfills/fetch";
import "./polyfills/URL";
import { callNative } from "./bridge";
import { installWebSocket } from "./polyfills/WebSocket";

declare const __webpack_require__: {
  l?: (url: string, done: (event?: unknown) => void, key?: string, chunkId?: string) => void;
  p?: string;
};
declare const __ZYNTH_HMR_DEBUG: boolean | undefined;

type RuntimeGlobal = Record<string, unknown> & {
  __ZYNTH_DEV_SERVER_URL?: string;
  __ZYNTH_DEV_SERVER_TOKEN?: string;
  __ZYNTH_HMR_DEBUG?: unknown;
  __zynth_hmr_compat_installed?: boolean;
  __zynth_hmr_loader_installed?: boolean;
  __zynth_hmr_loader_require?: unknown;
  __zynth_reloadFromDevServer?: () => void;
  __zynth_getRootId?: () => number | null;
  __zynth_disposeRoot?: () => void;
  __zynth_entry_hmr_dispose?: () => void;
  Solid$$?: boolean;
  window?: Record<string, unknown>;
  self?: unknown;
};

function getGlobalObject(): RuntimeGlobal {
  return globalThis as unknown as RuntimeGlobal;
}

function getDevServerBase(): string | null {
  const base = getGlobalObject().__ZYNTH_DEV_SERVER_URL;
  return typeof base === "string" && base.length > 0 ? base : null;
}

function isDebugEnabled(): boolean {
  if (
    typeof __ZYNTH_HMR_DEBUG !== "undefined" &&
    __ZYNTH_HMR_DEBUG === true
  ) {
    return true;
  }
  const flag = getGlobalObject().__ZYNTH_HMR_DEBUG;
  return flag === true || flag === "true" || flag === 1 || flag === "1";
}

function debugLog(message: string, ...details: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log("[Zynth HMR Compat]", message, ...details);
}

function resolveDevUrl(rawUrl: string): string {
  const base = getDevServerBase();
  let resolved = rawUrl;
  if (base && rawUrl.startsWith("/")) {
    resolved = `${base.replace(/\/+$/, "")}${rawUrl}`;
  }
  const token = getGlobalObject().__ZYNTH_DEV_SERVER_TOKEN;
  if (!token) return resolved;
  const separator = resolved.includes("?") ? "&" : "?";
  return resolved.includes("token=")
    ? resolved
    : `${resolved}${separator}token=${encodeURIComponent(token)}`;
}

function installWindowShape(): void {
  const g = getGlobalObject();
  if (!g.self) {
    g.self = g;
  }
  const windowObject =
    g.window && typeof g.window === "object"
      ? (g.window as Record<string, unknown>)
      : g;
  g.window = windowObject;

  const base = getDevServerBase() ?? "http://localhost";
  const parsed = new URL(base);
  debugLog("install window shape", {
    base,
    hostname: parsed.hostname,
    port: parsed.port,
    protocol: parsed.protocol,
  });
  windowObject.location ??= {
    hostname: parsed.hostname,
    port: parsed.port,
    protocol: parsed.protocol,
    reload: () => {
      const reload = g.__zynth_reloadFromDevServer;
      if (typeof reload === "function") {
        reload();
      }
    },
  };
  g.location ??= windowObject.location;
  windowObject.addEventListener ??= () => undefined;
  windowObject.removeEventListener ??= () => undefined;
}

function installReloadHook(): void {
  const g = getGlobalObject();
  g.__zynth_reloadFromDevServer = () => {
    const rootId = typeof g.__zynth_getRootId === "function" ? g.__zynth_getRootId() : null;
    const disposeRoot = g.__zynth_disposeRoot;
    debugLog("request full reload", {
      url: g.__ZYNTH_DEV_SERVER_URL,
      rootId,
      hasToken: typeof g.__ZYNTH_DEV_SERVER_TOKEN === "string",
    });
    if (typeof disposeRoot === "function") {
      disposeRoot();
    }
    const disposeEntryHMR = g.__zynth_entry_hmr_dispose;
    if (typeof disposeEntryHMR === "function") {
      disposeEntryHMR();
    }
    g.Solid$$ = false;
    void callNative("WebSocket", "reloadDevBundle", {
      url: g.__ZYNTH_DEV_SERVER_URL,
      token: g.__ZYNTH_DEV_SERVER_TOKEN,
      rootId,
    }).catch((error) => {
      console.error("[Zynth HMR] full reload failed", error);
    });
  };
}

function installRspackLoaderPatch(): void {
  const g = getGlobalObject();
  const runtimeRequire =
    typeof __webpack_require__ === "function"
      ? __webpack_require__
      : (g.__webpack_require__ as typeof __webpack_require__ | undefined);
  if (!runtimeRequire) {
    debugLog("loader patch skipped; __webpack_require__ unavailable");
    return;
  }
  if (
    g.__zynth_hmr_loader_installed &&
    g.__zynth_hmr_loader_require === runtimeRequire
  ) {
    return;
  }
  g.__zynth_hmr_loader_installed = true;
  g.__zynth_hmr_loader_require = runtimeRequire;

  const previousLoad = runtimeRequire.l;
  debugLog("patching Rspack script loader", {
    hasPreviousLoad: typeof previousLoad === "function",
    publicPath: runtimeRequire.p,
  });
  runtimeRequire.l = (url, done, key, chunkId) => {
    const resolved = resolveDevUrl(url);
    debugLog("hot chunk requested", { url, resolved, key, chunkId });
    fetch(resolved, {
      headers: { "Cache-Control": "no-cache" },
    } as unknown as Parameters<typeof fetch>[1])
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Hot update chunk fetch failed: ${response.status}`);
        }
        return response.text();
      })
      .then((code) => {
        debugLog("hot chunk fetched", { resolved, bytes: code.length });
        (0, eval)(`${code}\n//# sourceURL=${resolved}`);
        debugLog("hot chunk evaluated", { resolved, key, chunkId });
        done({ type: "load", target: { src: resolved, key, chunkId } });
      })
      .catch((error) => {
        console.error("[Zynth HMR] hot update chunk failed", error);
        if (typeof previousLoad === "function" && !getDevServerBase()) {
          debugLog("falling back to previous script loader", { url, key, chunkId });
          previousLoad(url, done, key, chunkId);
          return;
        }
        done({ type: "error", target: { src: resolved, error } });
        const reload = g.__zynth_reloadFromDevServer;
        if (typeof reload === "function") {
          reload();
        }
      });
  };

  if (getDevServerBase()) {
    runtimeRequire.p = `${getDevServerBase()!.replace(/\/+$/, "")}/`;
    debugLog("set Rspack public path", runtimeRequire.p);
  }
}

export function installNativeHMRCompat(): void {
  const g = getGlobalObject();
  if (g.__zynth_hmr_compat_installed) {
    debugLog("compat already installed; refreshing loader patch");
    installRspackLoaderPatch();
    return;
  }
  g.__zynth_hmr_compat_installed = true;
  debugLog("install compat", {
    devServerUrl: g.__ZYNTH_DEV_SERVER_URL,
    hasToken: typeof g.__ZYNTH_DEV_SERVER_TOKEN === "string",
  });
  installWebSocket();
  installReloadHook();
  installWindowShape();
  installRspackLoaderPatch();
}
