# API Reference

This document lists the public exports from `@zynthjs/router` and the main types used to configure navigation trees, route state, screen options, and filesystem routing.

The package surface is split across containers, navigator factories, navigator components, hooks, contexts, metrics helpers, and public type exports.

## Basic usage

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  useNavigation,
} from "@zynthjs/router";
```

## Advanced examples

### Direct navigator exports

```tsx
import { NavigationContainer, Stack } from "@zynthjs/router";

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Details" component={DetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### Filesystem router exports

```tsx
import {
  NavigationContainer,
  createFileSystemRouter,
  type FileSystemRouterManifest,
} from "@zynthjs/router";

declare const manifest: FileSystemRouterManifest;

const Router = createFileSystemRouter(manifest);
```

## Special cases and unusual features

- `createRouter()` is still exported but the focused factories are `createStackNavigator()`, `createTabNavigator()`, and `createBottomSheetNavigator()`.
- BottomSheet navigation is experimental and unstable.
- `Stack`, `Tabs`, and `BottomSheet` are exported directly in addition to the typed factory helpers.
- `NavigationContext` and `RouteContext` are public for advanced composition scenarios.

## API Reference

### Components and factories

- `NavigationContainer`
- `createStackNavigator`
- `createTabNavigator`
- `createBottomSheetNavigator` (experimental)
- `createRouter`
- `createFileSystemRouter`
- `Stack`
- `StackNavigator`
- `StackScreen`
- `Tabs`
- `TabsNavigator`
- `TabScreen`
- `BottomSheet` (experimental)
- `BottomSheetNavigator` (experimental)
- `BottomSheetScreen` (experimental)

### Hooks

- `useNavigation`
- `useRoute`
- `createFocusEffect`
- `useIsFocused`
- `createBeforeRemove`
- `useNavigationState`
- `useScreenOptions`
- `useParams`
- `useRouteName`
- `useHeaderMetrics`
- `useTabBarMetrics`

### Context exports

- `NavigationContext`
- `useNavigationContext`
- `useNavigationContextUnsafe`
- `RouteContext`
- `useRouteContext`
- `useContainerContext`

### Route and state types

- `RouteParamList`
- `RouteNode`
- `NavigationState`

### Screen option types

- `ScreenOptions`
- `ScreenOptionsInput`
- `ScreenHeaderBlurEffect`
- `ScreenHeaderStyle`
- `ScreenUserInterfaceStyle`
- `ScreenPresentation`
- `ScreenAnimation`

### Tab and bottom-sheet types

Bottom-sheet types are experimental and unstable.

- `TabOptions`
- `TabIconDescriptor`
- `TabIconFactory`
- `TabBarOptions`
- `TabBarProps`
- `BottomSheetOptions`
- `BottomSheetNavigatorProps`
- `BottomSheetScreenProps`

### Navigation types

- `NavigationHelpers`
- `NavigationContainerProps`
- `RouterAction`
- `NavigateAction`
- `PushAction`
- `PopAction`
- `GoBackAction`
- `ReplaceAction`
- `ResetAction`
- `SetParamsAction`
- `SwitchTabAction`

### Screen component and navigator prop types

- `ScreenComponentProps`
- `ScreenComponent`
- `RouteContextValue`
- `StackNavigatorProps`
- `StackScreenProps`
- `TabsNavigatorProps`
- `TabScreenProps`

### Event types

- `FocusEffectCallback`
- `BeforeRemoveEvent`
- `BeforeRemoveHandler`

### Linking types

- `LinkingOptions`
- `LinkingConfig`
- `LinkingRouteConfig`

### Filesystem routing types

- `FileSystemScreenRoute`
- `FileSystemNavigatorRoute`
- `FileSystemRouteNode`
- `FileSystemRouterManifest`

### Context and metrics types

- `NavigationContextValue`
- `RouteContextData`
- `HeaderMetrics`
- `TabBarMetrics`
