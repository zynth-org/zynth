import { Text as NativeText, type TextProps as NativeTextProps } from "@zynth/components";
import { type ParentComponent, splitProps } from "solid-js";
import { useUITheme } from "../hooks";
import type { Style, StyleProp } from "@zynth/core";

export interface TextProps extends NativeTextProps {
  variant?: "heading" | "subheading" | "body" | "caption" | "label";
  color?: "default" | "muted" | "subtle" | "accent" | "surface" | "success" | "warning" | "danger" | "info";
  weight?: "regular" | "medium" | "semibold" | "bold";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
}

export const Text: ParentComponent<TextProps> = (props) => {
  const [local, others] = splitProps(props, ["style", "variant", "color", "weight", "size"]);
  const theme = useUITheme();

  const mergeDefinedStyle = (
    base: StyleProp,
    override: StyleProp | null | undefined,
  ): StyleProp => {
    if (!override) return base;
    if (Array.isArray(override)) {
      return override.reduce<StyleProp>((acc, item) => mergeDefinedStyle(acc, item), base);
    }
    const next: Style = { ...(base as Style) };
    for (const [key, value] of Object.entries(override as object)) {
      if (value !== undefined) {
        (next as Record<string, unknown>)[key] = value;
      }
    }
    return next;
  };

  const resolvedStyle = () => {
    const t = theme();
    const overrideStyle =
      typeof local.style === "function" ? local.style() : local.style;
    
    // Default style base
    let base: StyleProp = {
      fontFamily: t.typography.fontFamily,
      fontSize: t.typography.fontSizes.md,
      color: t.colors.text,
      lineHeight: t.typography.lineHeights.md,
    };

    // Apply size overrides
    if (local.size) {
      base.fontSize = t.typography.fontSizes[local.size];
      base.lineHeight = t.typography.lineHeights[local.size];
    }

    // Apply weight overrides
    if (local.weight) {
      base.fontWeight = t.typography.fontWeights[local.weight];
    }

    // Apply variant presets
    switch (local.variant) {
      case "heading":
        base.fontWeight = t.typography.fontWeights.bold;
        base.fontSize = local.size ? base.fontSize : t.typography.fontSizes.xl;
        base.lineHeight = local.size ? base.lineHeight : t.typography.lineHeights.xl;
        break;
      case "subheading":
        base.fontWeight = t.typography.fontWeights.semibold;
        base.fontSize = local.size ? base.fontSize : t.typography.fontSizes.lg;
        base.lineHeight = local.size ? base.lineHeight : t.typography.lineHeights.lg;
        break;
      case "caption":
        base.fontSize = local.size ? base.fontSize : t.typography.fontSizes.xs;
        base.lineHeight = local.size ? base.lineHeight : t.typography.lineHeights.xs;
        base.color = local.color ? base.color : t.colors.textSubtle;
        break;
      case "label":
        base.fontWeight = t.typography.fontWeights.medium;
        base.fontSize = local.size ? base.fontSize : t.typography.fontSizes.sm;
        break;
    }

    // Apply color overrides
    if (local.color) {
      switch (local.color) {
        case "muted": base.color = t.colors.textMuted; break;
        case "subtle": base.color = t.colors.textSubtle; break;
        case "accent": base.color = t.colors.accent; break;
        case "surface": base.color = t.colors.surface; break;
        case "success": base.color = t.colors.success; break;
        case "warning": base.color = t.colors.warning; break;
        case "danger": base.color = t.colors.danger; break;
        case "info": base.color = t.colors.info; break;
        default: break; // 'default' keeps t.colors.text
      }
    }

    // Merge with user provided style
    return mergeDefinedStyle(base, overrideStyle);
  };

  return <NativeText style={resolvedStyle()} {...others} />;
};
