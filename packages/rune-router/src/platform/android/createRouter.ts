import { Stack } from "./Stack";
import { createBottomTabs } from "./Tabs";
import { createBottomSheetNavigator } from "./BottomSheet";
import type { StackProps } from "./Stack";
import type { ScreenProps } from "./Screen";

export function createRouter<_Routes extends Record<string, any> = Record<string, any>>() {
  const Tabs = createBottomTabs();
  const BottomSheet = createBottomSheetNavigator();
  return {
    Stack,
    Tabs,
    BottomSheet,
  } as {
    Stack: typeof Stack & {
      (props: StackProps): ReturnType<typeof Stack>;
      Screen: (props: ScreenProps<any>) => ReturnType<typeof Stack.Screen>;
    };
    Tabs: typeof Tabs;
    BottomSheet: typeof BottomSheet;
  };
}
