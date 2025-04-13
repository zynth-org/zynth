import { createRoot, createEffect, onCleanup } from "solid-js";
import type {
  RouteParamList,
  StackScreenProps,
  ScreenOptions,
  ScreenOptionsInput,
} from "../core/types";
import { useRouterContext } from "../core/RouterContext";
import { useStackId } from "./Stack";

export const StackScreen = <
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(
  props: StackScreenProps<ParamList, RouteName>
) => {
  const router = useRouterContext();
  const navigatorId = useStackId();

  const unregister = router.registerScreen({
    name: String(props.name),
    navigatorId,
    type: "stack",
    component: props.component,
    initialParams: props.initialParams as Record<string, unknown> | undefined,
    options: props.options,
    memoryPolicy: {
      keepAlive: props.keepAlive,
      unmountOnBlur: props.unmountOnBlur,
    },
  });

  onCleanup(unregister);

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
