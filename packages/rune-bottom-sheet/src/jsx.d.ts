import type { Style } from "@rune/core";
import type { JSX } from "solid-js";
import type { HostNode } from "@rune/core";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "rune-bottom-sheet": {
        style?: Style;
        testID?: string;
        ["data-testid"]?: string;
        ref?: (node: HostNode | null) => void;
        [key: string]: any;
      };
      view: {
        style?: Style;
        [key: string]: any;
      };
    }
  }
}

export {};
