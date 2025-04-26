import { Stack } from "./Stack";
import type { StackProps } from "./Stack";
import type { ScreenProps } from "./Screen";

export function createRouter<_Routes extends Record<string, any> = Record<string, any>>() {
  return {
    Stack,
  } as {
    Stack: typeof Stack & {
      (props: StackProps): ReturnType<typeof Stack>;
      Screen: (props: ScreenProps<any>) => ReturnType<typeof Stack.Screen>;
    };
  };
}
