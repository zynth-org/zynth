# TypeScript

`@zynth/router` is designed around typed route maps. Route names, params, screen registration, and navigation helper methods are inferred from the same `ParamList` type, which keeps route declarations and screen usage aligned across the application.

The package exports generic navigator factories and public types so screens, helpers, and reusable abstractions can stay strongly typed without duplicating route definitions.

## Basic usage

```tsx
import { createStackNavigator, createTabNavigator } from "@zynth/router";

type RootStackParams = {
  Home: undefined;
  Profile: { userId: string };
  Settings: { section?: string };
};

const Stack = createStackNavigator<RootStackParams>();
```

## Important and advanced examples

### Typed navigation and route access

```tsx
import { useNavigation, useRoute } from "@zynth/router";
import { Text } from "@zynth/components";

function ProfileScreen() {
  const navigation = useNavigation<RootStackParams>();
  const route = useRoute<RootStackParams, "Profile">();

  navigation.navigate("Settings", { section: "privacy" });

  const userId = () => route.params().userId;

  return <Text>{userId()}</Text>;
}
```

### Typed screen props

```tsx
import type { ScreenComponentProps } from "@zynth/router";
import { Text } from "@zynth/components";

type ProfileProps = ScreenComponentProps<RootStackParams, "Profile">;

function ProfileScreen(props: ProfileProps) {
  const userId = () => props.route.params().userId;

  return <Text>{userId()}</Text>;
}
```

### Reusable screen component typing

```tsx
import type { ScreenComponent } from "@zynth/router";
import { Text } from "@zynth/components";

const SettingsScreen: ScreenComponent<RootStackParams, "Settings"> = (props) => {
  props.navigation.setOptions({ title: "Settings" });
  return <Text>Settings</Text>;
};
```

### Typed screen options

```tsx
import type { ScreenOptions } from "@zynth/router";

const detailsOptions: ScreenOptions = {
  title: "Details",
  animation: "push",
  presentation: "push",
};
```

### Separate types per navigator level

```tsx
type AppTabs = {
  Feed: undefined;
  Profile: undefined;
};

type FeedStack = {
  FeedHome: undefined;
  Article: { slug: string };
};

const Tabs = createTabNavigator<AppTabs>();
const Feed = createStackNavigator<FeedStack>();
```

## Special cases and unusual features

- Routes without params should use `undefined`, not `{}`.
- Optional params should remain optional inside the object type rather than replacing the whole route type with `undefined`.
- `useParams()` is typed from the params object it returns. When the full route map is needed, prefer `useRoute()` and `useNavigation()`.
- `Screen`, `Navigator`, and navigation helper methods all derive their route-name types from the same `ParamList`, so changing the route map updates the rest of the API surface automatically.

## API Reference

### Core route typing

- `RouteParamList = Record<string, object | undefined>`
- `RouteNode<ParamList>`
- `NavigationState<ParamList>`

### Screen typing

- `ScreenComponentProps<ParamList, RouteName>`
- `ScreenComponent<ParamList, RouteName>`
- `RouteContextValue<ParamList, RouteName>`

### Navigation typing

- `NavigationHelpers<ParamList>`
- `RouterAction<ParamList>`
- `NavigateAction<ParamList>`
- `PushAction<ParamList>`
- `ReplaceAction<ParamList>`
- `ResetAction<ParamList>`

### Navigator typing

- `StackScreenProps<ParamList, RouteName>`
- `TabScreenProps<ParamList, RouteName>`
- `BottomSheetScreenProps<ParamList, RouteName>`
