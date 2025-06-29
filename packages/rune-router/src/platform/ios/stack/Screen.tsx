import { onCleanup } from "solid-js";
import type {
  RouteParamList,
  StackScreenProps,
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

  return null;
};
