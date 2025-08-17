import type { JSX } from "solid-js";
import type { RouteParamList, StackScreenProps, TabScreenProps } from "./types";
import { Stack, StackNavigator } from "./navigators/Stack";
import { Tabs, TabsNavigator } from "./navigators/Tabs";

/**
 * Creates a typed Stack navigator (React Navigation style API).
 *
 * @example
 * type RootStackParams = {
 *   Home: undefined;
 *   Details: { id: string };
 * };
 *
 * const Stack = createStackNavigator<RootStackParams>();
 *
 * function App() {
 *   return (
 *     <NavigationContainer>
 *       <Stack.Navigator initialRouteName="Home">
 *         <Stack.Screen name="Home" component={HomeScreen} />
 *         <Stack.Screen name="Details" component={DetailsScreen} />
 *       </Stack.Navigator>
 *     </NavigationContainer>
 *   );
 * }
 */
export function createStackNavigator<ParamList extends RouteParamList>() {
  return Stack as typeof Stack & {
    Screen: <RouteName extends keyof ParamList & string>(
      props: StackScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };
}

/**
 * Creates a typed Tab navigator (React Navigation style API).
 *
 * @example
 * type TabParams = {
 *   Home: undefined;
 *   Settings: undefined;
 * };
 *
 * const Tab = createTabNavigator<TabParams>();
 *
 * function App() {
 *   return (
 *     <NavigationContainer>
 *       <Tab.Navigator>
 *         <Tab.Screen name="Home" component={HomeScreen} />
 *         <Tab.Screen name="Settings" component={SettingsScreen} />
 *       </Tab.Navigator>
 *     </NavigationContainer>
 *   );
 * }
 */
export function createTabNavigator<ParamList extends RouteParamList>() {
  return Tabs as typeof Tabs & {
    Screen: <RouteName extends keyof ParamList & string>(
      props: TabScreenProps<ParamList, RouteName>
    ) => JSX.Element | null;
  };
}

/**
 * @deprecated Use createStackNavigator and createTabNavigator instead.
 * Creates a typed router with Stack and Tabs navigators.
 */
export function createRouter<ParamList extends RouteParamList>() {
  return {
    Stack: createStackNavigator<ParamList>(),
    Tabs: createTabNavigator<ParamList>(),
  };
}
