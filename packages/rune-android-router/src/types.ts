import type { Component } from "solid-js";

export interface ScreenOptions {
  title?: string;
  headerTintColor?: string;
  headerBackgroundColor?: string;
  headerShown?: boolean;
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
