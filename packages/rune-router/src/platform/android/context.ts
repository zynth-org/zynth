import { createContext, useContext } from "solid-js";
import { registerScreenDefinition } from "./registry";
import type { ScreenRegistration } from "./types";

export interface NavigationContainerController {
  registerScreen(definition: ScreenRegistration): () => void;
  setInitialRouteName(name?: string): void;
}

export const NavigationContext = createContext<NavigationContainerController | null>(
  null
);

export function useNavigationController(): NavigationContainerController {
  const controller = useContext(NavigationContext);
  if (!controller) {
    throw new Error(
      "[RuneAndroidRouter] Navigator components must be rendered inside a <NavigationContainer>"
    );
  }
  return controller;
}

export function createNavigationController(
  setInitialRouteName: (name?: string) => void
): NavigationContainerController {
  return {
    registerScreen: registerScreenDefinition,
    setInitialRouteName,
  };
}
