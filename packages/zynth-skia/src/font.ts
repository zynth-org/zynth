import { createEffect, createSignal, createResource } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import { Font } from "@zynth/apis";
import type { FontAssetDescriptor, FontLoadResult } from "@zynth/apis";
import type {
  SkiaFont,
  SkiaFontManager,
  SkiaFontStyle,
  SkiaFontStyleSlant,
  SkiaFontWeight,
  SkiaMeasuredText,
  SkiaPoint,
  SkiaScalarValue,
  SkiaTypeface,
  SkiaTypefaceFontProvider,
} from "./types";

type SkiaBridge = {
  measureText?: (
    text: string,
    familyName: string,
    fontSize: number,
    fontStyle: SkiaFontStyleSlant,
    fontWeight: number,
  ) => number;
  listFontFamilies?: () => string[];
  registerFont?: (
    familyName: string,
    dataOrPath: ArrayBuffer | string,
  ) => boolean;
};

const skiaRegisteredFonts = new Set<string>();

export function vec(x: SkiaScalarValue, y: SkiaScalarValue): SkiaPoint {
  return { x, y };
}

function getSkiaBridge(): SkiaBridge | null {
  const globalObj = globalThis as Record<string, unknown>;
  const bridge = globalObj.__zynth_skia;
  if (!bridge || typeof bridge !== "object") return null;
  return bridge as SkiaBridge;
}

function normalizeFontStyle(
  fontStyle: SkiaFontStyle["fontStyle"],
): SkiaFontStyleSlant {
  if (fontStyle === "italic" || fontStyle === "oblique") return fontStyle;
  return "normal";
}

function normalizeFontWeight(
  fontWeight: SkiaFontStyle["fontWeight"],
): SkiaFont["fontWeight"] {
  if (fontWeight === "bold") return 700;
  if (fontWeight === "normal" || fontWeight == null) return 400;
  const parsed = Number(fontWeight);
  if (!Number.isFinite(parsed)) return 400;
  const rounded = Math.round(parsed / 100) * 100;
  const clamped = Math.max(100, Math.min(900, rounded));
  return clamped as SkiaFont["fontWeight"];
}

function parseSource(source: unknown): {
  familyName: string;
  resourceName: string;
} {
  const resolveResourceNameLike = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (!value || typeof value !== "object") return null;

    const asset = value as {
      type?: unknown;
      name?: unknown;
      ext?: unknown;
      relativePath?: unknown;
      devPath?: unknown;
    };

    const pickFileName = (raw: unknown): string | null => {
      if (typeof raw !== "string" || raw.trim().length === 0) return null;
      if (
        raw.includes("://") ||
        raw.startsWith("/") ||
        raw.startsWith("data:")
      ) {
        return raw;
      }
      const normalized = raw.replace(/\\/g, "/");
      const parts = normalized.split("/");
      const last = parts[parts.length - 1]?.trim();
      return last && last.length > 0 ? last : null;
    };

    const relativeName = pickFileName(asset.relativePath);
    if (relativeName) return relativeName;

    const devName = pickFileName(asset.devPath);
    if (devName) return devName;

    if (asset.type === "asset" && typeof asset.name === "string") {
      const name = asset.name.trim();
      const ext = typeof asset.ext === "string" ? asset.ext.trim() : "";
      if (name.length > 0 && ext.length > 0) return `${name}.${ext}`;
      if (name.length > 0) return name;
    }

    return null;
  };

  if (source && typeof source === "object") {
    const maybe = source as { fontFamily?: unknown; resourceName?: unknown };
    if (
      typeof maybe.fontFamily === "string" &&
      maybe.fontFamily.trim().length > 0
    ) {
      const familyName = maybe.fontFamily.trim();
      const resourceName =
        resolveResourceNameLike(maybe.resourceName) ?? `${familyName}.ttf`;
      return { familyName, resourceName };
    }
    
    // Support raw descriptor as source
    const resourceName = resolveResourceNameLike(source);
    if (resourceName) {
      return { familyName: "", resourceName };
    }
  }
  
  if (typeof source !== "string") return { familyName: "", resourceName: "" };
  const trimmed = source.trim();
  if (trimmed.length === 0) return { familyName: "", resourceName: "" };
  const slashIndex = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  const fileName = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  const dotIndex = fileName.lastIndexOf(".");
  const familyName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const resourceName = trimmed;
  return { familyName, resourceName };
}

