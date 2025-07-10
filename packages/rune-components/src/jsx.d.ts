import type { Style } from "@rune/core";
import type { JSX } from "solid-js";
import type { ImageElementProps } from "./primitives/Image";
import type { TextInputProps } from "./primitives/TextInput";
import type { ProgressIndicatorProps } from "./primitives/ProgressIndicator";
import type { SwitchProps } from "./primitives/Switch";

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
      "progress-indicator": ProgressIndicatorProps & { [key: string]: any };
      "switch-view": SwitchProps & { [key: string]: any };
    }
  }
}

export {};
