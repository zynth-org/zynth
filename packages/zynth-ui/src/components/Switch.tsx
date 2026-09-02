import { Switch as NativeSwitch, View, Text } from "@zynthjs/components";
import { createMemo, type Component } from "solid-js";
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
  const theme = useUITheme();

  const resolvedTrackColor = createMemo(() => {
    const t = theme();
    return (
      props.trackColor ?? {
        false: t.colors.border,
        true: t.colors.accent,
      }
    );
  });

  const resolvedThumbColor = createMemo(() => {
    const t = theme();
    return (
      props.thumbColor ?? {
        false: t.colors.textSubtle,
        true: t.colors.surface,
      }
    );
  });

  const containerStyle = createMemo(() => {
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    return {
      gap: theme().spacing.xs,
      ...((userStyle as object) ?? {}),
    };
  });

  return (
    <View style={containerStyle()}>
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
        {props.label ? (
          <Text
            style={{
              flex: 1,
              color: props.disabled
                ? theme().colors.textSubtle
                : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
              marginRight: theme().spacing.sm,
            }}
            numberOfLines={1}
          >
            {props.label}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <NativeSwitch
          value={props.value}
          onValueChange={props.onValueChange}
          disabled={props.disabled}
          trackColor={resolvedTrackColor()}
          thumbColor={resolvedThumbColor()}
          testID={props.testID}
        />
      </View>
      {props.helperText ? (
        <Text
          style={{
            color: theme().colors.textMuted,
            fontSize: theme().typography.fontSizes.sm,
            marginLeft: theme().spacing.xs,
          }}
        >
          {props.helperText}
        </Text>
      ) : null}
    </View>
  );
};
