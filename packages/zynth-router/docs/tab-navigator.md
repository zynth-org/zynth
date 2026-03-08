# Tab Navigator

The Tab Navigator displays a tab bar at the bottom of the screen, allowing users to switch between different sections of your app.

## Creating a Tab Navigator

```tsx
import { createTabNavigator } from "@zynth/router";

type TabParams = {
  Home: undefined;
  Search: { query?: string };
  Profile: { userId?: string };
};

const Tabs = createTabNavigator<TabParams>();
```

## Basic Usage

```tsx
<Tabs.Navigator initialRouteName="Home">
  <Tabs.Screen
    name="Home"
    component={HomeScreen}
    options={{
      tab: { label: "Home", icon: HomeIcon },
    }}
  />
  <Tabs.Screen
    name="Search"
    component={SearchScreen}
    options={{
      tab: { label: "Search", icon: SearchIcon },
    }}
  />
  <Tabs.Screen
    name="Profile"
    component={ProfileScreen}
    options={{
      tab: { label: "Profile", icon: ProfileIcon },
    }}
  />
</Tabs.Navigator>
```

## Navigator Props

### `initialRouteName`

The tab to show when the navigator first loads.

```tsx
<Tabs.Navigator initialRouteName="Home">{/* ... */}</Tabs.Navigator>
```

### `screenOptions`

Default options applied to all tabs.

```tsx
<Tabs.Navigator
  screenOptions={{
    headerShown: true,
    headerBackgroundColor: "#1d4ed8",
    headerTintColor: "#ffffff",
  }}
>
  {/* ... */}
</Tabs.Navigator>
```

### `tabBarOptions`

Options for customizing the tab bar appearance.

```tsx
<Tabs.Navigator
  tabBarOptions={{
    tabBarBackgroundColor: "#1c1226",
    tabBarActiveTintColor: "#42d81d",
    tabBarInactiveTintColor: "#94a3b8",
    tabBarShowLabels: true,
    tabBarVisible: true,
  }}
>
  {/* ... */}
</Tabs.Navigator>
```

#### Tab Bar Options

| Option                    | Type      | Default     | Description              |
| ------------------------- | --------- | ----------- | ------------------------ |
| `tabBarBackgroundColor`   | `string`  | `"#ffffff"` | Tab bar background color |
| `tabBarActiveTintColor`   | `string`  | `"#007AFF"` | Active tab color         |
| `tabBarInactiveTintColor` | `string`  | `"#8E8E93"` | Inactive tab color       |
| `tabBarShowLabels`        | `boolean` | `true`      | Show/hide tab labels     |
| `tabBarVisible`           | `boolean` | `true`      | Show/hide entire tab bar |

### `tabBar`

Custom tab bar component.

```tsx
<Tabs.Navigator tabBar={(props) => <CustomTabBar {...props} />}>
  {/* ... */}
</Tabs.Navigator>
```

## Screen Options

Each tab screen supports both general options and tab-specific options:

```tsx
<Tabs.Screen
  name="Home"
  component={HomeScreen}
  options={{
    // General options
    title: "Welcome",
    headerShown: true,
    headerBackgroundColor: "#1d4ed8",
    headerTintColor: "#ffffff",

    // Tab-specific options
    tab: {
      label: "Home",
      icon: HomeIcon,
      badge: "3",
      badgeColor: "#FF3B30",
    },
  }}
/>
```

### Tab Options

| Option       | Type                                | Description                            |
| ------------ | ----------------------------------- | -------------------------------------- |
| `label`      | `string`                            | Tab label text                         |
| `icon`       | `(props: IconProps) => JSX.Element` | Tab icon component                     |
| `badge`      | `string \| number`                  | Badge value (e.g., notification count) |
| `badgeColor` | `string`                            | Badge background color                 |

## Tab Icons

Icons receive props indicating the tab's active state:

```tsx
type IconProps = {
  active: boolean;
  color: string;
};

function HomeIcon(props: IconProps) {
  return (
    <Text
      style={{
        fontSize: 24,
        color: props.color,
        fontWeight: props.active ? "700" : "400",
      }}
    >
      🏠
    </Text>
  );
}

<Tabs.Screen
  name="Home"
  component={HomeScreen}
  options={{
    tab: {
      label: "Home",
      icon: HomeIcon,
    },
  }}
/>;
```

Using a glyph factory:

```tsx
const renderIcon = (glyph: string) => (props: IconProps) =>
  (
    <Text
      style={{
        fontSize: 20,
        color: props.color,
      }}
    >
      {glyph}
    </Text>
  );

<Tabs.Screen
  name="Home"
  component={HomeScreen}
  options={{
    tab: {
      label: "Home",
      icon: renderIcon("H"),
    },
  }}
/>;
```

## Navigation Methods

Use `useNavigation` to navigate between tabs:

```tsx
import { useNavigation } from "@zynth/router";

function MyScreen() {
  const navigation = useNavigation<TabParams>();

  // Navigate to a tab
  navigation.navigate("Search", { query: "products" });

  // Go back in tab history
  navigation.goBack();

  // Update current tab's params
  navigation.setParams({ query: "new-query" });

  // Update current tab's options
  navigation.setOptions({ title: "New Title" });
}
```

