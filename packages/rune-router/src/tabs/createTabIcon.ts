import type { JSX } from "solid-js";
import type { TabIconDescriptor } from "../core/types";

export interface TabGlyphIconOptions {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: TabIconDescriptor["glyphFontWeight"];
  baselineOffset?: number;
  activeColor?: string;
  inactiveColor?: string;
}

export function createTabIcon(
  component: (props: { active: boolean }) => JSX.Element
): (props: { active: boolean }) => JSX.Element {
  return component;
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
