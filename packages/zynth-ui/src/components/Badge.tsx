import { View, type ViewProps } from "@zynthjs/components";
import { createMemo, omit, type ParentComponent } from "solid-js";
import { useUITheme } from "../hooks";
import { Text } from "./Text";
import type { StyleProp } from "@zynthjs/core";

export interface BadgeProps extends ViewProps {
  label: string;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  variant?: "solid" | "subtle" | "outline";
}

export const Badge: ParentComponent<BadgeProps> = (props) => {
  const rest = omit(props, "label", "tone", "variant", "style");
  const theme = useUITheme();

  const resolvedStyle = createMemo<StyleProp>(() => {
    const t = theme();
    const tone = props.tone ?? "neutral";
    const variant = props.variant ?? "subtle";

    const base: Record<string, unknown> = {
      paddingHorizontal: t.spacing.sm,
      paddingVertical: t.spacing.xs,
      borderRadius: t.radii.full,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    };

    let bgColor = t.colors.surfaceAlt;
    let borderColor = "transparent";

    switch (tone) {
      case "primary":
        bgColor = variant === "solid" ? t.colors.accent : t.colors.accentMuted;
        borderColor = t.colors.accent;
        break;
      case "success":
        bgColor = variant === "solid" ? t.colors.success : (t.colors.success + "20");
        borderColor = t.colors.success;
        break;
      case "warning":
        bgColor = variant === "solid" ? t.colors.warning : (t.colors.warning + "20");
        borderColor = t.colors.warning;
        break;
      case "danger":
        bgColor = variant === "solid" ? t.colors.danger : (t.colors.danger + "20");
        borderColor = t.colors.danger;
        break;
      case "info":
        bgColor = variant === "solid" ? t.colors.info : (t.colors.info + "20");
        borderColor = t.colors.info;
        break;
      case "neutral":
      default:
        bgColor = variant === "solid" ? t.colors.textSubtle : t.colors.surfaceAlt;
        borderColor = t.colors.border;
        break;
    }

    if (variant === "solid") {
      base.backgroundColor = bgColor;
    } else if (variant === "subtle") {
      base.backgroundColor = bgColor;
    } else if (variant === "outline") {
      base.backgroundColor = "transparent";
      base.borderWidth = 1;
      base.borderColor = borderColor;
    }

    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    if (userStyle) {
      return { ...base, ...(userStyle as object) };
    }
    return base as StyleProp;
  });

  const textColor = createMemo(() => {
    const t = theme();
    const tone = props.tone ?? "neutral";
    const variant = props.variant ?? "subtle";

    if (variant === "solid") return "#ffffff";

    switch (tone) {
      case "primary": return t.colors.accent;
      case "success": return t.colors.success;
      case "warning": return t.colors.warning;
      case "danger": return t.colors.danger;
      case "info": return t.colors.info;
      case "neutral": default: return t.colors.textSubtle;
    }
  });

  const textStyle = createMemo(() => ({
    fontSize: theme().typography.fontSizes.xs,
    fontWeight: theme().typography.fontWeights.medium,
    color: textColor(),
  }));

  return (
    <View style={resolvedStyle()} {...rest}>
      <Text style={textStyle()}>
        {props.label}
      </Text>
    </View>
  );
};