function resolveFamilyName(source: unknown): string {
  const parsed = parseSource(source);
  if (parsed.familyName) return parsed.familyName;
  
  if (parsed.resourceName) {
    const fileName = parsed.resourceName.split("/").pop() || "";
    const dotIndex = fileName.lastIndexOf(".");
    const derived = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    // Capitalize first letter to be more consistent with typical font family names
    return derived.charAt(0).toUpperCase() + derived.slice(1);
  }
  
  return "";
}

function resolveResourceName(source: unknown): string {
  const parsed = parseSource(source);
  return parsed.resourceName;
}

function resolveAssetUrl(source: unknown): string | null {
  if (typeof source === "string") {
    if (
      source.includes("://") ||
      source.startsWith("/") ||
      source.startsWith("data:")
    ) {
      return source;
    }
    return null;
  }
  if (!source || typeof source !== "object") return null;

  const asset = source as {
    type?: string;
    name?: string;
    ext?: string;
    relativePath?: string;
    devPath?: string;
  };

  if (asset.devPath) {
    const globalObj = globalThis as Record<string, unknown>;
    const devServerUrl = (globalObj.__ZYNTH_DEV_SERVER_URL as string) || "";
    if (devServerUrl) {
      return `${devServerUrl}/@fs/${asset.devPath}`;
    }
    return asset.devPath;
  }

  if (asset.relativePath) return asset.relativePath;

  if (asset.type === "asset" && typeof asset.name === "string") {
    const name = asset.name.trim();
    const ext = typeof asset.ext === "string" ? asset.ext.trim() : "";
    if (name.length > 0 && ext.length > 0) return `${name}.${ext}`;
    if (name.length > 0) return name;
  }

  return null;
}

function resolveTextWidthWithCanvas(text: string, font: SkiaFont): number {
  if (typeof document === "undefined") return 0;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  const style = font.fontStyle === "normal" ? "normal" : font.fontStyle;
  context.font = `${font.fontWeight} ${style} ${font.size}px "${font.familyName}"`;
  return context.measureText(text).width;
}

export function createFontFromStyle(style: SkiaFontStyle): SkiaFont {
  const familyName = (style.fontFamily ?? "").trim();
  const size = Number.isFinite(style.fontSize)
    ? Math.max(0, Number(style.fontSize))
    : 14;
  const fontStyle = normalizeFontStyle(style.fontStyle);
  const fontWeight = normalizeFontWeight(style.fontWeight);

  const font: SkiaFont = {
    familyName,
    size,
    fontStyle,
    fontWeight,
    measureText(text: string): SkiaMeasuredText {
      const content = typeof text === "string" ? text : String(text ?? "");
      const bridge = getSkiaBridge();
      if (bridge?.measureText && familyName.length > 0 && size > 0) {
        const measured = bridge.measureText(
          content,
          familyName,
          size,
          fontStyle,
          fontWeight,
        );
        if (Number.isFinite(measured)) {
          return { width: Math.max(0, measured) };
        }
      }
      const canvasWidth = resolveTextWidthWithCanvas(content, font);
      if (canvasWidth > 0) return { width: canvasWidth };
      return { width: content.length * size * 0.5 };
    },
  };

  return font;
}

async function ensureNativeFontLoaded(
  familyName: string,
  resourceName: string,
  source?: unknown,
): Promise<void> {
  try {
    if (skiaRegisteredFonts.has(familyName)) return;

    const loadSource = (source as any)?.resourceName ?? source ?? resourceName;
    const result = await Font.loadAsync(familyName, loadSource);

    const skia = getSkiaBridge();
    if (skia?.registerFont) {
      if (result.success && result.path) {
        const success = skia.registerFont(familyName, result.path);
        if (success) {
          skiaRegisteredFonts.add(familyName);
          return;
        }
      }

      // Fallback to fetch
      const fetchUrl =
        resolveAssetUrl(loadSource) || (typeof loadSource === "string" ? loadSource : null);

      if (fetchUrl) {
        try {
          if (typeof fetch === "undefined") {
            throw new Error("fetch is not defined in this environment");
          }
          const response = await fetch(fetchUrl);
          if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
          const buffer = await response.arrayBuffer();
          const success = skia.registerFont(familyName, buffer);
          if (success) {
            skiaRegisteredFonts.add(familyName);
          }
        } catch (e: any) {
          console.error(
            `[SkiaFont] registerFont with Skia bridge failed family=${familyName}:`,
            e?.message ?? e,
          );
        }
      }
    }
  } catch (e: any) {
    console.error(
      `[SkiaFont] ensureNativeFontLoaded failed family=${familyName}:`,
      e?.message ?? e,
    );
  }
}

