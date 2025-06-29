import type { JSX } from "solid-js";
import type {
  RouteParamList,
  StackScreenProps,
  TabScreenProps,
  BottomSheetScreenProps,
} from "./core/types";
import { Stack } from "./stack/Stack";
import { Tabs } from "./tabs/Tabs";
import { BottomSheet } from "./bottomSheet/BottomSheet";

export function createRouter<ParamList extends RouteParamList>() {
  type StackNamespace = typeof Stack & {
    Screen: <RouteName extends keyof ParamList>(
      props: StackScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };

  type BottomSheetNamespace = typeof BottomSheet & {
    Screen: <RouteName extends keyof ParamList>(
      props: BottomSheetScreenProps<ParamList, RouteName>
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
    BottomSheet: BottomSheet as BottomSheetNamespace,
  };
}
