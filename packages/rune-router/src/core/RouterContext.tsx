import {
  ParentComponent,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
  untrack,
  useContext,
} from "solid-js";
import {
  type BeforeRemoveEvent,
  type BeforeRemoveHandler,
  type FocusChangeHandler,
  type NavigationHelpers,
  type NavigationState,
  type RouteNode,
  type RouteContextValue,
  type RouteContextValueInternal,
  type RouteParamList,
  type RouterAction,
  type RouterContextValue,
  type ScreenDescriptor,
  type ScreenOptions,
  type ScreenOptionsInput,
  type SetOptionsConfig,
} from "./types";
import {
  registerScreenDescriptor,
  resolveScreenDescriptor,
  setNativeScreenOptions,
} from "./actions";
import { createTabBarMetricsAccessor } from "./tabMetrics";

export const RouterContext = createContext<RouterContextValue | null>(null);
export const RouteContext = createContext<RouteContextValue | null>(null);

class FocusManager {
  private listeners = new Map<string, Set<FocusChangeHandler>>();
  private focused = new Set<string>();

  update(state: NavigationState | null): void {
    const next = new Set(extractFocusedRouteKeys(state));

    if (areSetsEqual(this.focused, next)) {
      return;
    }

    for (const key of next) {
      if (!this.focused.has(key)) {
        this.emit(key, true);
      }
    }

    for (const key of this.focused) {
      if (!next.has(key)) {
        this.emit(key, false);
      }
    }

    this.focused = next;
  }

  subscribe(key: string, handler: FocusChangeHandler): () => void {
    let handlers = this.listeners.get(key);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(key, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
      if (handlers && handlers.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  private emit(key: string, focused: boolean): void {
    const handlers = this.listeners.get(key);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      try {
        handler(focused);
      } catch (error) {
        console.error("[RuneRouter] focus handler threw", error);
      }
    }
  }
}

export function createFocusManager(): FocusManager {
  return new FocusManager();
}

class BeforeRemoveManager {
  private handlers = new Map<string, Set<BeforeRemoveHandler>>();

  add(key: string, handler: BeforeRemoveHandler): () => void {
    let listeners = this.handlers.get(key);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(key, listeners);
    }
    listeners.add(handler);
    return () => {
      const current = this.handlers.get(key);
      current?.delete(handler);
      if (current && current.size === 0) {
        this.handlers.delete(key);
      }
    };
  }

  emit(action: RouterAction, key: string, data?: Record<string, unknown>): boolean {
    const listeners = this.handlers.get(key);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    let prevented = false;
    const event: BeforeRemoveEvent = {
      action,
      targetKey: key,
      data,
      defaultPrevented: false,
      preventDefault() {
        prevented = true;
        event.defaultPrevented = true;
      },
    };

    for (const handler of listeners) {
      try {
        handler(event);
      } catch (error) {
        console.error("[RuneRouter] beforeRemove handler threw", error);
      }
    }

    return prevented;
  }
}

export function createBeforeRemoveManager(): BeforeRemoveManager {
  return new BeforeRemoveManager();
}

export function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error(
      "useNavigation/useRoute hooks must be rendered inside a <NavigationContainer>"
    );
  }
  return ctx;
}

export function useRoute<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(): RouteContextValue<ParamList, RouteName> {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    throw new Error("useRoute must be used inside a screen component");
  }
  return ctx as RouteContextValue<ParamList, RouteName>;
}