export function matchFont(
  style: SkiaFontStyle,
  fontMgr?: SkiaFontManager,
): SkiaFont {
  const fallbackFamily = style.fontFamily ?? "";
  const matched = style.fontFamily
    ? fontMgr?.matchFamilyStyle(style.fontFamily, {
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
      })
    : null;

  return createFontFromStyle({
    fontFamily: matched?.familyName ?? fallbackFamily,
    fontSize: style.fontSize,
    fontStyle: matched?.fontStyle ?? style.fontStyle,
    fontWeight: matched?.fontWeight ?? style.fontWeight,
  });
}

export function listFontFamilies(fontMgr?: SkiaFontManager): string[] {
  if (fontMgr) return fontMgr.listFontFamilies();
  const bridge = getSkiaBridge();
  if (!bridge?.listFontFamilies) return [];
  const value = bridge.listFontFamilies();
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string")
    : [];
}

export function createSystemFontManager(): SkiaFontManager {
  return {
    listFontFamilies() {
      return listFontFamilies();
    },
    matchFamilyStyle(familyName, style) {
      const trimmedFamily = familyName.trim();
      if (trimmedFamily.length === 0) return null;
      return {
        familyName: trimmedFamily,
        fontStyle: normalizeFontStyle(style?.fontStyle),
        fontWeight: normalizeFontWeight(style?.fontWeight),
      };
    },
  };
}

export function createTypefaceFontProvider(): SkiaTypefaceFontProvider {
  const faces = new Map<string, SkiaTypeface>();
  return {
    registerTypeface(typeface, familyName) {
      const key = (familyName ?? typeface.familyName).trim();
      if (key.length === 0) return;
      faces.set(key, {
        familyName: key,
        fontStyle: normalizeFontStyle(typeface.fontStyle),
        fontWeight: normalizeFontWeight(typeface.fontWeight),
      });
    },
    asFontManager() {
      return {
        listFontFamilies() {
          return Array.from(faces.keys());
        },
        matchFamilyStyle(familyName, style) {
          const key = familyName.trim();
          if (key.length === 0) return null;
          const found = faces.get(key);
          if (!found) return null;
          return {
            familyName: found.familyName,
            fontStyle: normalizeFontStyle(style?.fontStyle ?? found.fontStyle),
            fontWeight: normalizeFontWeight(
              style?.fontWeight ?? found.fontWeight,
            ),
          };
        },
      };
    },
  };
}

/**
 * Creates a Skia font resource that handles loading and registration.
 * Idiomatic Solid utility that integrates with Suspense.
 */
export function createFont(
  source: unknown,
  fontSize: number,
): Resource<SkiaFont | null> {
  const [font] = createResource(async () => {
    const size = Number.isFinite(fontSize) ? Math.max(0, Number(fontSize)) : 0;
    const familyName = resolveFamilyName(source);
    const resourceName = resolveResourceName(source);

    if (size <= 0 || familyName.length === 0) {
      return null;
    }

    await ensureNativeFontLoaded(familyName, resourceName, source);
    return createFontFromStyle({ fontFamily: familyName, fontSize: size });
  });

  return font;
}

/**
 * Utility to load multiple fonts specifically for Skia.
 * It ensures fonts are registered both with the OS and the Skia engine.
 * Returns a Solid Resource compatible with Suspense.
 */
export function createFontLoader(
  map: Record<string, string | FontAssetDescriptor>,
): Resource<boolean> {
  const [resource] = createResource(async () => {
    const families = Object.keys(map);

    await Promise.all(
      families.map(async (family) => {
        const source = map[family];
        const familyName = family;
        const resourceName =
          typeof source === "string"
            ? source
            : `${(source as FontAssetDescriptor).name}.${(source as FontAssetDescriptor).ext}`;

        return ensureNativeFontLoaded(familyName, resourceName, source);
      }),
    );

    return true;
  });

  return resource;
}

/** @deprecated Use createFont instead */
export const useFont = createFont;

/** @deprecated Use createFontFromStyle instead */
export function createFontSync(style: SkiaFontStyle): SkiaFont {
  return createFontFromStyle(style);
}

export function normalizeWeightForNative(
  fontWeight: SkiaFontWeight | undefined,
): number {
  return normalizeFontWeight(fontWeight);
}
