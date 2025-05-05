import {
  ParentComponent,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  useContext,
} from "solid-js";
import type { JSX } from "solid-js";
import type { ScreenProps } from "./Screen";
import { useNavigationController } from "./context";
import { registerTabsNative } from "./nativeBridge";
import type {
  NativeTabOptions,
  ScreenOptions,
  TabBarOptions,
  TabIconDescriptor,
  TabOptions,
} from "./types";
import { registerTabIcon } from "./tabIconRegistry";
import "./tabIconRenderer";

interface TabNavigatorContextValue {
  navigatorId: string;
  registerTabScreen(definition: TabRegistration): () => void;
}

interface TabRegistration {
  name: string;
  options?: ScreenOptions;
  tabOptions?: NativeTabOptions;
}

const TabsNavigatorContext = createContext<TabNavigatorContextValue | null>(null);

function useTabsNavigator(): TabNavigatorContextValue {
  const context = useContext(TabsNavigatorContext);
  if (!context) {
    throw new Error(
      "[RuneAndroidRouter] <Tabs.Screen> must be rendered inside a <Tabs.Navigator>"
    );
  }
  return context;
}

export interface TabNavigatorProps {
  id?: string;
  initialRouteName?: string;
  tabBarOptions?: TabBarOptions;
  children?: JSX.Element;
}

export type TabScreenProps = ScreenProps;

type TabNavigatorComponent = ParentComponent<TabNavigatorProps> & {
  Screen: (props: TabScreenProps) => JSX.Element | null;
};

export function createBottomTabs(): TabNavigatorComponent {
  const TabNavigator: TabNavigatorComponent = ((props: TabNavigatorProps) => {
    const navigatorId = props.id ?? `tabs-${createUniqueId()}`;
    const controller = useNavigationController();
    const [version, setVersion] = createSignal(0);
    const tabs = new Map<string, TabRegistration>();

    const registerTabScreen = (definition: TabRegistration) => {
      tabs.set(definition.name, definition);
      setVersion((count) => count + 1);
      return () => {
        tabs.delete(definition.name);
        setVersion((count) => count + 1);
      };
    };

    createEffect(() => {
      version();
      registerTabsNative({
        navigatorId,
        initialRouteName: props.initialRouteName,
        tabBarOptions: props.tabBarOptions,
        tabs: Array.from(tabs.values()).map((entry) => ({
          name: entry.name,
          options: entry.options,
          tab: entry.tabOptions,
        })),
      });
    });

    return (
      <TabsNavigatorContext.Provider
        value={{ navigatorId, registerTabScreen }}
      >
        {props.children}
      </TabsNavigatorContext.Provider>
    );
  }) as TabNavigatorComponent;

  const TabScreen = (screenProps: TabScreenProps) => {
    const controller = useNavigationController();
    const navigator = useTabsNavigator();

    createEffect(() => {
      const unregister = controller.registerScreen({
        name: screenProps.name,
        component: screenProps.component,
        options: screenProps.options,
      });
      onCleanup(unregister);
    });

    createEffect(() => {
      const { options: serializedTabOptions, disposeIcon } = prepareTabOptions(
        navigator.navigatorId,
        String(screenProps.name),
        screenProps.options?.tab
      );
      const sanitizedOptions = screenProps.options
        ? {
            ...screenProps.options,
            tab: serializedTabOptions,
          }
        : undefined;
      const unregister = navigator.registerTabScreen({
        name: screenProps.name,
        options: sanitizedOptions,
        tabOptions: serializedTabOptions,
      });
      onCleanup(() => {
        unregister();
        disposeIcon?.();
      });
    });

    return null;
  };

  TabNavigator.Screen = TabScreen;
  return TabNavigator;
}

function prepareTabOptions(
  navigatorId: string,
  routeName: string,
  tabOptions?: TabOptions
): { options?: NativeTabOptions; disposeIcon?: () => void } {
  if (!tabOptions) {
    return { options: undefined };
  }

  const { customTab: _customTab, icon, ...rest } = tabOptions;
  if (!icon) {
    return { options: rest };
  }

  if (isTabIconDescriptor(icon)) {
    return { options: { ...rest, icon } };
  }

  const runeId = `${navigatorId}:${routeName}`;
  const factory = typeof icon === "function" ? icon : () => icon;
  const unregister = registerTabIcon(runeId, factory);
  const nextOptions: NativeTabOptions = {
    ...rest,
    icon: { runeId },
  };
  return { options: nextOptions, disposeIcon: unregister };
}

function isTabIconDescriptor(
  icon: TabOptions["icon"]
): icon is TabIconDescriptor {
  if (!icon || typeof icon !== "object") {
    return false;
  }
  return (
    "systemName" in icon ||
    "assetName" in icon ||
    "uri" in icon ||
    "runeId" in icon
  );
}
