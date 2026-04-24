import { View, type ViewProps } from "@zynthjs/components";
import { type ParentComponent, splitProps } from "solid-js";
import { useUITheme } from "../hooks";
import { Text } from "./Text";
import type { StyleProp } from "@zynthjs/core";

export interface BadgeProps extends ViewProps {
  label: string;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "neutral";
  variant?: "solid" | "subtle" | "outline";
}

export const Badge: ParentComponent<BadgeProps> = (props) => {
  const [local, others] = splitProps(props, ["label", "tone", "variant", "style"]);
  const theme = useUITheme();

  const resolvedStyle = () => {
    const t = theme();
    const tone = local.tone ?? "neutral";
    const variant = local.variant ?? "subtle";
    
    let base: StyleProp = {
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
        // Fallback for success muted if not in theme (using surfaceAlt + text color logic ideally, but for now specific)
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

    if (local.style) {
      return { ...base, ...(local.style as object) };
    }
    return base;
  };

  const textColor = () => {
    const t = theme();
    const tone = local.tone ?? "neutral";
    const variant = local.variant ?? "subtle";

    if (variant === "solid") return "#ffffff"; // Or contrasting text

    switch (tone) {
      case "primary": return t.colors.accent;
      case "success": return t.colors.success;
      case "warning": return t.colors.warning;
      case "danger": return t.colors.danger;
      case "info": return t.colors.info;
      case "neutral": default: return t.colors.textSubtle;
    }
  };

  return (
    <View style={resolvedStyle()} {...others}>
      <Text 
        style={{ 
          fontSize: theme().typography.fontSizes.xs,
          fontWeight: theme().typography.fontWeights.medium,
          color: textColor()
        }}
      >
        {local.label}
      </Text>
    </View>
  );
};
