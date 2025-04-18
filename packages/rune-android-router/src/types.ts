import type { Accessor, Component, JSX } from "solid-js";

// Minimal types for basic routing
export type RouteParamList = Record<string, object | undefined>;

export type RouteParams<
  T extends RouteParamList,
  RouteName extends keyof T
> = RouteName extends keyof T
  ? T[RouteName]
  : Record<string, unknown> | undefined;

export interface RouteProp<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> {
  key: string;
  name: RouteName;
  params: ParamList[RouteName];
}

export interface RouteNode {
  key: string;
  name: string;
  params?: Record<string, unknown>;
  state?: NavigationState;
}

export interface NavigationState {
  key: string;
  type: "stack";
  index: number;
  routes: RouteNode[];
}

export interface ScreenOptions {
  title?: string;
  headerShown?: boolean;
}

export type ScreenOptionsInput =
  | ScreenOptions
  | (() => ScreenOptions | undefined)
  | undefined;

export interface ScreenDescriptor {
  name: string;
  component: Component<any>;
  navigatorId?: string;
  initialParams?: Record<string, unknown>;
  options?: ScreenOptionsInput;
}

export interface NavigationHelpers<ParamList extends RouteParamList> {
  navigate<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;
  push<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;
  pop(count?: number): void;
  goBack(): void;
  reset(state: NavigationState): void;
}

export type RouterAction =
  | { type: "PUSH"; name: string; params?: any }
  | { type: "POP"; count?: number; source?: string }
  | { type: "NAVIGATE"; name: string; params?: any }
  | { type: "GO_BACK" }
  | { type: "RESET"; state: NavigationState };

export interface RouteContextValue<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> {
  navigation: NavigationHelpers<ParamList>;
  route: RouteProp<ParamList, RouteName>;
}

export interface RouterContextValue {
  state: Accessor<NavigationState | null>;
  dispatch: (action: RouterAction) => void;
  setOptions: (key: string, options: ScreenOptions) => void;
  registerScreen: (descriptor: ScreenDescriptor) => () => void;
}

// Component prop types
export interface StackProps {
  id?: string;
  initialRouteName?: string;
  children?: JSX.Element;
}

export interface StackScreenProps<
  ParamList extends RouteParamList,
  RouteName extends keyof ParamList
> {
  name: RouteName;
  component: Component<any>;
  initialParams?: ParamList[RouteName];
  options?: ScreenOptionsInput;
}

export interface StackComponentType {
  (props: StackProps): JSX.Element;
  Screen: <ParamList extends RouteParamList, RouteName extends keyof ParamList>(
    props: StackScreenProps<ParamList, RouteName>
  ) => JSX.Element | null;
}
