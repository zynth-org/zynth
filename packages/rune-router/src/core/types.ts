import type { Accessor, Component, JSX, ParentComponent } from "solid-js";
import type { TabBarMetrics } from "./tabMetrics";

export type { TabBarMetrics } from "./tabMetrics";

export type RouteParamList = Record<string, object | undefined>;

export type RouteParams<T extends RouteParamList, RouteName extends keyof T> =
  RouteName extends keyof T ? T[RouteName] : Record<string, unknown> | undefined;

export interface RouteProp<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> {
  key: string;
  name: RouteName;
  params: ParamList[RouteName];
  path?: string;
}

export interface RouteNode {
  key: string;
  name: string;
  params?: Record<string, unknown>;
  type?: "stack" | "tabs" | string;
  state?: NavigationState;
  options?: ScreenOptions;
  meta?: Record<string, unknown>;
}

export interface NavigationState {
  key: string;
  type: "stack" | "tabs" | string;
  index: number;
  routes: RouteNode[];
  stale?: boolean;
  history?: Array<{ key: string; type: string }>;
}

export interface MemoryPolicy {
  /** Number of off-screen routes to keep mounted for fast back navigation */
  keepAlive?: number;
  /** Force unmount when route blurs regardless of keepAlive */
  unmountOnBlur?: boolean;
  /** Force keep mounted even when not focused */
  mountOnBlur?: boolean;
}

export interface HeaderOptions {
  title?: string;
  subtitle?: string;
  largeTitle?: boolean;
  headerShown?: boolean;
  headerTintColor?: string;
  headerBackgroundColor?: string;
  headerTransparent?: boolean;
  headerBlurEffect?: "systemUltraThin" | "systemThin" | "systemChromatic";
  headerShadowVisible?: boolean;
  headerRightButton?: {
    title?: string;
    style?: "plain" | "done" | "icon";
    systemItem?: "close";
  };
  userInterfaceStyle?: "light" | "dark" | "system";
  custom?: JSX.Element;
}

