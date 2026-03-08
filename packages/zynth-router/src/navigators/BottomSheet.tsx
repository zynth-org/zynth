import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  For,
  Show,
  createEffect,
  getOwner,
  runWithOwner,
  untrack,
  type JSX,
  type Accessor,
} from "solid-js";
import {
  View,
  Text,
  Button,
  SystemIcon,
  BottomSheet as ZynthBottomSheet,
  createBottomSheetController,
} from "@zynth/components";
import { Platform, OS, createSafeAreaInsets } from "@zynth/apis";
import {
  ScreenContainer,
  ScreenSheetContainer,
  Screen as ScreenPrimitive,
  type ScreenAnimationType,
} from "@zynth/screens";
import {
  NavigationContext,
  type NavigationContextValue,
  useNavigationContextUnsafe,
} from "../context";
import { RouteContext, type RouteContextData } from "../context";
import { useContainerContext } from "../NavigationContainer";
import {
  DEFAULT_HEADER_HEIGHT,
  HeaderHeightContext,
} from "../integration/insets";
import { registerAndroidBackHandler } from "../native/androidBackHandler";
import type {
  RouteParamList,
  NavigationState,
  RouteNode,
  ScreenOptions,
  RouterAction,
  NavigationHelpers,
  BottomSheetNavigatorProps,
  BottomSheetScreenProps,
  ScreenComponent,
  ScreenOptionsInput,
  BottomSheetOptions,
} from "../types";

// ============================================================================
// Utility: Generate unique keys
// ============================================================================

let keyCounter = 0;
function generateKey(): string {
  return `route-${++keyCounter}`;
}

// ============================================================================
// BottomSheet Navigator Context (internal)
// ============================================================================

interface BottomSheetNavigatorContextValue {
  registerScreen: (name: string, config: ScreenConfig) => void;
}

interface ScreenConfig {
  component: ScreenComponent;
  options?: ScreenOptionsInput;
  initialParams?: object;
}

const BottomSheetNavigatorContext =
  createContext<BottomSheetNavigatorContextValue>();

// ============================================================================
// BottomSheet.Screen Component
// ============================================================================

