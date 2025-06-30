import {
  ParentComponent,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
} from "solid-js";
import type {
  BeforeRemoveEvent,
  BeforeRemoveHandler,
  FocusChangeHandler,
  FocusEffectCallback,
  NavigationHelpers,
  RouteContextValue,
  RouteContextValueInternal,
  RouteParamList,
} from "../ios/core/types";
import { onBackPress } from "./events";
import {
  addRouterEventListener,
  ROUTER_EVENT_FOCUS,
  ROUTER_EVENT_BLUR,
} from "../ios/core/events";
import { useNavigation as useNativeNavigation } from "./hooks";

type RouteContextValueRaw = {
  key: string;
  name: string;
  params?: Record<string, unknown>;
};

export interface RouterContextValue {
  subscribeFocus(key: string, handler: FocusChangeHandler): () => void;
  addBeforeRemoveListener(
    key: string,
    handler: BeforeRemoveHandler
  ): () => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);
const RouteContext = createContext<RouteContextValueInternal | null>(null);
let currentFocused: string | null = null;

function addFocusListener(key: string, handler: FocusChangeHandler): () => void {
  let last: boolean | undefined;
  const offFocus = addRouterEventListener(ROUTER_EVENT_FOCUS, ({ key: target }) => {
    if (target !== key) return;
    if (last === true) return;
    last = true;
    currentFocused = key;
    handler(true);
  });
  const offBlur = addRouterEventListener(ROUTER_EVENT_BLUR, ({ key: target }) => {
    if (target !== key) return;
    if (last === false) return;
    last = false;
    if (currentFocused === key) {
      currentFocused = null;
    }
    handler(false);
  });
  return () => {
    offFocus();
    offBlur();
  };
}

const beforeRemoveHandlers = new Map<string, Set<BeforeRemoveHandler>>();
let unsubscribeBack: (() => void) | null = null;

function ensureBackSubscription(): void {
  if (unsubscribeBack) return;
  unsubscribeBack = onBackPress(() => {
    if (!currentFocused) return;
    const handlers = beforeRemoveHandlers.get(currentFocused);
    if (!handlers || handlers.size === 0) return;

    const event: BeforeRemoveEvent = {
      action: { type: "POP", payload: { count: 1 } } as any,
      targetKey: currentFocused,
      data: undefined,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
    };

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[RuneRouter] beforeRemove handler threw", error);
      }
    }
  });
}

function addBeforeRemoveListener(
  key: string,
  handler: BeforeRemoveHandler
): () => void {
  ensureBackSubscription();
  let listeners = beforeRemoveHandlers.get(key);
  if (!listeners) {
    listeners = new Set();
    beforeRemoveHandlers.set(key, listeners);
  }
  listeners.add(handler);
  return () => {
    listeners?.delete(handler);
    if (listeners && listeners.size === 0) {
      beforeRemoveHandlers.delete(key);
    }
  };
}

const sharedRouterContext: RouterContextValue = {
  subscribeFocus: addFocusListener,
  addBeforeRemoveListener,
};

let ambientRouteContext: RouteContextValueInternal | null = null;
let ambientRouterContext: RouterContextValue | null = null;

export function setAmbientContexts(
  routeCtx: RouteContextValueInternal,
  routerCtx: RouterContextValue
): void {
  ambientRouteContext = routeCtx;
  ambientRouterContext = routerCtx;
}

export function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    if (ambientRouterContext) {
      return ambientRouterContext;
    }
    console.warn(
      "[RuneRouter] useRouterContext called without a provider. Falling back to a global context."
    );
    return sharedRouterContext;
  }
  return ctx;
}

export function useRoute<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(): RouteContextValue<ParamList, RouteName> {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    if (ambientRouteContext) {
      return ambientRouteContext as unknown as RouteContextValue<ParamList, RouteName>;
    }
    console.warn(
      "[RuneRouter] useRoute called outside of RouteProvider. Returning a placeholder route."
    );
    return {
      key: "unknown",
      name: "unknown" as any,
      params: () => undefined as any,
      setParams() {
        console.warn("[RuneRouter] setParams called without a route context");
      },
    } as RouteContextValue<ParamList, RouteName>;
  }
  return ctx as unknown as RouteContextValue<ParamList, RouteName>;
}

export function useNavigation<
  ParamList extends RouteParamList = RouteParamList
>(): NavigationHelpers<ParamList> {
  const native = useNativeNavigation<ParamList>() as NavigationHelpers<ParamList>;
  return {
    ...native,
    pop(count?: number) {
      // Android bridge only exposes goBack; pop by count triggers goBack once.
      native.goBack();
      if (count && count > 1) {
        console.warn("[RuneRouter] pop count>1 not implemented on Android; falling back to goBack once.");
      }
    },
    replace(name, params) {
      native.navigate(name as any, params as any);
    },
    reset(_state) {
      console.warn("[RuneRouter] reset is not implemented on Android yet.");
    },
    setParams(next) {
      console.warn("[RuneRouter] setParams is not implemented on Android yet.", next);
    },
    tabBarMetrics() {
      console.warn("[RuneRouter] tabBarMetrics is not implemented on Android yet.");
      return () => ({ height: 0, inset: 0 });
    },
  };
}

export function useFocusEffect(callback: FocusEffectCallback): void {
  const route = useRoute();
  const router = useRouterContext();

  createEffect(() => {
    let cleanup: (() => void) | void;
    const unsubscribeFocus = router.subscribeFocus(route.key, (focused) => {
      if (focused) {
        cleanup?.();
        cleanup = callback();
      } else {
        cleanup?.();
      }
    });
    onCleanup(() => {
      cleanup?.();
      unsubscribeFocus();
    });
  });
}

export function useBeforeRemove(
  handler: BeforeRemoveHandler
): void {
  const router = useRouterContext();
  const route = useRoute();

  createEffect(() => {
    const unsubscribe = router.addBeforeRemoveListener(route.key, handler);
    onCleanup(unsubscribe);
  });
}

export function useNavigationEvents(handlers: {
  focus?: (payload: { key: string }) => void;
  blur?: (payload: { key: string }) => void;
}): void {
  createEffect(() => {
    const subs: Array<() => void> = [];
    if (handlers.focus) {
      subs.push(addRouterEventListener(ROUTER_EVENT_FOCUS, handlers.focus));
    }
    if (handlers.blur) {
      subs.push(addRouterEventListener(ROUTER_EVENT_BLUR, handlers.blur));
    }
    onCleanup(() => subs.forEach((off) => off()));
  });
}

export const RouteProvider: ParentComponent<{ value: RouteContextValueInternal }> = (
  props
) => (
  <RouteContext.Provider value={props.value}>
    {props.children}
  </RouteContext.Provider>
);

export function createRouteContextValue(
  route: RouteContextValueRaw
): RouteContextValueInternal {
  const [params, setParams] = createSignal(route.params as any);
  return {
    key: route.key,
    name: route.name,
    params,
    setParams(next) {
      setParams((prev) => ({ ...(prev ?? {}), ...(next as any) }));
    },
    __updateFromState(next) {
      if (!next) return;
      setParams((prev) => ({ ...(prev ?? {}), ...(next as any) }));
    },
  } as RouteContextValueInternal;
}

export function getRouterContextValue(): RouterContextValue {
  return sharedRouterContext;
}
