import { onCleanup } from "solid-js";
import type { RouteParamList, BottomSheetScreenProps } from "../core/types";
import { useRouterContext } from "../core/RouterContext";
import { useBottomSheetId } from "./BottomSheet";

export const BottomSheetScreen = <
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(
  props: BottomSheetScreenProps<ParamList, RouteName>
) => {
  const router = useRouterContext();
  const navigatorId = useBottomSheetId();

  const unregister = router.registerScreen({
    name: String(props.name),
    navigatorId,
    type: "bottomSheet",
    component: props.component,
    initialParams: props.initialParams as Record<string, unknown> | undefined,
    options: props.options,
  });

  onCleanup(unregister);

  return null;
};
