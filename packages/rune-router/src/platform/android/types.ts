import type { Component, JSX } from "solid-js";

export interface TabIconDescriptor {
  systemName?: string;
  assetName?: string;
  uri?: string;
  runeId?: string;
}

export interface TabIconRenderProps {
  active: boolean;
}

export type TabIconFactory = (props: TabIconRenderProps) => JSX.Element;

export type TabIconInput = TabIconDescriptor | TabIconFactory;

export interface TabOptions {
  label?: string;
  icon?: TabIconInput;
  badge?: string | number;
  badgeColor?: string;
  activeTintColor?: string;
  inactiveTintColor?: string;
  tabBarVisible?: boolean;
  tabBarBackgroundColor?: string;
  tabBarIndicatorColor?: string;
  customTab?: JSX.Element;
}

export interface NativeTabOptions
  extends Omit<TabOptions, "icon" | "customTab"> {
  icon?: TabIconDescriptor;
}

export interface TabBarOptions {
  backgroundColor?: string;
}

export type BottomSheetSnapPoint = number | `${number}%`;

export interface BottomSheetNavigatorOptions {
  snapPoints?: BottomSheetSnapPoint[];
  initialSnapIndex?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  enableDynamicSizing?: boolean;
}

export interface BottomSheetScreenOptions
  extends BottomSheetNavigatorOptions {
  enablePanningGesture?: boolean;
  preferredDetent?: number;
}

export type ScreenPresentation = "push" | "modal";

export interface ScreenOptions {
  title?: string;
  subtitle?: string;
  largeTitle?: boolean;
  headerShown?: boolean;
  headerTintColor?: string;
  headerBackgroundColor?: string;
  headerTransparent?: boolean;
  headerShadowVisible?: boolean;
  presentation?: ScreenPresentation;
  tab?: TabOptions;
  bottomSheet?: BottomSheetScreenOptions;
  /**
   * Background color applied to the wrapper around the screen component.
   * Defaults to white if not provided.
   */
  backgroundColor?: string;
}

type RouteName<Routes extends Record<string, any>> = Extract<
  keyof Routes,
  string
>;

type RouteParams<
  Routes extends Record<string, any>,
  Name extends RouteName<Routes>
> = undefined extends Routes[Name] ? Routes[Name] : Routes[Name] | undefined;

export interface RouteDescriptor<Params = any> {
  key: string;
  name: string;
  params?: Params;
}

export interface NavigationHelpers<
  Routes extends Record<string, any> = Record<string, any>
> {
  navigate<Name extends RouteName<Routes>>(
    name: Name,
    params?: RouteParams<Routes, Name>
  ): void;
  push<Name extends RouteName<Routes>>(
    name: Name,
    params?: RouteParams<Routes, Name>
  ): void;
  goBack(): void;
  setOptions(options: ScreenOptions): void;
}

export interface RouterScreenComponentProps<Params = any> {
  route: RouteDescriptor<Params>;
  navigation: NavigationHelpers;
}

export type ScreenComponent<Params = any> = Component<
  RouterScreenComponentProps<Params>
>;

export type ScreenSurface = "stack" | "bottomSheet";

export interface ScreenRegistration {
  name: string;
  component: ScreenComponent<any>;
  options?: ScreenOptions;
  surface?: ScreenSurface;
}
