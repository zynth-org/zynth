import type { Style } from "@rune/core";
import type { JSX } from "solid-js";
import type { ImageElementProps } from "./primitives/Image";

type RuneChildren = JSX.Element | JSX.Element[] | null | undefined;

interface ViewElementProps {
  style?: Style;
  children?: RuneChildren;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
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
    }
  }
}

export {};
