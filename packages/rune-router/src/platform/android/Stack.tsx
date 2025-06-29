import type { JSX } from "solid-js";
import { createEffect, onCleanup } from "solid-js";
import type { ScreenProps } from "./Screen";
import { useNavigationController } from "./context";

export interface StackProps {
  initialRouteName?: string;
  children?: JSX.Element;
}

type StackComponent = ((props: StackProps) => JSX.Element | null) & {
  Screen: (props: ScreenProps<any>) => JSX.Element | null;
};

const StackComponentImpl: StackComponent = (props) => {
  const controller = useNavigationController();
  createEffect(() => {
    if (props.initialRouteName) {
      controller.setInitialRouteName(props.initialRouteName);
    }
  });
  return props.children ?? null;
};

StackComponentImpl.Screen = (props) => {
  const controller = useNavigationController();
  createEffect(() => {
    const unregister = controller.registerScreen({
      name: props.name,
      component: props.component,
      options: props.options,
      surface: "stack",
    });
    onCleanup(() => unregister?.());
  });
  return null;
};

export const Stack = StackComponentImpl;
