import type { Style } from "@rune/core";
import type { JSX } from "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "rune-screen-container": {
        style?: Style;
        children?: JSX.Element;
      };
      "rune-screen": {
        screenKey?: string;
        active?: boolean;
        animation?: string;
        gestureEnabled?: boolean;
        headerOptions?: Record<string, any>;
        onNativeBack?: () => void;
        onWillAppear?: () => void;
        onDidAppear?: () => void;
        onWillDisappear?: () => void;
        onDidDisappear?: () => void;
        style?: Style;
        children?: JSX.Element;
      };
      "rune-screen-tabs-container": {
        selectedIndex?: number;
        tabAnimation?: string;
        style?: Style;
        children?: JSX.Element;
      };
    }
  }
}
