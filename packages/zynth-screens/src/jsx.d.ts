import type { HostNode, Style } from "@zynthjs/core";
import type { Element as SolidElement } from "solid-js";
import type {
  ScreenAnimationType,
  ScreenHeaderOptions,
  ScreenTabBarOptions,
  ScreenTabBarItemDescriptor,
} from "./types";

type ZynthChildren = SolidElement | SolidElement[] | null | undefined;
type ZynthRef = (node: HostNode | null) => void;

declare module "solid-js/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "zynth-screen-container": {
        ref?: ZynthRef;
        style?: Style;
        children?: ZynthChildren;
      };
      "zynth-screen-sheet-container": {
        ref?: ZynthRef;
        style?: Style;
        children?: ZynthChildren;
      };
      "zynth-screen": {
        ref?: ZynthRef;
        screenKey?: string;
        active?: boolean;
        covered?: boolean;
        animation?: ScreenAnimationType;
        gestureEnabled?: boolean;
        headerOptions?: ScreenHeaderOptions;
        onNativeBack?: () => void;
        onNativeHeaderRightPress?: () => void;
        onWillAppear?: () => void;
        onDidAppear?: () => void;
        onWillDisappear?: () => void;
        onDidDisappear?: () => void;
        style?: Style;
        children?: ZynthChildren;
      };
      "zynth-screen-tabs-container": {
        ref?: ZynthRef;
        selectedIndex?: number;
        tabAnimation?: ScreenAnimationType;
        style?: Style;
        tabBarOptions?: ScreenTabBarOptions;
        tabBarItems?: ScreenTabBarItemDescriptor[];
        nativeTabBarEnabled?: boolean;
        onNativeTabSelect?: (index: number) => void;
        onNativeTabMount?: (event: {
          surfaceId: number;
          routeKey: string;
          active: boolean;
        }) => void;
        onNativeTabUpdate?: (event: {
          surfaceId: number;
          routeKey: string;
          active?: boolean;
        }) => void;
        children?: ZynthChildren;
      };
    }
  }
}

export {};
