export { NavigationContainer } from "./NavigationContainer";
export { Stack } from "./Stack";
export { useNavigation, useRoute } from "./context";
export { createRouter } from "./routerFactory";
export type {
  RouteParamList,
  RouteProp,
  NavigationHelpers,
  NavigationState,
  ScreenOptions,
  HeaderOptions,
  StackScreenProps,
} from "./types";

// Import native renderer to install global functions
import "./nativeRenderer";
