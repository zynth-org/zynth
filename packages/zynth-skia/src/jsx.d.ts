import type { Style } from "@zynthjs/core";
import type { JSX } from "solid-js";
import type { SkiaDrawCommand } from "./types";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-skia-view": {
        style?: Style;
        clearColor?: string;
        frameLoop?: boolean;
        allowFallback?: boolean;
        commands?: SkiaDrawCommand[];
        ref?: (node: any) => void;
        onNativeReady?: (event: { nativeEvent: { available: boolean } }) => void;
        onLayout?: (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void;
        children?: JSX.Element;
      };
    }
  }
}
