type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown,
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
  const sources = (globalObj as any).__zynth_web_font_sources;
  if (!sources || typeof sources !== "object") {
    return null;
  }
  return sources as WebFontSources;
}

function resolveWebFontSource(
  fontFamily: string,
  resourceName: string,
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

function registerWebFontSource(fontFamily: string, webSource: string): void {
  const globalObj = getGlobalObject();
  const sources = ((globalObj as any).__zynth_web_font_sources ??=
    {}) as WebFontSources;
  sources[fontFamily] = webSource;
}

function resolveResourceName(
  fontFamily: string,
  resourceName?: string,
): string {
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
  resourceName: string,
): Promise<void> {
  console.log(
    `[Font] loadWebFont start family=${fontFamily} resource=${resourceName}`,
  );
  if (webLoadedFonts.has(fontFamily)) {
    console.log(`[Font] loadWebFont already loaded family=${fontFamily}`);
    return;
  }

  const source = resolveWebFontSource(fontFamily, resourceName);
  if (!source) {
    console.warn(
      `[Font] loadWebFont no source resolved family=${fontFamily} resource=${resourceName}`,
    );
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
      console.warn(
        `[Font] loadWebFont FontFace failed family=${fontFamily}:`,
        error,
      );
      // Fall back to @font-face injection below.
    }
  }

  const styleId = `zynth-font-${fontFamily}`;
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
      console.warn(
        `[Font] loadWebFont document.fonts.load failed family=${fontFamily}:`,
        error,
      );
      // Ignore and allow fallback to continue.
    }
  } else {
    webLoadedFonts.add(fontFamily);
  }
}

export interface FontAssetDescriptor {
  type: "font";
  name: string;
  ext: string;
  hash: string;
  relativePath?: string;
  devPath?: string;
}

export const Font = {
  loadAsync: async (
    fontFamily: string,
    resource: string | FontAssetDescriptor,
  ): Promise<void> => {
    let resourceName: string;

    if (
      typeof resource === "object" &&
      resource !== null &&
      "type" in resource &&
      resource.type === "font"
    ) {
      const descriptor = resource as FontAssetDescriptor;
      if (descriptor.devPath) {
        const globalObj = getGlobalObject();
        const devServerUrl = (globalObj.__ZYNTH_DEV_SERVER_URL as string) || "";
        if (devServerUrl) {
          // Construct /@fs/ URL for dev server
          resourceName = `${devServerUrl}/@fs/${descriptor.devPath}`;
        } else {
          resourceName = descriptor.devPath;
        }
      } else if (descriptor.relativePath) {
        resourceName = descriptor.relativePath;
      } else {
        resourceName = `${descriptor.name}.${descriptor.ext}`;
      }
    } else {
      resourceName = resource as string;
    }

    console.log(
      `[Font] loadAsync start family=${fontFamily} resourceName=${resourceName}`,
    );
    // Check for web environment
    if (typeof document !== "undefined") {
      await loadWebFont(fontFamily, resourceName);
      console.log(`[Font] loadAsync web done family=${fontFamily}`);
      return;
    }

    const bridge = getModulesBridge();
    if (!bridge || !bridge.call) {
      console.warn(
        `[Font] loadAsync no native bridge family=${fontFamily} resourceName=${resourceName}`,
      );
      return;
    }

    const result = await bridge.call("Font", "loadAsync", {
      fontFamily,
      resourceName,
    });
    console.log(
      `[Font] loadAsync native result family=${fontFamily}:`,
      JSON.stringify(result),
    );
  },
  register: (
    fontFamily: string,
    options: {
      resourceName?: string | FontAssetDescriptor;
      webSource?: string;
    },
  ) => {
    fontRegistry.set(fontFamily, {
      resourceName:
        typeof options.resourceName === "string"
          ? options.resourceName
          : undefined, // Keep it simple for now or update fontRegistry type
      webSource: options.webSource,
    });
    // If it's a descriptor, we might want to store it differently
    if (typeof options.resourceName === "object") {
      (fontRegistry.get(fontFamily) as any).descriptor = options.resourceName;
    }

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
    options?: {
      resourceName?: string | FontAssetDescriptor;
      webSource?: string;
    },
  ): Promise<void> => {
    console.log(
      `[Font] ensureLoaded start family=${fontFamily} resource=${options?.resourceName ? (typeof options.resourceName === "string" ? options.resourceName : "(descriptor)") : "(auto)"}`,
    );
    if (fontLoadState.get(fontFamily) === "loaded") return;
    if (fontLoadState.get(fontFamily) === "loading") {
      console.log(`[Font] ensureLoaded already loading family=${fontFamily}`);
      await fontLoadPromises.get(fontFamily);
      return;
    }

    if (options?.webSource) {
      registerWebFontSource(fontFamily, options.webSource);
    }

    fontLoadState.set(fontFamily, "loading");

    // Resolve resource
    let resourceToLoad: string | FontAssetDescriptor;
    if (options?.resourceName) {
      resourceToLoad = options.resourceName;
    } else {
      const registered = fontRegistry.get(fontFamily);
      if (registered) {
        resourceToLoad =
          (registered as any).descriptor ||
          registered.resourceName ||
          `${fontFamily}.ttf`;
      } else {
        resourceToLoad = `${fontFamily}.ttf`;
      }
    }

    const promise = Font.loadAsync(fontFamily, resourceToLoad)
      .then(() => {
        fontLoadState.set(fontFamily, "loaded");
        console.log(`[Font] ensureLoaded loaded family=${fontFamily}`);
        notifyFontLoaded(fontFamily);
      })
      .catch((error) => {
        fontLoadState.set(fontFamily, "error");
        console.error(
          `[Font] ensureLoaded failed family=${fontFamily}:`,
          error,
        );
        throw error;
      });

    fontLoadPromises.set(fontFamily, promise);
    await promise;
  },
};
