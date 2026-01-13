import type { Style } from "@rune/core";
import type { JSX } from "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "rune-screen-container": {
        style?: Style;
        children?: JSX.Element;
      };
      "rune-screen-sheet-container": {
        style?: Style;
        children?: JSX.Element;
      };
      "rune-screen": {
        screenKey?: string;
        active?: boolean;
        covered?: boolean;
        animation?: string;
        gestureEnabled?: boolean;
        headerOptions?: Record<string, any>;
        onNativeBack?: () => void;
        onNativeHeaderRightPress?: () => void;
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
        tabBarOptions?: Record<string, any>;
        tabBarItems?: Array<Record<string, any>>;
        nativeTabBarEnabled?: boolean;
        onNativeTabSelect?: (index: number) => void;
        onNativeTabMount?: (event: any) => void;
        onNativeTabUpdate?: (event: any) => void;
        children?: JSX.Element;
      };
    }
  }
}
