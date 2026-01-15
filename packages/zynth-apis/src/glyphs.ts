import { Font } from "./font";

type GlyphEntry = {
  glyph: string;
  fontFamily: string;
  resourceName?: string;
  webSource?: string;
};

const glyphRegistry = new Map<string, GlyphEntry>();

export const Glyphs = {
  register: (
    fontFamily: string,
    glyphMap: Record<string, string>,
    options?: { resourceName?: string; webSource?: string }
  ) => {
    Object.entries(glyphMap).forEach(([name, glyph]) => {
      glyphRegistry.set(name, {
        glyph,
        fontFamily,
        resourceName: options?.resourceName,
        webSource: options?.webSource,
      });
    });
    Font.register(fontFamily, {
      resourceName: options?.resourceName,
      webSource: options?.webSource,
    });
  },
  resolve: (name: string): GlyphEntry | null => {
    return glyphRegistry.get(name) ?? null;
  },
  isLoaded: (name: string): boolean => {
    const entry = glyphRegistry.get(name);
    if (!entry) return false;
    return Font.isLoaded(entry.fontFamily);
  },
  ensureLoaded: async (name: string): Promise<boolean> => {
    const entry = glyphRegistry.get(name);
    if (!entry) return false;
    await Font.ensureLoaded(entry.fontFamily, {
      resourceName: entry.resourceName,
      webSource: entry.webSource,
    });
    return true;
  },
  registerRuntime: (
    fontFamily: string,
    glyphMap: Record<string, string>,
    options?: { resourceName?: string; webSource?: string }
  ) => {
    Glyphs.register(fontFamily, glyphMap, options);
  },
};
