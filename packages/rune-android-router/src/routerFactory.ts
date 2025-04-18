import type { JSX } from "solid-js";
import type { RouteParamList, StackScreenProps } from "./types";
import { Stack } from "./Stack";

export function createRouter<ParamList extends RouteParamList>() {
  type StackNamespace = typeof Stack & {
    Screen: <RouteName extends keyof ParamList>(
      props: StackScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };

  return {
    Stack: Stack as StackNamespace,
  };
}