export function useNavigation<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(): NavigationHelpers<ParamList> {
  const router = useRouterContext();
  const route = useRoute<ParamList, RouteName>();
  const descriptor = resolveScreenDescriptor(route.name as string);
  const navigatorId = descriptor?.navigatorId;

  const runSetOptions = (
    options: ScreenOptionsInput,
    config?: SetOptionsConfig
  ): (() => void) => {
    if (typeof options !== "function") {
      if (options) {
        router.setOptions(route.key, options as ScreenOptions);
      }
      return () => {};
    }

    let dispose: (() => void) | null = null;
    const focusAware = config?.focusAware ?? true;
    const runWhileBlurred = config?.runWhileBlurred ?? false;

    const start = () => {
      if (dispose) return;
      dispose = createRoot((rootDispose) => {
        createEffect(() => {
          const next = options();
          if (next) {
            router.setOptions(route.key, next as ScreenOptions);
          }
        });
        return rootDispose;
      });
    };

    const stop = () => {
      dispose?.();
      dispose = null;
    };

    const maybeStart = () => {
      if (!focusAware || runWhileBlurred || isRouteKeyFocused(router.state(), route.key)) {
        start();
      }
    };

    maybeStart();

    let unsubscribe: (() => void) | undefined;
    if (focusAware && !runWhileBlurred) {
      unsubscribe = router.subscribeFocus(route.key, (focused) => {
        if (focused) {
          start();
        } else {
          stop();
        }
      });
    }

    return () => {
      stop();
      unsubscribe?.();
    };
  };

  return {
    navigate(name, params) {
      router.dispatch({
        type: "NAVIGATE",
        payload: { name: name as string, params: params as any },
      });
    },
    push(name, params) {
      router.dispatch({
        type: "PUSH",
        payload: { name: name as string, params: params as any },
      });
    },
    pop(count) {
      router.dispatch({
        type: "POP",
        source: route.key,
        payload: count ? { count } : undefined,
      });
    },
    replace(name, params) {
      router.dispatch({
        type: "REPLACE",
        payload: { name: name as string, params: params as any },
      });
    },
    reset(state) {
      if (!state) return;
      router.dispatch({
        type: "RESET",
        state: state as NavigationState,
      });
    },
    setParams(next) {
      router.dispatch({
        type: "SET_PARAMS",
        source: route.key,
        payload: (next as Record<string, unknown>) ?? {},
      });
    },
    setOptions(options, config) {
      return runSetOptions(options, config);
    },
    tabBarMetrics(extraHeight = 0) {
      return createTabBarMetricsAccessor(navigatorId, extraHeight);
    },
  } satisfies NavigationHelpers<ParamList>;
}

export const RouteProvider: ParentComponent<{
  value: RouteContextValue;
}> = (props) => (
  <RouteContext.Provider value={props.value}>
    {props.children}
  </RouteContext.Provider>
);

export function createRouteContextValue(
  route: { key: string; name: string; params?: Record<string, unknown> },
  dispatch: (action: RouterAction) => void
): RouteContextValueInternal {
  const [params, setParams] = createSignal(route.params as any);
  const mergeParams = (
    partial: Record<string, unknown> | undefined
  ): Record<string, unknown> => {
    if (!partial) {
      return (untrack(params) as Record<string, unknown>) ?? {};
    }
    const previous = (untrack(params) as Record<string, unknown>) ?? {};
    return { ...previous, ...partial };
  };
  const context: RouteContextValueInternal = {
    key: route.key,
    name: route.name,
    params,
    setParams(next) {
      const merged = mergeParams(next as Record<string, unknown>);
      setParams(merged as any);
      dispatch({
        type: "SET_PARAMS",
        source: route.key,
        payload: merged,
      });
    },
    __updateFromState(next) {
      if (!next) return;
      const merged = mergeParams(next as Record<string, unknown>);
      setParams(merged as any);
    },
  };

  return context;
}

export function registerScreen(descriptor: ScreenDescriptor): () => void {
  return registerScreenDescriptor(descriptor);
}

export function applyScreenOptions(key: string, options: ScreenOptions): void {
  setNativeScreenOptions(key, options);
}

function extractFocusedRouteKeys(state: NavigationState | null): string[] {
  const keys: string[] = [];
  let cursor: NavigationState | null | undefined = state;

  while (cursor && cursor.routes.length > 0) {
    const route: RouteNode | undefined = cursor.routes[cursor.index ?? 0];
    if (!route) break;
    keys.push(route.key ?? route.name);
    cursor = route.state;
  }

  return keys;
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const key of a) {
    if (!b.has(key)) {
      return false;
    }
  }
  return true;
}

export function isRouteKeyFocused(
  state: NavigationState | null,
  key: string
): boolean {
  if (!state) return false;
  let cursor: NavigationState | null | undefined = state;
  while (cursor) {
    const route: RouteNode | undefined = cursor.routes[cursor.index ?? 0];
    if (!route) return false;
    if ((route.key ?? route.name) === key) {
      return true;
    }
    cursor = route.state;
  }
  return false;
}
