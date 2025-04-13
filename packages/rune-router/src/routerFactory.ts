import type { JSX } from "solid-js";
import type {
  RouteParamList,
  StackScreenProps,
  TabScreenProps,
} from "./core/types";
import { Stack } from "./stack/Stack";
import { Tabs } from "./tabs/Tabs";

export function createRouter<ParamList extends RouteParamList>() {
  type StackNamespace = typeof Stack & {
    Screen: <RouteName extends keyof ParamList>(
      props: StackScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };

  type TabsNamespace = typeof Tabs & {
    Screen: <RouteName extends keyof ParamList>(
      props: TabScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };

  return {
    Stack: Stack as StackNamespace,
    Tabs: Tabs as TabsNamespace,
  };
}
