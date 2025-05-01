import type { Component, JSX } from "solid-js";

export interface TabIconDescriptor {
  systemName?: string;
  assetName?: string;
  uri?: string;
}

export interface TabOptions {
  label?: string;
  icon?: TabIconDescriptor;
  badge?: string | number;
  badgeColor?: string;
  activeTintColor?: string;
  inactiveTintColor?: string;
  tabBarVisible?: boolean;
  tabBarBackgroundColor?: string;
  tabBarIndicatorColor?: string;
  customTab?: JSX.Element;
}

export interface TabBarOptions {
  backgroundColor?: string;
}

export interface ScreenOptions {
  title?: string;
  subtitle?: string;
  largeTitle?: boolean;
  headerShown?: boolean;
  headerTintColor?: string;
  headerBackgroundColor?: string;
  headerTransparent?: boolean;
  headerShadowVisible?: boolean;
  tab?: TabOptions;
}

export interface RouteDescriptor<Params = any> {
  key: string;
  name: string;
  params?: Params;
}

export interface NavigationHelpers {
  navigate<RouteParams = any>(name: string, params?: RouteParams): void;
  push<RouteParams = any>(name: string, params?: RouteParams): void;
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

export interface ScreenRegistration {
  name: string;
  component: ScreenComponent<any>;
  options?: ScreenOptions;
}
