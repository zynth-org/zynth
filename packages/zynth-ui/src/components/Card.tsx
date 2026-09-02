import { View, type ViewProps } from "@zynthjs/components";
import { createMemo, omit, type ParentComponent } from "solid-js";
import { useUITheme } from "../hooks";
import type { StyleProp } from "@zynthjs/core";

export interface CardProps extends ViewProps {
  variant?: "elevated" | "outlined" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
}

export const Card: ParentComponent<CardProps> = (props) => {
  const rest = omit(props, "style", "variant", "padding");
  const theme = useUITheme();

  const resolvedStyle = createMemo<StyleProp>(() => {
    const t = theme();

    const base: Record<string, unknown> = {
      backgroundColor: t.colors.card,
      borderRadius: t.radii.lg,
    };

    // Padding
    switch (props.padding ?? "md") {
      case "sm": base.padding = t.spacing.sm; break;
      case "md": base.padding = t.spacing.md; break;
      case "lg": base.padding = t.spacing.lg; break;
      case "none": base.padding = 0; break;
    }

    // Variant
    const variant = props.variant ?? "elevated";
    if (variant === "elevated") {
      base.shadowColor = t.colors.shadow;
      // iOS
      base.shadowOpacity = 0.1;
      base.shadowRadius = 4;
      base.shadowOffset = { width: 0, height: 2 };
      // Android
      base.elevation = 2;
    } else if (variant === "outlined") {
      base.borderWidth = 1;
      base.borderColor = t.colors.border;
    } else { // flat
      base.backgroundColor = t.colors.surfaceAlt;
    }

    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    if (userStyle) {
      return { ...base, ...(userStyle as object) };
    }
    return base as StyleProp;
  });

  return <View style={resolvedStyle()} {...rest} />;
};
