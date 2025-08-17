import { createEffect, onCleanup, createMemo } from "solid-js";
import {
  useNavigationContext,
  useRouteContext,
  toRouteContextValue,
} from "../context";
import type {
  RouteParamList,
  NavigationHelpers,
  RouteContextValue,
  FocusEffectCallback,
  BeforeRemoveHandler,
  ScreenOptions,
} from "../types";

// ============================================================================
// useNavigation
// ============================================================================

/**
 * Hook to access navigation methods.
 *
 * @example
 * const navigation = useNavigation();
 * navigation.navigate("Details", { id: "123" });
 * navigation.goBack();
 */
export function useNavigation<
  ParamList extends RouteParamList = RouteParamList
>(): NavigationHelpers<ParamList> {
  const context = useNavigationContext<ParamList>();
  return context.helpers;
}

// ============================================================================
// useRoute
// ============================================================================

/**
 * Hook to access the current route's information.
 *
 * @example
 * const route = useRoute();
 * console.log(route.name, route.params());
 */
export function useRoute<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
>(): RouteContextValue<ParamList, RouteName> {
  const context = useRouteContext<ParamList, RouteName>();
  return toRouteContextValue(context);
}

// ============================================================================
// useFocusEffect
// ============================================================================

/**
 * Hook to run an effect when the screen comes into focus.
 * Similar to useEffect but only runs when focused.
 *
 * @example
 * useFocusEffect(() => {
 *   console.log("Screen focused");
 *   fetchData();
 *
 *   return () => {
 *     console.log("Screen unfocused");
 *   };
 * });
 */
export function useFocusEffect(callback: FocusEffectCallback): void {
  const routeContext = useRouteContext();

  createEffect(() => {
    const isFocused = routeContext.isFocused();

    if (isFocused) {
      const cleanup = callback();
      if (cleanup) {
        onCleanup(cleanup);
      }
    }
  });
}

// ============================================================================
// useIsFocused
// ============================================================================

/**
 * Hook that returns whether the screen is currently focused.
 *
 * @example
 * const isFocused = useIsFocused();
 *
 * createEffect(() => {
 *   if (isFocused()) {
 *     // Screen is focused
 *   }
 * });
 */
export function useIsFocused() {
  const routeContext = useRouteContext();
  return routeContext.isFocused;
}

// ============================================================================
// useBeforeRemove
// ============================================================================

/**
 * Hook to prevent a screen from being removed.
 * Useful for confirming unsaved changes.
 *
 * @example
 * useBeforeRemove((event) => {
 *   if (hasUnsavedChanges()) {
 *     event.preventDefault();
 *     showConfirmDialog();
 *   }
 * });
 */
export function useBeforeRemove(handler: BeforeRemoveHandler): void {
  const navigation = useNavigationContext();

  // Store the handler for this screen
  // The navigator will call it before removing the screen
  createEffect(() => {
    // TODO: Implement proper before-remove event system
    // For now, this is a placeholder
    console.warn("useBeforeRemove is not fully implemented yet");
  });
}

// ============================================================================
// useNavigationState
// ============================================================================

/**
 * Hook to access the full navigation state.
 *
 * @example
 * const state = useNavigationState();
 * console.log(state().routes);
 */
export function useNavigationState<
  ParamList extends RouteParamList = RouteParamList
>() {
  const context = useNavigationContext<ParamList>();
  return context.state;
}

// ============================================================================
// useScreenOptions
// ============================================================================

/**
 * Hook to get and set screen options reactively.
 *
 * @example
 * const [options, setOptions] = useScreenOptions();
 * setOptions({ title: "New Title" });
 */
export function useScreenOptions(): [
  () => ScreenOptions,
  (options: ScreenOptions) => void
] {
  const routeContext = useRouteContext();
  return [routeContext.options, routeContext.setOptions];
}

// ============================================================================
// useParams
// ============================================================================

/**
 * Hook to access and update route params.
 *
 * @example
 * const [params, setParams] = useParams<{ id: string }>();
 * console.log(params().id);
 * setParams({ id: "new-id" });
 */
export function useParams<Params extends object = object>() {
  const routeContext = useRouteContext();
  return [
    routeContext.params as () => Params,
    routeContext.setParams as (params: Partial<Params>) => void,
  ] as const;
}

// ============================================================================
// useRouteName
// ============================================================================

/**
 * Hook to get the current route name.
 *
 * @example
 * const routeName = useRouteName();
 * console.log(routeName); // "Home"
 */
export function useRouteName(): string {
  const routeContext = useRouteContext();
  return routeContext.name;
}
