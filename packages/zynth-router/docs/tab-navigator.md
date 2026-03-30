# Tab Navigator

`createTabNavigator()` builds a typed tab router where each screen is registered once and selected by route name. Tabs can customize labels, badges, icons, header behavior, and the tab bar itself while preserving a tab-selection history for back navigation.

The tab navigator is commonly used for top-level application sections such as feed, search, profile, or settings areas, and it composes naturally with nested stacks.

## Basic usage

```tsx
import { createTabNavigator } from "@zynth/router";

type TabParams = {
  Home: undefined;
  Search: undefined;
  Profile: undefined;
};

const Tabs = createTabNavigator<TabParams>();

function AppTabs() {
  return (
    <Tabs.Navigator initialRouteName="Home">
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ tab: { label: "Home" } }}
      />
      <Tabs.Screen
        name="Search"
        component={SearchScreen}
        options={{ tab: { label: "Search" } }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tab: { label: "Profile" } }}
      />
    </Tabs.Navigator>
  );
}
```

## Important and advanced examples

### Configuring the tab bar

```tsx
<Tabs.Navigator
  tabBarOptions={{
    tabBarBackgroundColor: "#ffffff",
    tabBarActiveIndicatorColor: "#111827",
    tabBarActiveTintColor: "#111827",
    tabBarInactiveTintColor: "#6b7280",
    tabBarShowLabels: true,
  }}
>
  <Tabs.Screen
    name="Home"
    component={HomeScreen}
    options={{
      title: "Home",
      tab: {
        label: "Home",
        icon: { systemName: "house" },
      },
    }}
  />
</Tabs.Navigator>
```

### Using icon factories

```tsx
import { Text } from "@zynth/components";

const SearchIcon = (props: { active: boolean; color: string }) => (
  <Text
    style={{
      color: props.color,
      fontSize: 18,
      fontWeight: props.active ? "700" : "500",
    }}
  >
    In
  </Text>
);

<Tabs.Screen
  name="Search"
  component={SearchScreen}
  options={{
    tab: {
      label: "Search",
      icon: SearchIcon,
      badge: 4,
      badgeColor: "#dc2626",
    },
  }}
/>;
```

### Custom tab bar component

```tsx
import type { TabBarProps } from "@zynth/router";
import { Button, Text, View } from "@zynth/components";

function CustomTabBar(props: TabBarProps) {
  return (
    <View style={{ flexDirection: "row", padding: 12 }}>
      {props.state().routes.map((route, index) => {
        const descriptor = props.descriptors[route.key];
        const selected = props.state().index === index;

        return (
          <Button
            variant="ghost"
            onPress={() => props.navigation.navigate(route.name)}
          >
            <Text>{descriptor.options.tab?.label ?? route.name}</Text>
            <Text>{selected ? " selected" : ""}</Text>
          </Button>
        );
      })}
    </View>
  );
}

<Tabs.Navigator tabBar={CustomTabBar}>{/* screens */}</Tabs.Navigator>;
```

## Special cases and unusual features

- Tabs do not push duplicate entries. `push()` and `replace()` resolve to tab selection behavior.
- `goBack()` inside a tab navigator moves through tab history when more than one tab has been selected.
- On iOS and Android, the router can integrate with native tab presentation. On web and non-native contexts, the default tab bar is rendered in JavaScript.
- Tab icons can be defined as descriptors or as render functions. Descriptors are useful when the icon should map cleanly to native tab containers.

## API Reference

### `createTabNavigator<ParamList>()`

Returns a typed object with:

- `Navigator`
- `Screen`

### `Tabs.Navigator`

Props:

- `id?: string`
- `initialRouteName?: string`
- `screenOptions?: ScreenOptions | (() => ScreenOptions | undefined)`
- `tabBarOptions?: TabBarOptions`
- `tabBar?: (props: TabBarProps) => JSX.Element`
- `children?: JSX.Element`

### `Tabs.Screen`

Props:

- `name: RouteName`
- `component: ScreenComponent<ParamList, RouteName>`
- `options?: ScreenOptions | (() => ScreenOptions | undefined)`
- `initialParams?: ParamList[RouteName]`

### `TabOptions`

- `label?: string`
- `icon?: TabIconDescriptor | TabIconFactory`
- `badge?: string | number`
- `badgeColor?: string`
- `hidden?: boolean`

### `TabIconDescriptor`

- `systemName?: string`
- `assetName?: string`
- `uri?: string`
- `glyph?: string`
- `glyphFontFamily?: string`
- `glyphFontSize?: number`

### `TabBarOptions`

- `tabBarVisible?: boolean`
- `tabBarBackgroundColor?: string`
- `tabBarActiveIndicatorColor?: string`
- `tabBarActiveTintColor?: string`
- `tabBarInactiveTintColor?: string`
- `tabBarShowLabels?: boolean`
- `tabBarStyle?: Record<string, unknown>`
