import type { Style } from "@zynth/core";
import type { JSX } from "solid-js";
import type { ImageElementProps } from "./primitives/Image";
import type { TextInputProps } from "./primitives/TextInput";
import type { TextFieldProps } from "./primitives/TextField";
import type { ProgressIndicatorProps } from "./primitives/ProgressIndicator";
import type { SwitchProps } from "./primitives/Switch";
import type { StatusBarProps } from "./primitives/StatusBar";
import type { SliderProps } from "./primitives/Slider";

type ZynthChildren = JSX.Element | JSX.Element[] | null | undefined;
type SolidButtonProps = JSX.HTMLAttributes<HTMLButtonElement>;

interface ViewElementProps {
  style?: Style;
  children?: ZynthChildren;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;
  testID?: string;
  key?: string | number;
  ref?: (node: any) => void;
  layout?: unknown;
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
  children?: ZynthChildren;
  glassEffect?: "regular" | "clear" | "none";
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface GlassContainerElementProps {
  style?: Style;
  children?: ZynthChildren;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

interface TextElementProps {
  style?: Style;
  children?: ZynthChildren;
  text?: string;
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
      "recycler-scroll-view": ViewElementProps & { [key: string]: any };
      pressable: ViewElementProps & { [key: string]: any };
      button: SolidButtonProps & { testID?: string };
      "glass-view": GlassViewElementProps & { [key: string]: any };
      "glass-container": GlassContainerElementProps & { [key: string]: any };
      "progress-indicator": ProgressIndicatorProps & { [key: string]: any };
      "switch-view": SwitchProps & { [key: string]: any };
      "slider-view": SliderProps & { [key: string]: any };
      "text-field": TextFieldProps & { [key: string]: any };
      "zynth-alert": { [key: string]: any };
      "zynth-status-bar": StatusBarProps & { [key: string]: any };
      "menu-view": ViewElementProps & { [key: string]: any };
      "menu-trigger-view": ViewElementProps & { [key: string]: any };
      svg: { [key: string]: any };
      path: { [key: string]: any };
      "menu-item-view": ViewElementProps & {
        label?: string;
        destructive?: boolean;
        disabled?: boolean;
        [key: string]: any;
      };
      "date-picker-view": { [key: string]: any };
      "date-picker-trigger-view": { [key: string]: any };
      "zynth-modal": ViewElementProps & { [key: string]: any };
    }
  }
}

export {};
