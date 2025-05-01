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
import type { ScreenOptions, TabBarOptions, TabOptions } from "./types";

interface TabNavigatorContextValue {
  registerTabScreen(definition: TabRegistration): () => void;
}

interface TabRegistration {
  name: string;
  options?: ScreenOptions;
  tabOptions?: TabOptions;
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
      <TabsNavigatorContext.Provider value={{ registerTabScreen }}>
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
      const unregister = navigator.registerTabScreen({
        name: screenProps.name,
        options: screenProps.options,
        tabOptions: screenProps.options?.tab,
      });
      onCleanup(unregister);
    });

    return null;
  };

  TabNavigator.Screen = TabScreen;
  return TabNavigator;
}
