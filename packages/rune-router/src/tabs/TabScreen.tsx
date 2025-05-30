import { createEffect, createRoot, onCleanup } from "solid-js";
import type {
  RouteParamList,
  ScreenOptions,
  ScreenOptionsInput,
  TabScreenProps,
} from "../core/types";
import { useRouterContext } from "../core/RouterContext";
import { useTabsContext } from "./Tabs";

export const TabScreen = <
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(props: TabScreenProps<ParamList, RouteName>) => {
  const router = useRouterContext();
  const tabs = useTabsContext();
  const mountStrategy = props.mountStrategy ?? (tabs.lazy ? "lazy" : "eager");

  const unregister = router.registerScreen({
    name: String(props.name),
    navigatorId: tabs.id,
    type: "tab",
    component: props.component,
    initialParams: props.initialParams as Record<string, unknown> | undefined,
    options: props.options,
    mountStrategy,
  });

  const unregisterTab = tabs.registerScreen(String(props.name));

  onCleanup(() => {
    unregister();
    unregisterTab();
  });

  if (props.options) {
    const dispose = observeOptions(props.options, (options) => {
      if (options) {
        router.setOptions(String(props.name), options);
      }
    });
    onCleanup(dispose);
  }

  return null;
};

function observeOptions(
  options: ScreenOptionsInput,
  callback: (options?: ScreenOptions) => void
): () => void {
  return createRoot((dispose) => {
    createEffect(() => {
      const next = typeof options === "function" ? options() : options;
      callback(next as ScreenOptions | undefined);
    });
    return dispose;
  });
}
