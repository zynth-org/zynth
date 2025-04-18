import { onMount, onCleanup } from "solid-js";
import type { StackScreenProps, RouteParamList } from "./types";
import { registerScreen } from "./context";
import { useStackId } from "./Stack";

export function StackScreen<
  ParamList extends RouteParamList,
  RouteName extends keyof ParamList
>(props: StackScreenProps<ParamList, RouteName>) {
  const stackId = useStackId();

  let unregister: (() => void) | undefined;

  onMount(() => {
    unregister = registerScreen({
      name: props.name as string,
      component: props.component,
      navigatorId: stackId,
      initialParams: props.initialParams,
      options: props.options,
    });
  });

  onCleanup(() => {
    unregister?.();
  });

  return null;
}
