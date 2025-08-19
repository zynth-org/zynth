import type { JSX } from "solid-js";
import type { Style } from "@rune/core";

/**
 * Animation types for screen transitions
 */
export type ScreenAnimationType = "push" | "modal" | "zoom" | "fade" | "none";

/**
 * Props for ScreenContainer component
 */
export interface ScreenContainerProps {
  style?: Style;
  children?: JSX.Element;
}

/**
 * Props for Screen component
 */
export interface ScreenProps {
  /** Unique key for this screen */
  screenKey: string;

  /** Whether this screen is active (visible in the stack) */
  active: boolean;

  /** Animation type for enter/exit transitions */
  animation?: ScreenAnimationType;

  /** Whether back gesture is enabled */
  gestureEnabled?: boolean;

  /** Called when screen is about to appear */
  onWillAppear?: () => void;

  /** Called when screen has finished appearing */
  onDidAppear?: () => void;

  /** Called when screen is about to disappear */
  onWillDisappear?: () => void;

  /** Called when screen has finished disappearing */
  onDidDisappear?: () => void;

  style?: Style;
  children?: JSX.Element;
}

/**
 * Props for ScreenTabsContainer component
 */
export interface ScreenTabsContainerProps {
  /** Index of the currently selected tab */
  selectedIndex: number;

  /** Animation type for tab switching */
  tabAnimation?: ScreenAnimationType;

  style?: Style;
  children?: JSX.Element;
}

/**
 * Route definition for memory router
 */
export interface RouteDefinition<Params = Record<string, any>> {
  name: string;
  params?: Params;
}

/**
 * Navigation state for memory router
 */
export interface NavigationState<ParamList = Record<string, any>> {
  routes: RouteDefinition<ParamList[keyof ParamList]>[];
  index: number;
}
