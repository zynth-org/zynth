import type { TabIconDescriptor } from "../core/types";

export interface TabGlyphIconOptions {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: TabIconDescriptor["glyphFontWeight"];
  baselineOffset?: number;
  activeColor?: string;
  inactiveColor?: string;
}

export function createTabGlyphIcon(
  glyph: string,
  options?: TabGlyphIconOptions
): TabIconDescriptor {
  return {
    glyph,
    glyphFontSize: options?.fontSize,
    glyphFontFamily: options?.fontFamily,
    glyphFontWeight: options?.fontWeight,
    glyphBaselineOffset: options?.baselineOffset,
    glyphActiveColor: options?.activeColor,
    glyphInactiveColor: options?.inactiveColor,
  };
}
