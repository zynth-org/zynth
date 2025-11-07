import type { JSX, Component, Accessor } from "solid-js";

// ============================================================================
// Route Parameter Types
// ============================================================================

/**
 * Base type for defining route parameters.
 * Users extend this to define their app's routes.
 *
 * @example
 * type RootStackParams = {
 *   Home: undefined;
 *   Details: { id: string };
 *   Profile: { userId: number; showHeader?: boolean };
 * };
 */
export type RouteParamList = Record<string, object | undefined>;

// ============================================================================
// Navigation State
// ============================================================================

/**
 * Represents a single route in the navigation state.
 */
export interface RouteNode<ParamList extends RouteParamList = RouteParamList> {
  /** Unique key for this route instance */
  key: string;
  /** Route name (matches screen name) */
  name: keyof ParamList & string;
  /** Route parameters */
  params?: ParamList[keyof ParamList];
  /** Navigator type (for nested navigators) */
  type?: "stack" | "tabs";
  /** Nested navigator state */
  state?: NavigationState<ParamList>;
  /** Screen options */
  options?: ScreenOptions;
  /** Custom metadata */
  meta?: Record<string, unknown>;
}

/**
 * Complete navigation state tree.
 */
export interface NavigationState<
  ParamList extends RouteParamList = RouteParamList
> {
  /** Unique key for this navigator */
  key: string;
  /** Navigator type */
  type: "stack" | "tabs";
  /** Index of the focused route */
  index: number;
  /** Stack of routes */
  routes: RouteNode<ParamList>[];
  /** Whether this state is stale and needs refresh */
  stale?: boolean;
  /** History for tabs (tracks visited tabs) */
  history?: Array<{ key: string; type: string }>;
}

// ============================================================================
// Screen Options
// ============================================================================

/**
 * Options for configuring a screen's appearance and behavior.
 */
export interface ScreenOptions {
  // Header options
  /** Screen title */
  title?: string;
  /** Screen subtitle */
  subtitle?: string;
  /** Use large title style (iOS) */
  largeTitle?: boolean;
  /** Whether to show the header */
  headerShown?: boolean;
  /** Header text/icon tint color */
  headerTintColor?: string;
  /** Header title color (separate from tint for back/right) */
  headerTitleColor?: string;
  /** Header background color */
  headerBackgroundColor?: string;
  /** Native header style (iOS only) */
  headerStyle?: ScreenHeaderStyle;
  /** Header blur effect (iOS only) */
  headerBlurEffect?: ScreenHeaderBlurEffect;
  /** Transparent header */
  headerTransparent?: boolean;
  /** Header shadow visibility */
  headerShadowVisible?: boolean;
  /** Preferred UI style (iOS only) */
  userInterfaceStyle?: ScreenUserInterfaceStyle;
  /** Hide the default back button */
  headerBackVisible?: boolean;
  /** Custom header left component */
  headerLeft?: () => JSX.Element;
  /** Custom header right component */
  headerRight?: () => JSX.Element;
  /** Native-style header right button descriptor */
  headerRightButton?: HeaderRightButtonOptions;
  /** Custom header title component */
  headerTitle?: () => JSX.Element;

  // Animation & Presentation
  /** Enable/disable gestures */
  gestureEnabled?: boolean;
  /** Screen presentation style */
  presentation?: ScreenPresentation;
  /** Animation type */
  animation?: ScreenAnimation;
  /** Enable/disable animations */
  animationEnabled?: boolean;

  // Tab-specific
  /** Tab bar options */
  tab?: TabOptions;

  // BottomSheet-specific
  /** BottomSheet options */
  bottomSheet?: BottomSheetOptions;

  // Content options
  /** Content background color */
  contentBackgroundColor?: string;
}

export interface HeaderRightButtonOptions {
  title?: string;
  style?: "plain" | "done" | "icon" | "prominent";
  systemItem?: "close";
  onPress?: () => void;
}

