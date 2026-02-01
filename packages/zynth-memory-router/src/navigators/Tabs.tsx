import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  Index,
  Show,
  onMount,
  onCleanup,
  getOwner,
  type JSX,
  type Accessor,
  children as resolveChildren,
  createEffect,
} from "solid-js";
import { View, Text, Button } from "@zynth/components";
import { ScreenTabsContainer } from "@zynth/screens";
import { Platform, OS } from "@zynth/apis";
import {
  NavigationContext,
  type NavigationContextValue,
  useNavigationContextUnsafe,
} from "../context";
import { useContainerContext } from "../NavigationContainer";
import { RouteContext, type RouteContextData } from "../context";
import type {
  RouteParamList,
  NavigationState,
  RouteNode,
  ScreenOptions,
  RouterAction,
  NavigationHelpers,
  TabsNavigatorProps,
  TabScreenProps,
  TabBarProps,
  TabBarOptions,
  ScreenComponent,
  ScreenOptionsInput,
} from "../types";
import {
  registerNativeTabIcon,
  unregisterNativeTabIcon,
  renderNativeTabIcon,
} from "../native/tabIconRegistry";
import type { ScreenTabBarItemDescriptor } from "@zynth/screens";
import { registerAndroidBackHandler } from "../native/androidBackHandler";
import { useTabBarMetrics } from "../integration/insets";

// ============================================================================
// Utility: Generate unique keys
// ============================================================================

let keyCounter = 0;
function generateKey(): string {
  return `tab-route-${++keyCounter}`;
}

// ============================================================================
// Tabs Navigator Context (internal)
// ============================================================================

interface TabsNavigatorContextValue {
  registerScreen: (name: string, config: TabScreenConfig) => void;
}

interface TabScreenConfig {
  component: ScreenComponent;
  options?: ScreenOptionsInput;
  initialParams?: object;
}

const TabsNavigatorContext = createContext<TabsNavigatorContextValue>();

// ============================================================================
// Tabs.Screen Component
// ============================================================================

export function TabScreen<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
>(props: TabScreenProps<ParamList, RouteName>): JSX.Element {
  const ctx = useContext(TabsNavigatorContext);
  if (ctx) {
    ctx.registerScreen(props.name, {
      component: props.component as unknown as ScreenComponent,
      options: props.options,
      initialParams: props.initialParams as object | undefined,
    });
  }
  return null as unknown as JSX.Element;
}

// ============================================================================
// Default Tab Bar
// ============================================================================

function DefaultTabBar(
  props: TabBarProps & { tabBarOptions?: TabBarOptions }
): JSX.Element {
  const navContext = useNavigationContextUnsafe();
  const hydrationReady = createMemo(() => navContext?.isHydrated?.() ?? false);
  const navigationState = createMemo(() => props.state());
  const tabBarMetrics = useTabBarMetrics();

  const {
    tabBarBackgroundColor = "#ffffff",
    tabBarActiveTintColor = "#007AFF",
    tabBarInactiveTintColor = "#8E8E93",
    tabBarShowLabels = true,
  } = props.tabBarOptions ?? {};

  return (
    <View
      style={{
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-around",
        backgroundColor: tabBarBackgroundColor,
        paddingBottom: tabBarMetrics().inset > 0 ? tabBarMetrics().inset : 8,
        paddingHorizontal: 5,
        paddingTop: 8,
        height: tabBarMetrics().height + 16,
      }}
    >
      <Index each={navigationState().routes}>
        {(route, index) => {
          const isActive = () => index === navigationState().index;
          const descriptor = () => props.descriptors[route().key];
          const options = () => descriptor()?.options ?? {};
          const label = () =>
            options().tab?.label ?? options().title ?? route().name;
          const tintColor = () =>
            isActive() ? tabBarActiveTintColor : tabBarInactiveTintColor;

          return (
            <Button
              onPress={() => props.navigation.navigate(route().name)}
              variant="ghost"
              rounded="pill"
              ready={hydrationReady()}
              style={{
                flex: 1,
              }}
            >
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {(options().tab?.icon as any)?.({
                  active: isActive(),
                  color: tintColor(),
                })}
                <Show when={tabBarShowLabels}>
                  <Text
                    style={{
                      fontSize: 10,
                      // color: "#FFF",
                      color: tintColor(),
                      fontWeight: isActive() ? "600" : "400",
                    }}
                  >
                    {label()}
                  </Text>
                </Show>
                <Show when={options().tab?.badge !== undefined}>
                  <View
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -10,
                      backgroundColor: options().tab?.badgeColor ?? "#FF3B30",
                      borderRadius: 8,
                      minWidth: 16,
                      height: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        color: "#ffffff",
                        fontWeight: "600",
                      }}
                    >
                      {String(options().tab?.badge)}
                    </Text>
                  </View>
                </Show>
              </View>
            </Button>
          );
        }}
      </Index>
    </View>
  );
}

