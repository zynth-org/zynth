import {
  ParentComponent,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { NavigationContext, createNavigationController } from "./context";
import { listScreenDefinitions, subscribeScreenRegistry } from "./registry";
import { registerScreensNative, resetStackNative } from "./nativeBridge";
import type { NativeScreenRegistration } from "./nativeBridge";
import "./nativeRenderer";
import "./tabIconRenderer";
import { onStackChanged } from "./events";

export interface NavigationContainerProps {
  children?: any;
}

export const NavigationContainer: ParentComponent<NavigationContainerProps> = (
  props
) => {
  const [initialRouteName, setInitialRouteName] = createSignal<
    string | undefined
  >();
  const [registryVersion, setRegistryVersion] = createSignal(0);
  let bootstrapped = false;

  createEffect(() => {
    const globalObject = globalThis as Record<string, any>;
    globalObject.__RUNE_NATIVE_ROUTER_ACTIVE = true;
    return () => {
      delete globalObject.__RUNE_NATIVE_ROUTER_ACTIVE;
    };
  });

  createEffect(() => {
    setRegistryVersion((value) => value + 1);
    const unsubscribeRegistry = subscribeScreenRegistry(() => {
      setRegistryVersion((value) => value + 1);
    });
    const unsubscribeStacks = onStackChanged((payload) => {
      const globalObject = globalThis as Record<string, any>;
      globalObject.__RUNE_NATIVE_ROUTER_STACK = payload;
      globalObject.__RUNE_NATIVE_ROUTER_CAN_GO_BACK = payload.canGoBack;
    });
    onCleanup(() => {
      unsubscribeRegistry();
      unsubscribeStacks();
    });
  });

  createEffect(() => {
    registryVersion();
    const screens = listScreenDefinitions();
    console.log(
      "[RuneAndroidRouter] registry changed",
      JSON.stringify(screens.map((screen) => screen.name))
    );
    if (screens.length === 0) {
      return;
    }
    const payload: NativeScreenRegistration[] = screens.map((screen) => ({
      name: screen.name,
      options: screen.options,
    }));
    void registerScreensNative(payload);

    const target = initialRouteName() ?? screens[0]?.name;
    if (!bootstrapped && target) {
      console.log("[RuneAndroidRouter] issuing reset", target);
      bootstrapped = true;
      void resetStackNative(target);
    }
  });

  const controller = createNavigationController((name) => {
    setInitialRouteName(name);
  });

  return (
    <NavigationContext.Provider value={controller}>
      {props.children}
    </NavigationContext.Provider>
  );
};