export type ScreenHeaderStyle = "default" | "liquidGlass";
export type ScreenHeaderBlurEffect =
  | "systemUltraThin"
  | "systemThin"
  | "systemChromatic";
export type ScreenUserInterfaceStyle = "dark" | "light" | "system";

/**
 * Screen presentation styles
 */
export type ScreenPresentation =
  | "push"
  | "modal"
  | "transparentModal"
  | "fullScreen"
  | "zoom";

/**
 * Screen animation types
 */
export type ScreenAnimation = "push" | "modal" | "zoom" | "fade" | "none";

/**
 * Options can be static or a reactive function
 */
export type ScreenOptionsInput =
  | ScreenOptions
  | (() => ScreenOptions | undefined)
  | undefined;

// ============================================================================
// Tab Options
// ============================================================================

/**
 * Tab-specific options
 */
export interface TabOptions {
  /** Tab label */
  label?: string;
  /** Tab icon */
  icon?: TabIconDescriptor | TabIconFactory;
  /** Badge text */
  badge?: string | number;
  /** Badge color */
  badgeColor?: string;
  /** Hide this tab */
  hidden?: boolean;
}

/**
 * Tab icon descriptor
 */
export interface TabIconDescriptor {
  /** SF Symbol name (iOS) */
  systemName?: string;
  /** Asset name from bundle */
  assetName?: string;
  /** Remote image URI */
  uri?: string;
  /** Glyph character */
  glyph?: string;
  /** Glyph font family */
  glyphFontFamily?: string;
  /** Glyph font size */
  glyphFontSize?: number;
}

/**
 * Tab icon factory function
 */
export type TabIconFactory = (props: {
  active: boolean;
  color: string;
}) => JSX.Element;

/**
 * Tab bar configuration
 */
export interface TabBarOptions {
  /** Show/hide tab bar */
  tabBarVisible?: boolean;
  /** Tab bar background color */
  tabBarBackgroundColor?: string;
  /** Active tab tint color */
  tabBarActiveTintColor?: string;
  /** Inactive tab tint color */
  tabBarInactiveTintColor?: string;
  /** Show tab labels */
  tabBarShowLabels?: boolean;
  /** Tab bar style */
  tabBarStyle?: Record<string, unknown>;
}

// ============================================================================
// BottomSheet Options
// ============================================================================

/**
 * BottomSheet-specific options
 */
export interface BottomSheetOptions {
  /**
   * Snap points (e.g., ["25%", "50%", "90%"] or [200, 400])
   */
  snapPoints?: (number | string)[];
  /**
   * Initial snap index when this screen is focused
   */
  initialSnapIndex?: number;
}

// ============================================================================
// Router Actions
// ============================================================================

/**
 * Actions that can be dispatched to the router
 */
export type RouterAction<ParamList extends RouteParamList = RouteParamList> =
  | NavigateAction<ParamList>
  | PushAction<ParamList>
  | PopAction
  | GoBackAction
  | ReplaceAction<ParamList>
  | ResetAction<ParamList>
  | SetParamsAction
  | SwitchTabAction;

export interface NavigateAction<ParamList extends RouteParamList> {
  type: "NAVIGATE";
  payload: {
    name: keyof ParamList & string;
    params?: ParamList[keyof ParamList];
    options?: ScreenOptions;
  };
}

export interface PushAction<ParamList extends RouteParamList> {
  type: "PUSH";
  payload: {
    name: keyof ParamList & string;
    params?: ParamList[keyof ParamList];
    options?: ScreenOptions;
  };
}

export interface PopAction {
  type: "POP";
  payload?: {
    count?: number;
  };
}

export interface GoBackAction {
  type: "GO_BACK";
}

export interface ReplaceAction<ParamList extends RouteParamList> {
  type: "REPLACE";
  payload: {
    name: keyof ParamList & string;
    params?: ParamList[keyof ParamList];
  };
}