export interface TabIconDescriptor {
  systemName?: string;
  assetName?: string;
  uri?: string;
  runeId?: string;
  glyph?: string;
  glyphFontFamily?: string;
  glyphFontSize?: number;
  glyphFontWeight?: "thin" | "light" | "regular" | "medium" | "semibold" | "bold" | "heavy";
  glyphBaselineOffset?: number;
  glyphActiveColor?: string;
  glyphInactiveColor?: string;
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

export type BottomSheetSnapPoint = string | number;

export interface BottomSheetScreenOptions {
  snapPoints?: BottomSheetSnapPoint[];
  initialSnapIndex?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  enableDynamicSizing?: boolean;
  allowDismissOnInteraction?: boolean;
  allowBackgroundInteraction?: boolean;
}

export interface ScreenOptions extends HeaderOptions {
  gestureEnabled?: boolean;
  presentation?:
    | "push"
    | "modal"
    | "transparentModal"
    | "fullScreen"
    | "pageSheet"
    | "formSheet";
  animationEnabled?: boolean;
  tab?: TabOptions;
  bottomSheet?: BottomSheetScreenOptions;
}

export type ScreenOptionsInput =
  | ScreenOptions
  | (() => ScreenOptions | undefined)
  | undefined;

export interface NavigatorDescriptor {
  id: string;
  type: "stack" | "tabs" | "bottom-sheet";
  initialRouteName?: string;
}

export const TABS_ROOT_NAVIGATOR_ID = "tabs-root" as const;
export type TabsRootNavigatorId = typeof TABS_ROOT_NAVIGATOR_ID;
export const TABS_ROOT_ROUTE_KEY = "tabs-root" as const;

export interface ScreenDescriptor {
  name: string;
  navigatorId: string;
  type: "stack" | "tab" | "bottomSheet";
  component: Component<any>;
  initialParams?: Record<string, unknown>;
  options?: ScreenOptionsInput;
  memoryPolicy?: MemoryPolicy;
  mountStrategy?: TabMountStrategy;
}

export interface StackProps {
  id?: string;
  initialRouteName?: string;
  children: JSX.Element;
}

export interface BottomSheetProps {
  id?: string;
  initialRouteName?: string;
  snapPoints?: BottomSheetSnapPoint[];
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  enableDynamicSizing?: boolean;
  children: JSX.Element;
}

export interface TabsProps {
  id?: string;
  initialRouteName?: string;
  lazy?: boolean;
  children: JSX.Element;
}

export interface StackHeaderProps {
  children?: JSX.Element;
  elevated?: boolean;
}

export interface TabBarProps {
  translucent?: boolean;
  appearance?: "auto" | "opaque" | "transparent";
  children?: JSX.Element;
}

export type TabMountStrategy = "lazy" | "eager" | "resume";

export type StackScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> = {
  name: RouteName;
  component: Component;
  options?: ScreenOptionsInput;
  initialParams?: ParamList[RouteName];
  keepAlive?: number;
  unmountOnBlur?: boolean;
};

export type BottomSheetScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> = {
  name: RouteName;
  component: Component;
  options?: ScreenOptionsInput;
  initialParams?: ParamList[RouteName];
};

export type TabScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> = {
  name: RouteName;
  component: Component;
  options?: ScreenOptionsInput;
  initialParams?: ParamList[RouteName];
  mountStrategy?: TabMountStrategy;
};

export type FocusChangeHandler = (focused: boolean) => void;

export type FocusEffectCallback = () => void | (() => void);

export interface BeforeRemoveEvent {
  action: RouterAction;
  targetKey: string;
  data?: Record<string, unknown>;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export type BeforeRemoveHandler = (event: BeforeRemoveEvent) => void;

export interface NavigationHelpers<
  ParamList extends RouteParamList = RouteParamList
> {
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
  replace<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;
  reset(state: Partial<NavigationState>): void;
  setParams<RouteName extends keyof ParamList>(
    params: Partial<ParamList[RouteName]>
  ): void;
  setOptions(
    options: ScreenOptionsInput,
    config?: SetOptionsConfig
  ): () => void;
  tabBarMetrics(extraHeight?: number): () => TabBarMetrics;
}

export type RouterAction =
  | {
      type: "NAVIGATE";
      source?: string;
      payload: {
        name: string;
        params?: Record<string, unknown>;
        options?: ScreenOptions;
      };
    }
  | {
      type: "PUSH";
      source?: string;
      payload: {
        name: string;
        params?: Record<string, unknown>;
        options?: ScreenOptions;
      };
    }
  | { type: "POP"; source?: string; payload?: { count?: number } }
  | {
      type: "REPLACE";
      source?: string;
      payload: { name: string; params?: Record<string, unknown> };
    }
  | { type: "RESET"; state: NavigationState }
  | {
      type: "SET_PARAMS";
      source: string;
      payload: Record<string, unknown>;
    };

export interface RouterContextValue {
  state: Accessor<NavigationState | null>;
  dispatch(action: RouterAction): void;
  setOptions(key: string, options: ScreenOptions): void;
  registerScreen(descriptor: ScreenDescriptor): () => void;
  subscribeFocus(key: string, handler: FocusChangeHandler): () => void;
  addBeforeRemoveListener(
    key: string,
    handler: BeforeRemoveHandler
  ): () => void;
  emitBeforeRemove(
    action: RouterAction,
    key: string,
    data?: Record<string, unknown>
  ): boolean;
}

export interface RouteContextValue<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> {
  key: string;
  name: RouteName;
  params: Accessor<ParamList[RouteName]>;
  setParams(params: Partial<ParamList[RouteName]>): void;
}

export interface RouteContextValueInternal<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
> extends RouteContextValue<ParamList, RouteName> {
  __updateFromState(params: ParamList[RouteName]): void;
}

export type StackComponentType = ParentComponent<StackProps> & {
  Screen: <
    ParamList extends RouteParamList = RouteParamList,
    RouteName extends keyof ParamList = keyof ParamList
  >(
    props: StackScreenProps<ParamList, RouteName>
  ) => JSX.Element | null;
  Header: Component<StackHeaderProps>;
};

export type BottomSheetComponentType = ParentComponent<BottomSheetProps> & {
  Screen: <
    ParamList extends RouteParamList = RouteParamList,
    RouteName extends keyof ParamList = keyof ParamList
  >(
    props: BottomSheetScreenProps<ParamList, RouteName>
  ) => JSX.Element | null;
};

export type TabsComponentType = ParentComponent<TabsProps> & {
  Screen: <
    ParamList extends RouteParamList = RouteParamList,
    RouteName extends keyof ParamList = keyof ParamList
  >(
    props: TabScreenProps<ParamList, RouteName>
  ) => JSX.Element | null;
  TabBar: ParentComponent<TabBarProps>;
};

export type RouteParamKey<Map extends RouteParamList> = keyof Map & string;

export type TypedNavigationHelpers<
  Map extends RouteParamList,
  RouteName extends RouteParamKey<Map>
> = NavigationHelpers<Pick<Map, RouteName>>;

export interface SetOptionsConfig {
  /**
   * When true (default), the reactive options effect pauses when the route loses focus.
   * Set to false to keep computing even when backgrounded.
   */
  focusAware?: boolean;
  /**
   * Run the effect immediately even if the screen is not focused yet.
   * Useful for mounting all tabs eagerly.
   */
  runWhileBlurred?: boolean;
}

export interface NavigationPersistenceAdapter {
  load():
    | NavigationState
    | undefined
    | null
    | Promise<NavigationState | undefined | null>;
  save(state: NavigationState): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface LinkingRouteConfig {
  path?: string;
  exact?: boolean;
  parse?: Record<string, (value: string) => unknown>;
  stringify?: Record<string, (value: unknown) => string>;
  screens?: Record<string, LinkingRouteConfig | string>;
}

export interface LinkingOptions {
  prefixes?: string[];
  config?: Record<string, LinkingRouteConfig | string>;
  getStateFromPath?: (path: string) => NavigationState | undefined;
  getPathFromState?: (state: NavigationState) => string | undefined;
  filter?: (url: string) => boolean;
  onUnhandledURL?: (url: string) => void;
}
