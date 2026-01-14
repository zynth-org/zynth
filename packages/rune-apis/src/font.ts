type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
};

type WebFontSources = Record<string, string>;
const webLoadedFonts = new Set<string>();
const fontLoadState = new Map<string, "loading" | "loaded" | "error">();
const fontLoadPromises = new Map<string, Promise<void>>();
const fontLoadListeners = new Map<string, Set<() => void>>();
const fontRegistry = new Map<
  string,
  { resourceName?: string; webSource?: string }
>();

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as any;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function getWebFontSources(): WebFontSources | null {
  const globalObj = getGlobalObject();
  const sources = (globalObj as any).__rune_web_font_sources;
  if (!sources || typeof sources !== "object") {
    return null;
  }
  return sources as WebFontSources;
}

function resolveWebFontSource(
  fontFamily: string,
  resourceName: string
): string | null {
  const isUrlLike =
    resourceName.startsWith("data:") ||
    resourceName.startsWith("http://") ||
    resourceName.startsWith("https://") ||
    resourceName.startsWith("blob:") ||
    resourceName.startsWith("/") ||
    resourceName.startsWith(".");

  if (isUrlLike) {
    return resourceName;
  }

  const sources = getWebFontSources();
  if (!sources) {
    return null;
  }

  return sources[fontFamily] ?? sources[resourceName] ?? null;
}

function registerWebFontSource(
  fontFamily: string,
  webSource: string
): void {
  const globalObj = getGlobalObject();
  const sources = ((globalObj as any).__rune_web_font_sources ??=
    {}) as WebFontSources;
  sources[fontFamily] = webSource;
}

function resolveResourceName(fontFamily: string, resourceName?: string): string {
  if (resourceName) return resourceName;
  const registered = fontRegistry.get(fontFamily);
  if (registered?.resourceName) return registered.resourceName;
  return `${fontFamily}.ttf`;
}

function notifyFontLoaded(fontFamily: string) {
  const listeners = fontLoadListeners.get(fontFamily);
  if (!listeners) return;
  listeners.forEach((cb) => cb());
}

async function loadWebFont(
  fontFamily: string,
  resourceName: string
): Promise<void> {
  if (webLoadedFonts.has(fontFamily)) {
    return;
  }

  const source = resolveWebFontSource(fontFamily, resourceName);
  if (!source) {
    return;
  }

  const docFonts = (document as any).fonts;
  if (typeof FontFace === "function" && docFonts?.add) {
    try {
      const face = new FontFace(fontFamily, `url(${source})`);
      const loaded = await face.load();
      docFonts.add(loaded);
      webLoadedFonts.add(fontFamily);
      return;
    } catch (error) {
      // Fall back to @font-face injection below.
    }
  }

  const styleId = `rune-font-${fontFamily}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
@font-face {
  font-family: "${fontFamily}";
  src: url("${source}") format("truetype");
  font-display: swap;
}
`;
    document.head.appendChild(style);
  }

  if (docFonts?.load) {
    try {
      await docFonts.load(`1em ${fontFamily}`);
      webLoadedFonts.add(fontFamily);
    } catch (error) {
      // Ignore and allow fallback to continue.
    }
  } else {
    webLoadedFonts.add(fontFamily);
  }
}

export const Font = {
  loadAsync: async (
    fontFamily: string,
    resourceName: string
  ): Promise<void> => {
    // Check for web environment
    if (typeof document !== "undefined") {
      await loadWebFont(fontFamily, resourceName);
      return;
    }

    const bridge = getModulesBridge();
    if (!bridge || !bridge.call) {
      return;
    }

    await bridge.call("Font", "loadAsync", {
      fontFamily,
      resourceName,
    });
  },
  register: (
    fontFamily: string,
    options: { resourceName?: string; webSource?: string }
  ) => {
    fontRegistry.set(fontFamily, {
      resourceName: options.resourceName,
      webSource: options.webSource,
    });
    if (options.webSource) {
      registerWebFontSource(fontFamily, options.webSource);
    }
  },
  isLoaded: (fontFamily: string) => fontLoadState.get(fontFamily) === "loaded",
  subscribe: (fontFamily: string, callback: () => void) => {
    let listeners = fontLoadListeners.get(fontFamily);
    if (!listeners) {
      listeners = new Set();
      fontLoadListeners.set(fontFamily, listeners);
    }
    listeners.add(callback);
    return () => listeners!.delete(callback);
  },
  ensureLoaded: async (
    fontFamily: string,
    options?: { resourceName?: string; webSource?: string }
  ): Promise<void> => {
    if (fontLoadState.get(fontFamily) === "loaded") return;
    if (fontLoadState.get(fontFamily) === "loading") {
      await fontLoadPromises.get(fontFamily);
      return;
    }

    if (options?.webSource) {
      registerWebFontSource(fontFamily, options.webSource);
    }
    if (options?.resourceName || options?.webSource) {
      fontRegistry.set(fontFamily, {
        resourceName: options.resourceName,
        webSource: options.webSource,
      });
    }

    fontLoadState.set(fontFamily, "loading");
    const resourceName = resolveResourceName(fontFamily, options?.resourceName);
    const promise = Font.loadAsync(fontFamily, resourceName)
      .then(() => {
        fontLoadState.set(fontFamily, "loaded");
        notifyFontLoaded(fontFamily);
      })
      .catch((error) => {
        fontLoadState.set(fontFamily, "error");
        throw error;
      });

    fontLoadPromises.set(fontFamily, promise);
    await promise;
  },
};
