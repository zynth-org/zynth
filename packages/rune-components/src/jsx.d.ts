import type { Style } from "@rune/core";
import type { JSX } from "solid-js";
import type { ImageElementProps } from "./primitives/Image";
import type { TextInputProps } from "./primitives/TextInput";
import type { TextFieldProps } from "./primitives/TextField";
import type { ProgressIndicatorProps } from "./primitives/ProgressIndicator";
import type { SwitchProps } from "./primitives/Switch";
import type { StatusBarProps } from "./primitives/StatusBar";
import type { SliderProps } from "./primitives/Slider";

type RuneChildren = JSX.Element | JSX.Element[] | null | undefined;
type SolidButtonProps = JSX.HTMLAttributes<HTMLButtonElement>;

interface ViewElementProps {
  style?: Style;
  children?: RuneChildren;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;
  testID?: string;
  key?: string | number;
  onLayout?: (event: {
    nativeEvent: {
      layout: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
  }) => void;
}

interface GlassViewElementProps {
  style?: Style;
  children?: RuneChildren;
  glassEffect?: "regular" | "clear" | "none";
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface GlassContainerElementProps {
  style?: Style;
  children?: RuneChildren;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface TextElementProps {
  style?: Style;
  children?: RuneChildren;
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      view: ViewElementProps;
      text: TextElementProps;
      image: ImageElementProps;
      "text-input": TextInputProps & { [key: string]: any };
      "secure-text-input": TextInputProps & { [key: string]: any };
      "scroll-view": ViewElementProps & { [key: string]: any };
      pressable: ViewElementProps & { [key: string]: any };
      button: SolidButtonProps & { testID?: string };
      "glass-view": GlassViewElementProps & { [key: string]: any };
      "glass-container": GlassContainerElementProps & { [key: string]: any };
      "progress-indicator": ProgressIndicatorProps & { [key: string]: any };
      "switch-view": SwitchProps & { [key: string]: any };
      "slider-view": SliderProps & { [key: string]: any };
      "text-field": TextFieldProps & { [key: string]: any };
      "rune-alert": { [key: string]: any };
      "rune-status-bar": StatusBarProps & { [key: string]: any };
      "menu-view": ViewElementProps & { [key: string]: any };
      "menu-trigger-view": ViewElementProps & { [key: string]: any };
      "menu-item-view": ViewElementProps & {
        label?: string;
        destructive?: boolean;
        disabled?: boolean;
        [key: string]: any;
      };
      "rune-modal": ViewElementProps & { [key: string]: any };
    }
  }
}

export {};
