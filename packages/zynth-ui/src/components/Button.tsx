import { Button as NativeButton, type ButtonProps as NativeButtonProps } from "@zynthjs/components";
import { createMemo, omit, type ParentComponent } from "solid-js";
import { useUITheme } from "../hooks";

export interface ButtonProps extends NativeButtonProps {
  // We can extend with specific semantic overrides if needed,
  // but NativeButton already accepts 'tone' and 'variant'.
  // We mainly want to inject the theme's specific hex codes into 'baseColor'
  // if the user wants to strictly follow the theme palette for custom tones
  // or just rely on the native mapping which we might want to override here.
}

export const Button: ParentComponent<ButtonProps> = (props) => {
  const rest = omit(props, "baseColor", "tone", "style");
  const theme = useUITheme();

  const resolvedBaseColor = createMemo(() => {
    if (props.baseColor) return props.baseColor;

    const t = theme();
    switch (props.tone) {
      case "primary": return t.colors.accent;
      case "success": return t.colors.success;
      case "warning": return t.colors.warning;
      case "danger": return t.colors.danger;
      case "neutral": return t.colors.textSubtle;
      default: return undefined;
    }
  });

  return (
    <NativeButton
      tone={props.tone}
      baseColor={resolvedBaseColor()}
      style={props.style}
      {...rest}
    />
  );
};
