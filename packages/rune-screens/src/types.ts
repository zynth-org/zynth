import type { JSX } from "solid-js";
import type { Style } from "@rune/core";

/**
 * Animation types for screen transitions
 */
export type ScreenAnimationType = "push" | "modal" | "sheet-blur" | "zoom" | "fade" | "none";

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

  /** Whether this screen is covered by another screen (e.g. a modal) */
  covered?: boolean;

  /** Animation type for enter/exit transitions */
  animation?: ScreenAnimationType;

  /** Whether back gesture is enabled */
  gestureEnabled?: boolean;

  /** Native header configuration (used primarily on iOS) */
  headerOptions?: ScreenHeaderOptions;

  /** Called when the native navigation controller requests a back action */
  onNativeBack?: () => void;
  /** Called when a native header right button is tapped */
  onNativeHeaderRightPress?: () => void;

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
 * Header configuration passed down to the native primitives.
 * Primarily used for iOS UINavigationController integration.
 */
export interface ScreenHeaderOptions {
  title?: string;
  subtitle?: string;
  prefersLargeTitle?: boolean;
  /** Native header style (iOS only) */
  headerStyle?: ScreenHeaderStyle;
  visible?: boolean;
  backVisible?: boolean;
  tintColor?: string;
  titleColor?: string;
  backgroundColor?: string;
  transparent?: boolean;
  shadowVisible?: boolean;
  blurEffect?: ScreenHeaderBlurEffect;
  userInterfaceStyle?: ScreenUserInterfaceStyle;
  rightButton?: ScreenHeaderButtonOptions;
  rightAccessory?: ScreenHeaderAccessoryDescriptor;
}

export type ScreenHeaderStyle = "default" | "liquidGlass";
export type ScreenHeaderBlurEffect =
  | "systemUltraThin"
  | "systemThin"
  | "systemChromatic";
export type ScreenUserInterfaceStyle = "dark" | "light" | "system";

export interface ScreenHeaderButtonOptions {
  title?: string;
  style?: "plain" | "done" | "icon" | "prominent";
  systemItem?: "close";
}

export interface ScreenHeaderAccessoryDescriptor {
  type: "surface";
  routeKey: string;
  position: "right";
}

/**
 * Props for ScreenTabsContainer component
 */
export interface ScreenTabBarIconDescriptor {
  /** Icon defined by native sources (SF Symbols, assets, etc.) */
  type: "descriptor";
  systemName?: string;
  assetName?: string;
  uri?: string;
  glyph?: string;
  glyphFontFamily?: string;
  glyphFontSize?: number;
}

export interface ScreenTabBarIconSurfaceDescriptor {
  /** Icon rendered through a Solid surface */
  type: "surface";
  routeKey: string;
}

export type ScreenTabBarIcon =
  | ScreenTabBarIconDescriptor
  | ScreenTabBarIconSurfaceDescriptor;

export interface ScreenTabBarItemDescriptor {
  key: string;
  routeName: string;
  label?: string;
  badge?: string | number;
  badgeColor?: string;
  hidden?: boolean;
  icon?: ScreenTabBarIcon;
}

export interface ScreenTabBarOptions {
  visible?: boolean;
  backgroundColor?: string;
  activeTintColor?: string;
  inactiveTintColor?: string;
  showLabels?: boolean;
  blurEffectStyle?:
    | "systemUltraThinMaterial"
    | "systemThinMaterial"
    | "systemChromeMaterial"
    | "systemMaterial"
    | "none";
}

export interface ScreenTabsContainerProps {
  /** Index of the currently selected tab */
  selectedIndex: number;

  /** Animation type for tab switching */
  tabAnimation?: ScreenAnimationType;

  /** Native tab bar configuration */
  tabBarOptions?: ScreenTabBarOptions;

  /** Native tab items metadata */
  tabBarItems?: ScreenTabBarItemDescriptor[];

  /** Whether to enable the native tab bar */
  nativeTabBarEnabled?: boolean;

  /** Notified when a native tab selection occurs */
  onNativeTabSelect?: (index: number) => void;

  /** Notified when a native tab icon surface is mounted (Android) */
  onNativeTabMount?: (event: {
    surfaceId: number;
    routeKey: string;
    active: boolean;
  }) => void;

  /** Notified when a native tab icon needs update (Android) */
  onNativeTabUpdate?: (event: {
    surfaceId: number;
    routeKey: string;
    active?: boolean;
  }) => void;

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
