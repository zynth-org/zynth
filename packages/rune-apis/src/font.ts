type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
};

type WebFontSources = Record<string, string>;
const webLoadedFonts = new Set<string>();

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

    try {
      await bridge.call("Font", "loadAsync", {
        fontFamily,
        resourceName,
      });
    } catch (error) {
      throw error;
    }
  },
};
