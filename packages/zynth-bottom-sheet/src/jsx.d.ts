import type { Style } from "@zynth/core";
import type { JSX } from "solid-js";
import type { HostNode } from "@zynth/core";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-bottom-sheet": {
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