export interface ResetAction<ParamList extends RouteParamList> {
  type: "RESET";
  payload: {
    index?: number;
    routes: Array<{
      name: keyof ParamList & string;
      params?: ParamList[keyof ParamList];
    }>;
  };
}

export interface SetParamsAction {
  type: "SET_PARAMS";
  payload: Record<string, unknown>;
}

export interface SwitchTabAction {
  type: "SWITCH_TAB";
  payload: {
    index: number;
  };
}

// ============================================================================
// Navigation Helpers (returned by useNavigation)
// ============================================================================

/**
 * Navigation methods available via useNavigation()
 */
export interface NavigationHelpers<
  ParamList extends RouteParamList = RouteParamList
> {
  /** Navigate to a screen (reuses existing if in stack) */
  navigate<RouteName extends keyof ParamList & string>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  /** Push a new screen onto the stack */
  push<RouteName extends keyof ParamList & string>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  /** Pop screens from the stack */
  pop(count?: number): void;

  /** Pop to the first screen in the stack */
  popToTop(): void;

  /** Go back to the previous screen */
  goBack(): void;

  /** Replace the current screen */
  replace<RouteName extends keyof ParamList & string>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  /** Reset the navigation state */
  reset(state: {
    index?: number;
    routes: Array<{
      name: keyof ParamList & string;
      params?: ParamList[keyof ParamList];
    }>;
  }): void;

  /** Set params for the current screen */
  setParams(params: Partial<ParamList[keyof ParamList]>): void;

  /** Update screen options */
  setOptions(options: ScreenOptions): void;

  /** Check if can go back */
  canGoBack(): boolean;

  /** Get parent navigator (for nested navigation) */
  getParent<T extends NavigationHelpers = NavigationHelpers>(): T | undefined;

  /** Check if screen is focused */
  isFocused(): boolean;
}

// ============================================================================
// Route Context (returned by useRoute)
// ============================================================================

/**
 * Route information available via useRoute()
 */
export interface RouteContextValue<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  /** Unique key for this route instance */
  key: string;
  /** Route name */
  name: RouteName;
  /** Route params (reactive) */
  params: Accessor<ParamList[RouteName]>;
  /** Update params */
  setParams(params: Partial<ParamList[RouteName]>): void;
}

// ============================================================================
// Screen Component Props
// ============================================================================

/**
 * Props passed to screen components
 */
export interface ScreenComponentProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  navigation: NavigationHelpers<ParamList>;
  route: RouteContextValue<ParamList, RouteName>;
}

/**
 * Screen component type
 */
export type ScreenComponent<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> = Component<ScreenComponentProps<ParamList, RouteName>>;

// ============================================================================
// Navigator Props
// ============================================================================

/**
 * Props for Stack.Screen
 */
export interface StackScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  /** Screen name (must match a key in ParamList) */
  name: RouteName;
  /** Screen component */
  component: ScreenComponent<ParamList, RouteName>;
  /** Screen options */
  options?: ScreenOptionsInput;
  /** Initial params */
  initialParams?: ParamList[RouteName];
}

/**
 * Props for Stack.Navigator
 */
export interface StackNavigatorProps {
  /** Navigator ID */
  id?: string;
  /** Initial route name */
  initialRouteName?: string;
  /** Default screen options */
  screenOptions?: ScreenOptionsInput;
  /** Children (Stack.Screen elements) */
  children?: JSX.Element;
}

/**
 * Props for Tabs.Screen
 */
export interface TabScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  /** Screen name */
  name: RouteName;
  /** Screen component */
  component: ScreenComponent<ParamList, RouteName>;
  /** Screen options (including tab options) */
  options?: ScreenOptionsInput;
  /** Initial params */
  initialParams?: ParamList[RouteName];
}

/**
 * Props for Tabs.Navigator
 */
