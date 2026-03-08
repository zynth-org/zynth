// ============================================================================
// @zynth/router
//
// Memory-based navigation router for Zynth apps. Uses @zynth/screens for
// transitions instead of platform-specific navigation controllers.
//
// This router is designed for hypervisor environments where multiple apps
// share the same native context and need to avoid surface ID conflicts.
// ============================================================================

// Navigation Container
export { NavigationContainer } from "./NavigationContainer";
export { useContainerContext } from "./NavigationContainer";

// Router Factory
export {
  createStackNavigator,
  createTabNavigator,
  createBottomSheetNavigator,
  createRouter,
} from "./createRouter";
export { createFileSystemRouter } from "./filesystem";

// Navigators
export { Stack, StackNavigator, StackScreen } from "./navigators";
export { Tabs, TabsNavigator, TabScreen } from "./navigators";
export {
  BottomSheet,
  BottomSheetNavigator,
  BottomSheetScreen,
} from "./navigators";

// Hooks
export {
  useNavigation,
  useRoute,
  createFocusEffect,
  useIsFocused,
  createBeforeRemove,
  useNavigationState,
  useScreenOptions,
  useParams,
  useRouteName,
} from "./hooks";

// Integration hooks
export { useHeaderMetrics, useTabBarMetrics } from "./integration/insets";
export type { HeaderMetrics, TabBarMetrics } from "./integration/insets";

// Context (for advanced use cases)
export {
  NavigationContext,
  useNavigationContext,
  useNavigationContextUnsafe,
  RouteContext,
  useRouteContext,
} from "./context";

// Types
export type {
  // Route types
  RouteParamList,
  RouteNode,
  NavigationState,

  // Screen options
  ScreenOptions,
  ScreenOptionsInput,
  ScreenHeaderBlurEffect,
  ScreenHeaderStyle,
  ScreenUserInterfaceStyle,
  ScreenPresentation,
  ScreenAnimation,

  // Tab options
  TabOptions,
  TabIconDescriptor,
  TabIconFactory,
  TabBarOptions,
  TabBarProps,

  // BottomSheet options
  BottomSheetOptions,
  BottomSheetNavigatorProps,
  BottomSheetScreenProps,

  // Navigation
  NavigationHelpers,
  NavigationContainerProps,

  // Router actions
  RouterAction,
  NavigateAction,
  PushAction,
  PopAction,
  GoBackAction,
  ReplaceAction,
  ResetAction,
  SetParamsAction,
  SwitchTabAction,

  // Screen components
  ScreenComponentProps,
  ScreenComponent,
  RouteContextValue,

  // Navigator props
  StackNavigatorProps,
  StackScreenProps,
  TabsNavigatorProps,
  TabScreenProps,

  // Events
  FocusEffectCallback,
  BeforeRemoveEvent,
  BeforeRemoveHandler,

  // Linking
  LinkingOptions,
  LinkingConfig,
  LinkingRouteConfig,

  // Filesystem routing
  FileSystemScreenRoute,
  FileSystemNavigatorRoute,
  FileSystemRouteNode,
  FileSystemRouterManifest,
} from "./types";

// Context types
export type { NavigationContextValue } from "./context";
export type { RouteContextData } from "./context";