## Tab Badges

Display notification counts or status indicators:

```tsx
<Tabs.Screen
  name="Notifications"
  component={NotificationsScreen}
  options={{
    tab: {
      label: "Notifications",
      icon: BellIcon,
      badge: "5",
      badgeColor: "#FF3B30",
    },
  }}
/>
```

Dynamic badges using signals:

```tsx
function App() {
  const [unreadCount, setUnreadCount] = createSignal(0);

  return (
    <Tabs.Navigator>
      <Tabs.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tab: {
            label: "Messages",
            icon: MessageIcon,
            badge: unreadCount() > 0 ? String(unreadCount()) : undefined,
          },
        }}
      />
    </Tabs.Navigator>
  );
}
```

## Custom Tab Bar

Create a fully custom tab bar by providing a `tabBar` prop:

```tsx
import type { TabBarProps } from "@zynth/router";
import { For, Show } from "solid-js";
import { View, Text, Pressable } from "@zynth/components";

function CustomTabBar(props: TabBarProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "#000",
        paddingBottom: 20,
        paddingTop: 10,
      }}
    >
      <For each={props.state().routes}>
        {(route, index) => {
          const isActive = () => index() === props.state().index;
          const descriptor = props.descriptors[route.key];
          const options = descriptor?.options;
          const label = options?.tab?.label ?? route.name;

          return (
            <Pressable
              onPress={() => props.navigation.navigate(route.name)}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 8,
              }}
            >
              <Show when={options?.tab?.icon}>
                {(Icon) => (
                  <Icon()
                    active={isActive()}
                    color={isActive() ? "#007AFF" : "#8E8E93"}
                  />
                )}
              </Show>
              <Text
                style={{
                  fontSize: 12,
                  color: isActive() ? "#007AFF" : "#8E8E93",
                  marginTop: 4,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        }}
      </For>
    </View>
  );
}

<Tabs.Navigator tabBar={(props) => <CustomTabBar {...props} />}>
  {/* ... */}
</Tabs.Navigator>
```

## Hiding Tab Bar

Hide the tab bar on specific screens:

```tsx
// Hide tab bar for the entire navigator
<Tabs.Navigator tabBarOptions={{ tabBarVisible: false }}>
  {/* ... */}
</Tabs.Navigator>;

// Or hide it programmatically
function MyScreen() {
  const navigation = useNavigation();

  createEffect(() => {
    navigation.setOptions({
      tabBarVisible: false,
    });
  });
}
```

## Complete Example

```tsx
import {
  NavigationContainer,
  createTabNavigator,
  useNavigation,
} from "@zynth/router";
import { View, Text, Pressable } from "@zynth/components";
import { createSignal } from "solid-js";

type AppTabParams = {
  Home: undefined;
  Search: { query?: string };
  Notifications: undefined;
  Profile: undefined;
};

const Tabs = createTabNavigator<AppTabParams>();

// Icon factory
const renderIcon =
  (glyph: string) => (props: { active: boolean; color: string }) =>
    <Text style={{ fontSize: 24, color: props.color }}>{glyph}</Text>;

function HomeScreen() {
  const navigation = useNavigation<AppTabParams>();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>Home</Text>
      <Pressable
        onPress={() => navigation.navigate("Search", { query: "test" })}
      >
        <Text>Go to Search</Text>
      </Pressable>
    </View>
  );
}

function SearchScreen() {
  const navigation = useNavigation<AppTabParams>();
  const [query, setQuery] = createSignal("");

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24 }}>Search</Text>
      <Text>Query: {query()}</Text>
    </View>
  );
}

function NotificationsScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24 }}>Notifications</Text>
    </View>
  );
}

function ProfileScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24 }}>Profile</Text>
    </View>
  );
}

export function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator
        initialRouteName="Home"
        tabBarOptions={{
          tabBarBackgroundColor: "#1c1226",
          tabBarActiveTintColor: "#42d81d",
          tabBarInactiveTintColor: "#94a3b8",
        }}
      >
        <Tabs.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: "Welcome",
            tab: {
              label: "Home",
              icon: renderIcon("🏠"),
            },
          }}
        />
        <Tabs.Screen
          name="Search"
          component={SearchScreen}
          options={{
            title: "Search",
            tab: {
              label: "Search",
              icon: renderIcon("🔍"),
            },
          }}
        />
        <Tabs.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{
            title: "Notifications",
            tab: {
              label: "Alerts",
              icon: renderIcon("🔔"),
              badge: "3",
              badgeColor: "#FF3B30",
            },
          }}
        />
        <Tabs.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            title: "Profile",
            tab: {
              label: "Profile",
              icon: renderIcon("👤"),
            },
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```

## Next Steps

- Learn about [Nested Navigators](./nested-navigators.md) to add stacks inside tabs
- Explore [Navigation Hooks](./hooks.md)
- Check out [Stack Navigator](./stack-navigator.md)
