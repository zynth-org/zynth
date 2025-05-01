import { Stack } from "./Stack";
import { createBottomTabs } from "./Tabs";
import type { StackProps } from "./Stack";
import type { ScreenProps } from "./Screen";

export function createRouter<_Routes extends Record<string, any> = Record<string, any>>() {
  const Tabs = createBottomTabs();
  return {
    Stack,
    Tabs,
  } as {
    Stack: typeof Stack & {
      (props: StackProps): ReturnType<typeof Stack>;
      Screen: (props: ScreenProps<any>) => ReturnType<typeof Stack.Screen>;
    };
    Tabs: typeof Tabs;
  };
}