export function BottomSheetScreen<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string,
>(props: BottomSheetScreenProps<ParamList, RouteName>): JSX.Element {
  const ctx = useContext(BottomSheetNavigatorContext);
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
// BottomSheet.Navigator Component
// ============================================================================

export function BottomSheetNavigator(
  props: BottomSheetNavigatorProps,
): JSX.Element {
  // Capture parent navigation context for nested navigators
  const parentContext = useNavigationContextUnsafe();
  const containerContext = useContainerContext();
  const isHydrated = createMemo(() => containerContext.isReady());

  // Screen registry - populated by BottomSheet.Screen children
  const screenRegistry = new Map<string, ScreenConfig>();
  const screenOrder: string[] = [];

  // Track if we've initialized state
  const [initialized, setInitialized] = createSignal(false);
  const [initialRouteKey, setInitialRouteKey] = createSignal<string | null>(
    null,
  );
  const [hasNavigated, setHasNavigated] = createSignal(false);

  // Bottom Sheet Controller
  const bsController = createBottomSheetController();

  const registerScreen = (name: string, config: ScreenConfig) => {
    if (!screenRegistry.has(name)) {
      screenOrder.push(name);
    }
    screenRegistry.set(name, config);
  };

  // State - will be populated after children register
  const navigatorId = props.id ?? `bottom-sheet-${generateKey()}`;

  function createRouteNode(name: string, params?: object): RouteNode {
    const config = screenRegistry.get(name);
    return {
      key: generateKey(),
      name,
      params: params ?? config?.initialParams,
      type: "stack", // We behave like a stack internally
    };
  }

  // Start with empty state
  const [state, setState] = createSignal<NavigationState>({
    key: navigatorId,
    type: "stack",
    index: 0,
    routes: [],
  });

  // Initialize state after children have registered
  const initializeState = () => {
    if (initialized()) return;
    const initialRouteName = props.initialRouteName ?? screenOrder[0];

    if (initialRouteName && screenRegistry.has(initialRouteName)) {
      const initialRoute = createRouteNode(initialRouteName);
      setState({
        key: navigatorId,
        type: "stack",
        index: 0,
        routes: [initialRoute],
      });
      setInitialRouteKey(initialRoute.key);
      setInitialized(true);
    }
  };

  // Navigation helpers (Identical to Stack)
  const helpers: NavigationHelpers = {
    navigate(name, params) {
      if (!screenRegistry.has(name)) {
        if (parentContext) {
          parentContext.helpers.navigate(name, params);
          return;
        }
        console.warn(
          `[BottomSheet Navigator] Screen '${name}' not found in navigator '${navigatorId}'`,
        );
        return;
      }

      setHasNavigated(true);
      setState((prev) => {
        const existingIndex = prev.routes.findIndex((r) => r.name === name);
        if (existingIndex >= 0) {
          const routes = [...prev.routes];
          routes[existingIndex] = { ...routes[existingIndex], params };
          return { ...prev, index: existingIndex, routes };
        }
        const routes = [
          ...prev.routes.slice(0, prev.index + 1),
          createRouteNode(name, params),
        ];
        return { ...prev, index: routes.length - 1, routes };
      });
    },
    push(name, params) {
      setHasNavigated(true);
      setState((prev) => {
        const routes = [
          ...prev.routes.slice(0, prev.index + 1),
          createRouteNode(name, params),
        ];
        return { ...prev, index: routes.length - 1, routes };
      });
    },
    pop(count = 1) {
      setHasNavigated(true);
      setState((prev) => {
        const newIndex = Math.max(0, prev.index - count);
        return {
          ...prev,
          index: newIndex,
          routes: prev.routes.slice(0, newIndex + 1),
        };
      });
    },
    goBack() {
      setHasNavigated(true);
      helpers.pop(1);
    },
    popToTop() {
      setHasNavigated(true);
      setState((prev) => {
        if (prev.index === 0) return prev;
        const routes = [prev.routes[0]];
        return {
          ...prev,
          index: 0,
          routes,
        };
      });
    },
    replace(name, params) {
      setHasNavigated(true);
      setState((prev) => {
        const routes = [...prev.routes];
        routes[prev.index] = createRouteNode(name, params);
        return { ...prev, routes };
      });
    },
    reset(resetState) {
      setHasNavigated(true);
      setState((prev) => ({
        ...prev,
        index: resetState.index ?? resetState.routes.length - 1,
        routes: resetState.routes.map((r) =>
          createRouteNode(r.name, r.params as object),
        ),
      }));
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
      return state().index > 0;
    },
    getParent<T extends NavigationHelpers = NavigationHelpers>():
      | T
      | undefined {
      return parentContext?.helpers as T | undefined;
    },
    isFocused() {
      return true; // TODO
    },
  };

  function dispatch(action: RouterAction): void {
    switch (action.type) {
      case "NAVIGATE":
        helpers.navigate(action.payload.name, action.payload.params as object);
        break;
      case "PUSH":
        helpers.push(action.payload.name, action.payload.params as object);
        break;
      case "POP":
        helpers.pop(action.payload?.count);
        break;
      case "GO_BACK":
        helpers.goBack();
        break;
      case "REPLACE":
        helpers.replace(action.payload.name, action.payload.params as object);
        break;
      case "RESET":
        helpers.reset({
          index: action.payload.index,
          routes: action.payload.routes.map((r) => ({
            name: r.name,
            params: r.params as object,
          })),
        });
        break;
      case "SET_PARAMS":
        helpers.setParams(action.payload);
        break;
    }
  }

  function resolveOptions(
    routeOptions?: ScreenOptions,
    screenOptions?: ScreenOptionsInput,
  ): ScreenOptions {
    const defaultOpts =
      typeof props.screenOptions === "function"
        ? (props.screenOptions() ?? {})
        : (props.screenOptions ?? {});
    const screenOpts =
      typeof screenOptions === "function"
        ? (screenOptions() ?? {})
        : (screenOptions ?? {});
    const merged = { ...defaultOpts, ...screenOpts, ...routeOptions };
    return {
      headerShown: merged.headerShown ?? true,
      headerShadowVisible: merged.headerShadowVisible ?? true,
      headerBackgroundColor:
        merged.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND,
      ...merged,
    };
  }

  function resolveScreenAnimation(options: ScreenOptions): ScreenAnimationType {
    if (options.animationEnabled === false) return "none";
    if (options.animation) return options.animation as ScreenAnimationType;
    if (options.presentation === "modal") return "modal";
    if (options.presentation === "zoom") return "zoom";
    return "sheet-blur";
  }

  const navContextValue = createMemo<NavigationContextValue>(() => ({
    state: state as Accessor<NavigationState>,
    helpers,
    dispatch,
    setOptions: helpers.setOptions,
    parent: parentContext,
    navigatorId,
    navigatorType: "stack", // Treat as stack for internal logic
    isHydrated,
  }));

  const canGoBack = createMemo(() => helpers.canGoBack());
  registerAndroidBackHandler(canGoBack, () => {
    helpers.goBack();
  });

  const ScreensRenderer = () => {
    queueMicrotask(() => initializeState());

    const currentRoute = createMemo(() => state().routes[state().index]);
    const currentOptions = createMemo<ScreenOptions | undefined>(() => {
      const route = currentRoute();
      if (!route) return undefined;
      const config = screenRegistry.get(route.name);
      return resolveOptions(route.options, config?.options);
    });

    const bottomSheetOptions = createMemo<BottomSheetOptions>(() => {
      const opts = currentOptions()?.bottomSheet ?? {};
      const globalOpts = props.bottomSheetOptions ?? {};
      return {
        snapPoints: opts.snapPoints ?? globalOpts.snapPoints ?? ["50%", "90%"],
        initialSnapIndex:
          opts.initialSnapIndex ?? globalOpts.initialSnapIndex ?? 0,
      };
    });

    // Effect: Snap to new index when route changes (or initial load)
    createEffect(() => {
      const opts = bottomSheetOptions();
      // Snap to the preferred index for the current screen
      if (opts.initialSnapIndex !== undefined) {
        // Defer the snap command to ensure snapPoints props have been updated on the native side

        requestAnimationFrame(() => {
          bsController.snapTo(opts.initialSnapIndex!);
        });
      }
    });

    // ... inside ScreensRenderer component ...

    const headerShown = createMemo(
      () => currentOptions()?.headerShown !== false,
    );

    // On iOS, we use the native header provided by the navigation controller (via ScreenPrimitive props).
    // On Android, we currently render a JS-based header.
    const shouldRenderHeaderBar = createMemo(
      () => headerShown() && Platform.OS === OS.ANDROID,
    );

    // Provide a static header height (no safe area) to children if we are rendering a custom header
    // On iOS, the native header height is handled by the OS/Native Stack.
    const headerHeightValue = () =>
      shouldRenderHeaderBar() ? DEFAULT_HEADER_HEIGHT : 0;

    const Container =
      Platform.OS === OS.IOS ? ScreenSheetContainer : ScreenContainer;

    const defaultBackgroundColor =
      Platform.OS === OS.ANDROID ? "#ffffff" : "transparent";

    return (
      <HeaderHeightContext.Provider value={headerHeightValue}>
        <Show when={currentRoute()}>
          <ZynthBottomSheet
            snapPoints={bottomSheetOptions().snapPoints as any}
            initialSnapIndex={untrack(
              () => bottomSheetOptions().initialSnapIndex,
            )}
            controller={bsController}
            open={true} // Always open as a navigator
            allowDismissOnInteraction={false} // Prevent closing the navigator by swipe by default? User can implement back behavior.
          >
            <View
              style={{
                flex: 1,
                backgroundColor: "transparent",
              }}
            >
              <Container>
                <For each={state().routes}>
                  {(route, index) => {
                    const config = screenRegistry.get(route.name);
                    if (!config) return null;
                    const currentIndex = createMemo(() => state().index);
                    const isInStack = createMemo(
                      () => index() <= currentIndex(),
                    );
                    const options = createMemo(() =>
                      resolveOptions(route.options, config.options),
                    );
                    const [params, setParams] = createSignal(
                      route.params ?? {},
                    );

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
                      isFocused: createMemo(() => index() === currentIndex()),
                    };

                    const ScreenComponent = config.component;

                    return (
                      <ScreenPrimitive
                        screenKey={route.key}
                        active={isInStack()}
                        animation={
                          route.key === initialRouteKey()
                            ? "none"
                            : resolveScreenAnimation(options())
                        }
                        style={{
                          backgroundColor:
                            options()?.contentBackgroundColor ??
                            defaultBackgroundColor,
                        }}
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
              </Container>

              {shouldRenderHeaderBar() && currentRoute() && currentOptions() ? (
                <HeaderBar
                  key={currentRoute()!.key}
                  options={currentOptions()!}
                  title={currentOptions()!.title ?? currentRoute()!.name}
                  canGoBack={helpers.canGoBack()}
                  onBack={helpers.goBack}
                />
              ) : null}
            </View>
          </ZynthBottomSheet>
        </Show>
      </HeaderHeightContext.Provider>
    );
  };

  return (
    <BottomSheetNavigatorContext.Provider value={{ registerScreen }}>
      {props.children}
      <NavigationContext.Provider value={navContextValue()}>
        <ScreensRenderer />
      </NavigationContext.Provider>
    </BottomSheetNavigatorContext.Provider>
  );
}

// ============================================================================
// Header Bar (Reused)
// ============================================================================

interface HeaderBarProps {
  key?: string;
  options: ScreenOptions;
  title?: string;
  canGoBack: boolean;
  onBack: () => void;
}

const DEFAULT_HEADER_BACKGROUND = "#ffffff";
const DEFAULT_HEADER_TINT = "#111827";
const DEFAULT_TITLE_SIZE = 22;

function HeaderBar(props: HeaderBarProps) {
  const insets = createSafeAreaInsets();
  const insetTop = 0; // Header inside bottom sheet doesn't need top inset usually
  const baseHeight = DEFAULT_HEADER_HEIGHT;
  const owner = getOwner();

  const tintColor = () => props.options.headerTintColor ?? DEFAULT_HEADER_TINT;
  const titleColor = () =>
    props.options.headerTitleColor ??
    props.options.headerTintColor ??
    DEFAULT_HEADER_TINT;
  const backgroundColor = () =>
    props.options.headerTransparent
      ? "transparent"
      : (props.options.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND);
  const backVisible = () => props.options.headerBackVisible ?? true;
  const invokeBack = () => {
    if (owner) {
      runWithOwner(owner, () => props.onBack());
    } else {
      props.onBack();
    }
  };

  const renderLeft = () => {
    const canBack = () => props.canGoBack || backVisible();
    if (props.options.headerLeft) return props.options.headerLeft();
    return (
      <Button
        onPress={canBack() ? invokeBack : undefined}
        variant="ghost"
        iconOnly
        rounded="pill"
        style={{
          backgroundColor: "transparent",
          paddingHorizontal: 8,
          paddingVertical: 6,
          minWidth: 56,
          opacity: !props.canGoBack || !backVisible() ? 0 : 1,
        }}
      >
        <SystemIcon
          name={Platform.select({
            ios: "chevron.left",
            android: "ic_arrow_back",
          })}
          tintColor={tintColor()}
          style={{
            width: 24,
            height: 24,
          }}
        />
      </Button>
    );
  };

  const renderTitle = () => {
    if (props.options.headerTitle) return props.options.headerTitle();
    if (props.options.title) {
      return (
        <Text
          style={{
            color: titleColor(),
            fontSize: DEFAULT_TITLE_SIZE,
            fontWeight: "500",
          }}
          numberOfLines={1}
        >
          {props.options.title}
        </Text>
      );
    }
    return null;
  };

  const renderRight = () => {
    if (props.options.headerRight) return props.options.headerRight();
    return null;
  };

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: baseHeight,
        paddingTop: insetTop,
        backgroundColor: backgroundColor(),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: "rgba(0,0,0,0.1)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
          flex: 1,
        }}
      >
        <View
          style={{
            minWidth: 64,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {renderLeft()}
        </View>
        <View
          style={{
            alignItems: "center",
            paddingHorizontal: 8,
            height: "100%",
          }}
        >
          {renderTitle()}
        </View>
      </View>
      <View
        style={{
          minWidth: 64,
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        {renderRight()}
      </View>
    </View>
  );
}

// ============================================================================
// Export Object
// ============================================================================

export const BottomSheet = {
  Navigator: BottomSheetNavigator,
  Screen: BottomSheetScreen,
};