export interface TabsNavigatorProps {
  /** Navigator ID */
  id?: string;
  /** Initial route name */
  initialRouteName?: string;
  /** Default screen options */
  screenOptions?: ScreenOptionsInput;
  /** Tab bar options */
  tabBarOptions?: TabBarOptions;
  /** Custom tab bar component */
  tabBar?: (props: TabBarProps) => JSX.Element;
  /** Children (Tabs.Screen elements) */
  children?: JSX.Element;
}

/**
 * Props for BottomSheet.Screen
 */
export interface BottomSheetScreenProps<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  /** Screen name */
  name: RouteName;
  /** Screen component */
  component: ScreenComponent<ParamList, RouteName>;
  /** Screen options */
  options?: ScreenOptionsInput;
  /** Initial params */
  initialParams?: ParamList[RouteName];
}

/**
 * Props for BottomSheet.Navigator
 */
export interface BottomSheetNavigatorProps {
  /** Navigator ID */
  id?: string;
  /** Initial route name */
  initialRouteName?: string;
  /** Default screen options */
  screenOptions?: ScreenOptionsInput;
  /** Global bottom sheet options (default for all screens) */
  bottomSheetOptions?: BottomSheetOptions;
  /** Children (BottomSheet.Screen elements) */
  children?: JSX.Element;
}

/**
 * Props passed to custom tab bar
 */
export interface TabBarProps {
  /** Reactive navigation state */
  state: Accessor<NavigationState>;
  /** Navigation helpers */
  navigation: NavigationHelpers;
  /** Tab descriptors */
  descriptors: Record<
    string,
    {
      options: ScreenOptions;
      route: RouteNode;
    }
  >;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Focus effect callback
 */
export type FocusEffectCallback = () => void | (() => void);

/**
 * Before remove event
 */
export interface BeforeRemoveEvent {
  /** The action that triggered the removal */
  action: RouterAction;
  /** Whether default behavior is prevented */
  defaultPrevented: boolean;
  /** Prevent the removal */
  preventDefault(): void;
}

/**
 * Before remove handler
 */
export type BeforeRemoveHandler = (event: BeforeRemoveEvent) => void;

// ============================================================================
// Linking
// ============================================================================

/**
 * Linking configuration
 */
export interface LinkingOptions<
  ParamList extends RouteParamList = RouteParamList
> {
  /** URL prefixes (e.g., ["myapp://", "https://myapp.com"]) */
  prefixes?: string[];
  /** Route configuration */
  config?: LinkingConfig<ParamList>;
  /** Custom state parser */
  getStateFromPath?: (path: string) => NavigationState<ParamList> | undefined;
  /** Custom path generator */
  getPathFromState?: (state: NavigationState<ParamList>) => string | undefined;
}

/**
 * Linking route config
 */
export type LinkingConfig<ParamList extends RouteParamList = RouteParamList> = {
  [K in keyof ParamList]?: string | LinkingRouteConfig;
};

/**
 * Detailed linking route config
 */
export interface LinkingRouteConfig {
  /** Path pattern (e.g., "details/:id") */
  path?: string;
  /** Exact match only */
  exact?: boolean;
  /** Param parsers */
  parse?: Record<string, (value: string) => unknown>;
  /** Param stringifiers */
  stringify?: Record<string, (value: unknown) => string>;
  /** Nested screens */
  screens?: Record<string, string | LinkingRouteConfig>;
}

// ============================================================================
// Navigation Container Props
// ============================================================================

/**
 * Props for NavigationContainer
 */
export interface NavigationContainerProps<
  ParamList extends RouteParamList = RouteParamList
> {
  /** Children (navigators) */
  children?: JSX.Element;
  /** Initial navigation state */
  initialState?: NavigationState<ParamList>;
  /** Called when navigation state changes */
  onStateChange?: (state: NavigationState<ParamList>) => void;
  /** Called when container is ready */
  onReady?: () => void;
  /** Linking configuration */
  linking?: LinkingOptions<ParamList>;
}
