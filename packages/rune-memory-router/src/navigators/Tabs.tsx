import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  For,
  Show,
  type JSX,
  type Accessor,
  children as resolveChildren,
} from "solid-js";
import { View, Text, Pressable } from "@rune/components";
import { ScreenTabsContainer, Screen as ScreenPrimitive } from "@rune/screens";
import { NavigationContext, type NavigationContextValue } from "../context";
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
  const {
    tabBarBackgroundColor = "#ffffff",
    tabBarActiveTintColor = "#007AFF",
    tabBarInactiveTintColor = "#8E8E93",
    tabBarShowLabels = true,
  } = props.tabBarOptions ?? {};

  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: tabBarBackgroundColor,
        paddingBottom: 20,
        paddingTop: 8,
      }}
    >
      <For each={props.state.routes}>
        {(route, index) => {
          const isActive = () => index() === props.state.index;
          const descriptor = props.descriptors[route.key];
          const options = descriptor?.options ?? {};
          const label = options.tab?.label ?? options.title ?? route.name;
          const tintColor = () =>
            isActive() ? tabBarActiveTintColor : tabBarInactiveTintColor;

          return (
            <Pressable
              onPress={() => props.navigation.navigate(route.name)}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 4,
              }}
            >
              {/* Icon placeholder - users can provide custom tab bar for icons */}
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: isActive()
                    ? tabBarActiveTintColor
                    : "transparent",
                  borderWidth: 2,
                  borderColor: tintColor(),
                  marginBottom: 2,
                }}
              />
              <Show when={tabBarShowLabels}>
                <Text
                  style={{
                    fontSize: 10,
                    color: tintColor(),
                    fontWeight: isActive() ? "600" : "400",
                  }}
                >
                  {label}
                </Text>
              </Show>
              <Show when={options.tab?.badge !== undefined}>
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 10,
                    backgroundColor: options.tab?.badgeColor ?? "#FF3B30",
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
                    {String(options.tab?.badge)}
                  </Text>
                </View>
              </Show>
            </Pressable>
          );
        }}
      </For>
    </View>
  );
}

// ============================================================================
// Tabs.Navigator Component
// ============================================================================

export function TabsNavigator(props: TabsNavigatorProps): JSX.Element {
  const screenRegistry = new Map<string, TabScreenConfig>();
  const screenOrder: string[] = [];

  const registerScreen = (name: string, config: TabScreenConfig) => {
    if (!screenRegistry.has(name)) {
      screenOrder.push(name);
    }
    screenRegistry.set(name, config);
  };

  const resolved = resolveChildren(() => props.children);

  const navigatorId = props.id ?? `tabs-${generateKey()}`;
  const [state, setState] = createSignal<NavigationState>(createInitialState());

  function createInitialState(): NavigationState {
    resolved(); // Force registration
    const initialRouteName = props.initialRouteName ?? screenOrder[0];
    const routes = screenOrder.map((name) => createRoute(name));
    const initialIndex = initialRouteName
      ? routes.findIndex((r) => r.name === initialRouteName)
      : 0;

    return {
      key: navigatorId,
      type: "tabs",
      index: Math.max(0, initialIndex),
      routes,
      history: [
        { key: routes[Math.max(0, initialIndex)]?.key ?? "", type: "tab" },
      ],
    };
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
      setState((prev) => {
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
    getParent() {
      return undefined;
    },
    isFocused() {
      return true;
    },
  };

  function dispatch(action: RouterAction): void {
    switch (action.type) {
      case "NAVIGATE":
        helpers.navigate(action.payload.name, action.payload.params as object);
        break;
      case "SWITCH_TAB":
        setState((prev) => {
          const index = action.payload.index;
          if (index >= 0 && index < prev.routes.length) {
            const history = [
              ...(prev.history ?? []),
              { key: prev.routes[index].key, type: "tab" },
            ];
            return { ...prev, index, history };
          }
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
    parent: undefined,
    navigatorId,
    navigatorType: "tabs",
  }));

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

  // Trigger screen registration
  resolved();

  const TabBar =
    props.tabBar ??
    ((p: TabBarProps) => (
      <DefaultTabBar {...p} tabBarOptions={props.tabBarOptions} />
    ));

  // Get current tab index
  const currentIndex = createMemo(() => state().index);

  return (
    <TabsNavigatorContext.Provider value={{ registerScreen }}>
      {resolved()}

      <NavigationContext.Provider value={navContextValue()}>
        <View style={{ flex: 1 }}>
          <ScreenTabsContainer
            selectedIndex={currentIndex()}
            style={{ flex: 1 }}
          >
            <For each={state().routes}>
              {(route, index) => {
                const config = screenRegistry.get(route.name);
                if (!config) return null;

                const isActive = createMemo(() => index() === state().index);
                const options = createMemo(() =>
                  resolveOptions(route.options, config.options)
                );

                const [params, setParams] = createSignal(route.params ?? {});
                const [screenOptions, setScreenOptions] =
                  createSignal<ScreenOptions>(options());

                const routeContext: RouteContextData = {
                  key: route.key,
                  name: route.name,
                  params: params as Accessor<object>,
                  setParams: (newParams) => {
                    setParams((p) => ({ ...p, ...newParams }));
                    helpers.setParams(newParams);
                  },
                  options: screenOptions,
                  setOptions: (newOptions) => {
                    setScreenOptions((o) => ({ ...o, ...newOptions }));
                    helpers.setOptions(newOptions);
                  },
                  isFocused: isActive,
                };

                const ScreenComponent = config.component;

                return (
                  <ScreenPrimitive
                    screenKey={route.key}
                    active={isActive()}
                    animation="none"
                  >
                    <RouteContext.Provider value={routeContext}>
                      <ScreenComponent
                        navigation={helpers}
                        route={{
                          key: route.key,
                          name: route.name,
                          params: params as Accessor<object>,
                          setParams: routeContext.setParams,
                        }}
                      />
                    </RouteContext.Provider>
                  </ScreenPrimitive>
                );
              }}
            </For>
          </ScreenTabsContainer>

          <Show when={props.tabBarOptions?.tabBarVisible !== false}>
            <TabBar
              state={state()}
              navigation={helpers}
              descriptors={descriptors()}
            />
          </Show>
        </View>
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
