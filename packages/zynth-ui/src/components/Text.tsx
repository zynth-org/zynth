import { Text as NativeText, type TextProps as NativeTextProps } from "@zynthjs/components";
import { createMemo, omit, type ParentComponent } from "solid-js";
import { useUITheme } from "../hooks";
import type { Style, StyleProp } from "@zynthjs/core";

export interface TextProps extends NativeTextProps {
  variant?: "heading" | "subheading" | "body" | "caption" | "label";
  color?: "default" | "muted" | "subtle" | "accent" | "surface" | "success" | "warning" | "danger" | "info";
  weight?: "regular" | "medium" | "semibold" | "bold";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
}

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

export const Text: ParentComponent<TextProps> = (props) => {
  const rest = omit(props, "style", "variant", "color", "weight", "size");
  const theme = useUITheme();

  const resolvedStyle = createMemo<StyleProp>(() => {
    const t = theme();
    const overrideStyle =
      typeof props.style === "function" ? props.style() : props.style;

    // Default style base
    let base: StyleProp = {
      fontFamily: t.typography.fontFamily,
      fontSize: t.typography.fontSizes.md,
      color: t.colors.text,
      lineHeight: t.typography.lineHeights.md,
    };

    // Apply size overrides
    if (props.size) {
      base.fontSize = t.typography.fontSizes[props.size];
      base.lineHeight = t.typography.lineHeights[props.size];
    }

    // Apply weight overrides
    if (props.weight) {
      base.fontWeight = t.typography.fontWeights[props.weight];
    }

    // Apply variant presets
    switch (props.variant) {
      case "heading":
        base.fontWeight = t.typography.fontWeights.bold;
        base.fontSize = props.size ? base.fontSize : t.typography.fontSizes.xl;
        base.lineHeight = props.size ? base.lineHeight : t.typography.lineHeights.xl;
        break;
      case "subheading":
        base.fontWeight = t.typography.fontWeights.semibold;
        base.fontSize = props.size ? base.fontSize : t.typography.fontSizes.lg;
        base.lineHeight = props.size ? base.lineHeight : t.typography.lineHeights.lg;
        break;
      case "caption":
        base.fontSize = props.size ? base.fontSize : t.typography.fontSizes.xs;
        base.lineHeight = props.size ? base.lineHeight : t.typography.lineHeights.xs;
        base.color = props.color ? base.color : t.colors.textSubtle;
        break;
      case "label":
        base.fontWeight = t.typography.fontWeights.medium;
        base.fontSize = props.size ? base.fontSize : t.typography.fontSizes.sm;
        break;
    }

    // Apply color overrides
    if (props.color) {
      switch (props.color) {
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
  });

  return (
    <NativeText style={resolvedStyle()} {...rest}>
      {props.children}
    </NativeText>
  );
};
