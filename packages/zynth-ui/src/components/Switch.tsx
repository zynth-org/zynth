import { Switch as NativeSwitch, View, Text } from "@zynthjs/components";
import { splitProps, type Component } from "solid-js";
import { useUITheme } from "../hooks";
import type { Style } from "@zynthjs/core";

export interface SwitchProps {
  label?: string;
  helperText?: string;
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  /** Track tint. Pass a string for the on state, or per-state colors. */
  trackColor?: string | { false?: string; true?: string };
  /** Thumb tint. Pass a string for both states, or per-state colors. */
  thumbColor?: string | { false?: string; true?: string };
  style?: Style;
  testID?: string;
}

export const Switch: Component<SwitchProps> = (props) => {
  const [local] = splitProps(props, [
    "label",
    "helperText",
    "style",
    "value",
    "onValueChange",
    "disabled",
    "trackColor",
    "thumbColor",
    "testID",
  ]);
  const theme = useUITheme();
  const resolvedTrackColor = () => {
    const t = theme();
    return (
      local.trackColor ?? {
        false: t.colors.border,
        true: t.colors.accent,
      }
    );
  };
  const resolvedThumbColor = () => {
    const t = theme();
    return (
      local.thumbColor ?? {
        false: t.colors.textSubtle,
        true: t.colors.surface,
      }
    );
  };

  return (
    <View style={{ gap: theme().spacing.xs, ...(local.style as object) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme().spacing.md,
          paddingVertical: theme().spacing.sm,
          borderRadius: theme().radii.md,
          backgroundColor: theme().colors.surface,
        }}
      >
        {local.label ? (
          <Text
            style={{
              flex: 1,
              color: local.disabled
                ? theme().colors.textSubtle
                : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
              marginRight: theme().spacing.sm,
            }}
            numberOfLines={1}
          >
            {local.label}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <NativeSwitch
          value={local.value}
          onValueChange={local.onValueChange}
          disabled={local.disabled}
          trackColor={resolvedTrackColor()}
          thumbColor={resolvedThumbColor()}
          testID={local.testID}
        />
      </View>
      {local.helperText ? (
        <Text
          style={{
            color: theme().colors.textMuted,
            fontSize: theme().typography.fontSizes.sm,
            marginLeft: theme().spacing.xs,
          }}
        >
          {local.helperText}
        </Text>
      ) : null}
    </View>
  );
};