// ============================================================================
// Tabs.Navigator Component
// ============================================================================

export function TabsNavigator(props: TabsNavigatorProps): JSX.Element {
  // Capture parent navigation context for nested navigators
  const parentContext = useNavigationContextUnsafe();
  const containerContext = useContainerContext();
  const isHydrated = createMemo(() => containerContext.isReady());

  const screenRegistry = new Map<string, TabScreenConfig>();
  const screenOrder: string[] = [];

  const registerScreen = (name: string, config: TabScreenConfig) => {
    if (!screenRegistry.has(name)) {
      screenOrder.push(name);
    }
    screenRegistry.set(name, config);
  };

  const navigatorId = props.id ?? `tabs-${generateKey()}`;
  const useNativeTabBar = Platform.OS === OS.IOS || Platform.OS === OS.ANDROID;

  // Start with empty state
  const [state, setState] = createSignal<NavigationState>({
    key: navigatorId,
    type: "tabs",
    index: 0,
    routes: [],
    history: [],
  });

  const [initialized, setInitialized] = createSignal(false);

  function initializeState() {
    if (initialized() || screenOrder.length === 0) return;

    const initialRouteName = props.initialRouteName ?? screenOrder[0];
    const routes = screenOrder.map((name) => createRoute(name));
    const initialIndex = initialRouteName
      ? routes.findIndex((r) => r.name === initialRouteName)
      : 0;

    setState({
      key: navigatorId,
      type: "tabs",
      index: Math.max(0, initialIndex),
      routes,
      history: [
        { key: routes[Math.max(0, initialIndex)]?.key ?? "", type: "tab" },
      ],
    });
    setInitialized(true);
  }

  function createRoute(name: string, params?: object): RouteNode {
    const config = screenRegistry.get(name);
    return {
      key: `${navigatorId}-${name}`,
      name,
      params: params ?? config?.initialParams,
      type: "tabs",
    };
  }

  // Navigation helpers
  const helpers: NavigationHelpers = {
    navigate(name, params) {
      // Check if this screen exists in current navigator
      if (!screenRegistry.has(name)) {
        // Screen not found in current navigator, bubble up to parent
        if (parentContext) {
          parentContext.helpers.navigate(name, params);
          return;
        }
        // No parent and screen not found - log warning
        console.warn(
          `[Tabs Navigator] Screen '${name}' not found in navigator '${navigatorId}' and no parent navigator available.`
        );
        return;
      }

      setState((prev) => {
        // If not initialized, we can't navigate yet, or should queue it?
        // For now assume initialized.
        const index = prev.routes.findIndex((r) => r.name === name);
        if (index >= 0) {
          const routes = [...prev.routes];
          if (params) {
            routes[index] = { ...routes[index], params };
          }
          const history = [
            ...(prev.history ?? []),
            { key: routes[index].key, type: "tab" },
          ];
          return { ...prev, index, routes, history };
        }
        return prev;
      });
    },
    push(name, params) {
      // Tabs don't push - navigate instead
      helpers.navigate(name, params);
    },
    popToTop() {
      setState((prev) => {
        if (prev.routes.length === 0) return prev;
        const firstRoute = prev.routes[0];
        return {
          ...prev,
          index: 0,
          history: [{ key: firstRoute.key, type: "tab" }],
        };
      });
    },
    pop() {
      // Go back in tab history
      setState((prev) => {
        const history = prev.history ?? [];
        if (history.length <= 1) return prev;
        const newHistory = history.slice(0, -1);
        const lastKey = newHistory[newHistory.length - 1]?.key;
        const index = prev.routes.findIndex((r) => r.key === lastKey);
        return { ...prev, index: Math.max(0, index), history: newHistory };
      });
    },
    goBack() {
      helpers.pop();
    },
    replace(name, params) {
      helpers.navigate(name, params);
    },
    reset(resetState) {
      setState((prev) => {
        const routes = resetState.routes.map((r) =>
          createRoute(r.name, r.params as object)
        );
        return {
          ...prev,
          index: resetState.index ?? 0,
          routes,
          history: [
            { key: routes[resetState.index ?? 0]?.key ?? "", type: "tab" },
          ],
        };
      });
    },
    setParams(params) {
      setState((prev) => {
        const routes = [...prev.routes];
        const current = routes[prev.index];
        routes[prev.index] = {
          ...current,
          params: { ...current.params, ...params },
        };
        return { ...prev, routes };
      });
    },
    setOptions(options) {
      setState((prev) => {
        const routes = [...prev.routes];
        const current = routes[prev.index];
        routes[prev.index] = {
          ...current,
          options: { ...current.options, ...options },
        };
        return { ...prev, routes };
      });
    },
    canGoBack() {
      return (state().history?.length ?? 0) > 1;
    },
    getParent<T extends NavigationHelpers = NavigationHelpers>():
      | T
      | undefined {
      return parentContext?.helpers as T | undefined;
    },
    isFocused() {
      return true;
    },
  };

  function dispatch(action: RouterAction): void {
    // console.log(
    //   `[Tabs] dispatch action: ${action.type}`,
    //   "payload" in action ? JSON.stringify(action.payload) : undefined
    // );
    switch (action.type) {
      case "NAVIGATE":
        helpers.navigate(action.payload.name, action.payload.params as object);
        break;
      case "SWITCH_TAB":
        setState((prev) => {
          const index = action.payload.index;
          // console.log(
          //   `[Tabs] SWITCH_TAB - index: ${index}, routes.length: ${prev.routes.length}, current index: ${prev.index}`
          // );
          if (index >= 0 && index < prev.routes.length) {
            const history = [
              ...(prev.history ?? []),
              { key: prev.routes[index].key, type: "tab" },
            ];
            // console.log(
            //   `[Tabs] Setting state index to ${index}, route: ${prev.routes[index].name}`
            // );
            return { ...prev, index, history };
          }
          // console.log(
          //   `[Tabs] Index ${index} out of bounds, not changing state`
          // );
          return prev;
        });
        break;
      case "GO_BACK":
        helpers.goBack();
        break;
      case "SET_PARAMS":
        helpers.setParams(action.payload);
        break;
    }
  }

  function resolveOptions(
    routeOptions?: ScreenOptions,
    screenOptions?: ScreenOptionsInput
  ): ScreenOptions {
    const defaultOpts =
      typeof props.screenOptions === "function"
        ? props.screenOptions() ?? {}
        : props.screenOptions ?? {};
    const screenOpts =
      typeof screenOptions === "function"
        ? screenOptions() ?? {}
        : screenOptions ?? {};
    return { ...defaultOpts, ...screenOpts, ...routeOptions };
  }

  const navContextValue = createMemo<NavigationContextValue>(() => ({
    state: state as Accessor<NavigationState>,
    helpers,
    dispatch,
    setOptions: helpers.setOptions,
    parent: parentContext,
    navigatorId,
    navigatorType: "tabs",
    isHydrated,
  }));

  const canGoBack = createMemo(() => helpers.canGoBack());
  registerAndroidBackHandler(canGoBack, () => {
    helpers.goBack();
  });

  // Build descriptors for tab bar
  const descriptors = createMemo(() => {
    const result: TabBarProps["descriptors"] = {};
    for (const route of state().routes) {
      const config = screenRegistry.get(route.name);
      result[route.key] = {
        options: resolveOptions(route.options, config?.options),
        route,
      };
    }
    return result;
  });

  const TabBarComponent = props.tabBar ?? DefaultTabBar;

  const resolvedNativeTabBarOptions = createMemo(() => ({
    visible: props.tabBarOptions?.tabBarVisible !== false,
    backgroundColor: props.tabBarOptions?.tabBarBackgroundColor,
    activeTintColor: props.tabBarOptions?.tabBarActiveTintColor,
    inactiveTintColor: props.tabBarOptions?.tabBarInactiveTintColor,
    showLabels: props.tabBarOptions?.tabBarShowLabels ?? true,
  }));

  const nativeTabItems = createMemo<ScreenTabBarItemDescriptor[]>(() => {
    if (!useNativeTabBar) {
      return [];
    }
    const descriptorMap = descriptors();
    return state().routes.map((route) => {
      const descriptor = descriptorMap[route.key];
      const options = descriptor?.options;
      const tabOptions = options?.tab;
      const iconOption = tabOptions?.icon;
      let iconDescriptor: ScreenTabBarItemDescriptor["icon"];
      if (typeof iconOption === "function") {
        iconDescriptor = { type: "surface", routeKey: route.key };
      } else if (iconOption && typeof iconOption === "object") {
        iconDescriptor = {
          type: "descriptor",
          systemName: iconOption.systemName,
          assetName: iconOption.assetName,
          uri: iconOption.uri,
          glyph: iconOption.glyph,
          glyphFontFamily: iconOption.glyphFontFamily,
          glyphFontSize: iconOption.glyphFontSize,
        };
      }
      return {
        key: route.key,
        routeName: route.name,
        label: tabOptions?.label ?? options?.title ?? route.name,
        badge: tabOptions?.badge,
        badgeColor: tabOptions?.badgeColor,
        hidden: tabOptions?.hidden ?? false,
        icon: iconDescriptor,
      };
    });
  });

  const shouldRenderJSTabBar = createMemo(
    () => !useNativeTabBar && props.tabBarOptions?.tabBarVisible !== false
  );

  const handleNativeTabSelect = (index: number) => {
    if (!useNativeTabBar) return;
    // console.log(
    //   `[Tabs] handleNativeTabSelect - index: ${index}, current state index: ${
    //     state().index
    //   }`
    // );
    dispatch({
      type: "SWITCH_TAB",
      payload: { index },
    });
  };

  const handleNativeTabMount = (event: {
    surfaceId: number;
    routeKey: string;
    active: boolean;
  }) => {
    if (!useNativeTabBar) return;
    const { surfaceId, routeKey, active } = event;
    const color = active
      ? props.tabBarOptions?.tabBarActiveTintColor ?? "#007AFF"
      : props.tabBarOptions?.tabBarInactiveTintColor ?? "#8E8E93";
    renderNativeTabIcon(surfaceId, routeKey, active, color);
  };

  const handleNativeTabUpdate = (event: {
    surfaceId: number;
    routeKey: string;
    active?: boolean;
  }) => {
    if (!useNativeTabBar) return;
    const { surfaceId, routeKey } = event;


    const active =
      event.active ??
      state().routes.find((r) => r.key === routeKey)?.name ===
        state().routes[state().index].name;

    const color = active
      ? props.tabBarOptions?.tabBarActiveTintColor ?? "#007AFF"
      : props.tabBarOptions?.tabBarInactiveTintColor ?? "#8E8E93";


    renderNativeTabIcon(surfaceId, routeKey, active, color);
  };

  // Get current tab index
  const currentIndex = createMemo(() => {
    const idx = state().index;
    // console.log(`[Tabs] currentIndex changed to: ${idx}`);
    return idx;
  });

  const TabsContent = () => {
    onMount(() => initializeState());

    return (
      <Show when={initialized()}>
        <View style={{ flex: 1 }}>
          <ScreenTabsContainer
            selectedIndex={currentIndex()}
            tabBarOptions={resolvedNativeTabBarOptions()}
            tabBarItems={nativeTabItems()}
            nativeTabBarEnabled={useNativeTabBar}
            onNativeTabSelect={
              useNativeTabBar ? handleNativeTabSelect : undefined
            }
            onNativeTabMount={
              useNativeTabBar ? handleNativeTabMount : undefined
            }
            onNativeTabUpdate={
              useNativeTabBar ? handleNativeTabUpdate : undefined
            }
            style={{ flex: 1 }}
          >
            {/* Use Index instead of For to guarantee DOM order matches array indices.
                ScreenTabsContainerView relies on child position for visibility. */}
            <Index each={state().routes}>
              {(route, index) => {
                // route is an Accessor when using Index
                const routeValue = () => route();
                const config = () => screenRegistry.get(routeValue().name);

                // Guard against missing config
                const hasConfig = createMemo(() => !!config());

                const isActive = createMemo(() => index === state().index);
                const options = createMemo(() => {
                  const cfg = config();
                  if (!cfg) return {};
                  return resolveOptions(routeValue().options, cfg.options);
                });

                const [params, setParams] = createSignal(
                  routeValue().params ?? {}
                );
                const [screenOptions, setScreenOptions] =
                  createSignal<ScreenOptions>(options());

                // Create route-specific helpers that target THIS route instead of the active one
                const routeHelpers = createMemo(() => ({
                  ...helpers,
                  setOptions: (opts: ScreenOptions) => {
                    setState((prev) => {
                      const idx = prev.routes.findIndex(
                        (r) => r.key === routeValue().key
                      );
                      if (idx === -1) return prev;
                      const routes = [...prev.routes];
                      const current = routes[idx];
                      // Merge options
                      const newOptions = { ...current.options, ...opts };
                      // Optimization: If options haven't changed, don't update state
                      if (
                        JSON.stringify(current.options) ===
                        JSON.stringify(newOptions)
                      ) {
                        return prev;
                      }
                      routes[idx] = {
                        ...current,
                        options: newOptions,
                      };
                      return { ...prev, routes };
                    });
                  },
                  setParams: (p: object) => {
                    setState((prev) => {
                      const idx = prev.routes.findIndex(
                        (r) => r.key === routeValue().key
                      );
                      if (idx === -1) return prev;
                      const routes = [...prev.routes];
                      const current = routes[idx];
                      // Merge params
                      const newParams = { ...current.params, ...p };
                      routes[idx] = {
                        ...current,
                        params: newParams,
                      };
                      return { ...prev, routes };
                    });
                  },
                }));

                const localOwner = getOwner();

                createEffect(() => {
                  const tabOptions = options().tab;
                  if (typeof tabOptions?.icon !== "function") {
                    unregisterNativeTabIcon(routeValue().key);
                    return;
                  }
                  registerNativeTabIcon({
                    routeKey: routeValue().key,
                    factory: tabOptions.icon,
                    owner: localOwner ?? null,
                  });
                });

                onCleanup(() => {
                  unregisterNativeTabIcon(routeValue().key);
                });

                // Create a route-specific navigation context
                const screenNavContextValue = createMemo(() => ({
                  ...navContextValue(),
                  helpers: routeHelpers(),
                  setOptions: routeHelpers().setOptions,
                }));

                const routeContext = createMemo<RouteContextData>(() => ({
                  key: routeValue().key,
                  name: routeValue().name,
                  params: params as Accessor<object>,
                  setParams: (newParams) => {
                    if (newParams) {
                      setParams((p) => ({ ...p, ...newParams }));
                      routeHelpers().setParams(newParams as object);
                    }
                  },
                  options: screenOptions,
                  setOptions: (newOptions) => {
                    setScreenOptions((o) => ({ ...o, ...newOptions }));
                    routeHelpers().setOptions(newOptions);
                  },
                  isFocused: isActive,
                }));

                const [isLoaded, setIsLoaded] = createSignal(isActive());

                createEffect(() => {
                  if (isActive()) {
                    setIsLoaded(true);
                  }
                });

                return (
                  <Show when={hasConfig()}>
                    {/* Use a simple View wrapper instead of ScreenPrimitive.
                        ScreenTabsContainerView handles visibility via selectedIndex,
                        we don't need ScreenView's active prop logic here.
                        Absolute positioning ensures children overlay each other. */}
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: useNativeTabBar ? "flex" : isActive() ? "flex" : "none",
                      }}
                    >
                      <NavigationContext.Provider
                        value={screenNavContextValue()}
                      >
                        <RouteContext.Provider value={routeContext()}>
                          <Show when={isLoaded()}>
                            {(() => {
                              const cfg = config();
                              if (!cfg) {
                                // console.log(
                                //   `[Tabs] No config for route at index ${index}`
                                // );
                                return null;
                              }
                              const ScreenComponent = cfg.component;

                              return (
                                <ScreenComponent
                                  navigation={routeHelpers()}
                                  route={{
                                    key: routeValue().key,
                                    name: routeValue().name,
                                    params: params as Accessor<object>,
                                    setParams: routeContext().setParams,
                                  }}
                                />
                              );
                            })()}
                          </Show>
                        </RouteContext.Provider>
                      </NavigationContext.Provider>
                    </View>
                  </Show>
                );
              }}
            </Index>
          </ScreenTabsContainer>

          <Show when={shouldRenderJSTabBar()}>
            <TabBarComponent
              state={state}
              navigation={helpers}
              descriptors={descriptors()}
              // @ts-ignore: DefaultTabBar expects tabBarOptions, custom ones might ignore it
              tabBarOptions={props.tabBarOptions}
            />
          </Show>
        </View>
      </Show>
    );
  };

  return (
    <TabsNavigatorContext.Provider value={{ registerScreen }}>
      {resolveChildren(() => props.children)()}

      <NavigationContext.Provider value={navContextValue()}>
        <TabsContent />
      </NavigationContext.Provider>
    </TabsNavigatorContext.Provider>
  );
}

// ============================================================================
// Tabs Export Object
// ============================================================================

export const Tabs = {
  Navigator: TabsNavigator,
  Screen: TabScreen,
};
