import type { Style } from "@zynth/core";
import type { JSX } from "solid-js";
import type { HostNode } from "@zynth/core";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-keyboard-avoiding-view": {
        style?: Style;
        behavior?: "padding" | "position" | "height";
        keyboardVerticalOffset?: number;
        enabled?: boolean;
        testID?: string;
        ["data-testid"]?: string;
        ref?: (node: HostNode | null) => void;
        children?: JSX.Element;
        [key: string]: any;
      };
      "zynth-keyboard-sticky-view": {
        style?: Style;
        offset?: number;
        testID?: string;
        ["data-testid"]?: string;
        ref?: (node: HostNode | null) => void;
        children?: JSX.Element;
        [key: string]: any;
      };
      "zynth-keyboard-aware-scroll-view": {
        style?: Style;
        scrollEnabled?: boolean;
        showsVerticalScrollIndicator?: boolean;
        showsHorizontalScrollIndicator?: boolean;
        bounces?: boolean;
        contentInset?: {
          top?: number;
          left?: number;
          bottom?: number;
          right?: number;
        };
        extraScrollHeight?: number;
        keyboardVerticalOffset?: number;
        enabled?: boolean;
        scrollToInputOnFocus?: boolean;
        testID?: string;
        ["data-testid"]?: string;
        ref?: (node: HostNode | null) => void;
        children?: JSX.Element;
        [key: string]: any;
      };
    }
  }
}

export {};
