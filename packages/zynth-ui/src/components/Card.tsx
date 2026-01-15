import { View, type ViewProps } from "@zynth/components";
import { type ParentComponent, splitProps } from "solid-js";
import { useUITheme } from "../hooks";
import type { StyleProp } from "@zynth/core";

export interface CardProps extends ViewProps {
  variant?: "elevated" | "outlined" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
}

export const Card: ParentComponent<CardProps> = (props) => {
  const [local, others] = splitProps(props, ["style", "variant", "padding"]);
  const theme = useUITheme();

  const resolvedStyle = () => {
    const t = theme();
    
    let base: StyleProp = {
      backgroundColor: t.colors.card,
      borderRadius: t.radii.lg,
    };

    // Padding
    switch (local.padding ?? "md") {
      case "sm": base.padding = t.spacing.sm; break;
      case "md": base.padding = t.spacing.md; break;
      case "lg": base.padding = t.spacing.lg; break;
      case "none": base.padding = 0; break;
    }

    // Variant
    const variant = local.variant ?? "elevated";
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

    if (local.style) {
      return { ...base, ...(local.style as object) };
    }
    return base;
  };

  return <View style={resolvedStyle()} {...others} />;
};
