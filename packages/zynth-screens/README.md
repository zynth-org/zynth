# Screens

`@zynth/screens` provides the low-level screen primitives used to render navigation stacks, tab content, and sheet-style flows in Zynth applications.

On iOS and Android, these primitives bridge to native containers and transition handling. `@zynth/router` uses them to render stack and tab navigators while keeping navigation state in JavaScript. On Web, the package provides a partial adapter built from DOM containers and CSS-based transitions.

Most applications use this package through `@zynth/router`, but the primitives are also available for custom navigation systems that need direct control over active screens, transition styles, and native lifecycle events.

## Basic usage

### Stack-style container

```tsx
import { Screen, ScreenContainer } from "@zynth/screens";

export function App(props: { route: "home" | "details" }) {
  return (
    <ScreenContainer>
      <Screen screenKey="home" active={props.route === "home"} animation="none">
        <HomeScreen />
      </Screen>

      <Screen
        screenKey="details"
        active={props.route === "details"}
        animation="push"
      >
        <DetailsScreen />
      </Screen>
    </ScreenContainer>
  );
}
```

### Router integration

`@zynth/router` renders stack screens through `ScreenContainer` and `Screen`, and tab content through `ScreenTabsContainer`.

```tsx
import { NavigationContainer, createStackNavigator } from "@zynth/router";

type RootStackParams = {
  Home: undefined;
  Details: { itemId: string };
};

const Stack = createStackNavigator<RootStackParams>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "Overview" }}
        />
        <Stack.Screen
          name="Details"
          component={DetailsScreen}
          options={{ animation: "push", title: "Item" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Advanced examples

### Native lifecycle events

`Screen` exposes native lifecycle callbacks for appearance and disappearance. These are useful when the screen primitive is used directly.

```tsx
import { Screen, ScreenContainer } from "@zynth/screens";

export function Flow(props: { active: "feed" | "profile" }) {
  return (
    <ScreenContainer>
      <Screen
        screenKey="feed"
        active={props.active === "feed"}
        animation="none"
        onDidAppear={() => {
          console.log("Feed appeared");
        }}
      >
        <FeedScreen />
      </Screen>

      <Screen
        screenKey="profile"
        active={props.active === "profile"}
        animation="fade"
        onWillDisappear={() => {
          console.log("Profile will disappear");
        }}
      >
        <ProfileScreen />
      </Screen>
    </ScreenContainer>
  );
}
```

### Covered screens for modal presentation

Use `covered` when a screen remains visible underneath a modal-style transition.

```tsx
import { Screen, ScreenContainer } from "@zynth/screens";

export function ModalFlow(props: { step: "list" | "compose" }) {
  const showingCompose = () => props.step === "compose";

  return (
    <ScreenContainer>
      <Screen
        screenKey="list"
        active={true}
        covered={showingCompose()}
        animation="none"
      >
        <MessageListScreen />
      </Screen>

      <Screen screenKey="compose" active={showingCompose()} animation="modal">
        <ComposeScreen />
      </Screen>
    </ScreenContainer>
  );
}
```

### Native header integration with `@zynth/router`

In stack navigation, router screen options are mapped to `Screen` header props. On iOS this drives the native navigation bar. On Android and Web, the router currently renders the stack header in JavaScript.

```tsx
<Stack.Screen
  name="Profile"
  component={ProfileScreen}
  options={{
    title: "Profile",
    largeTitle: true,
    headerStyle: "liquidGlass",
    headerTintColor: "#111827",
    headerTitleColor: "#111827",
    headerBackgroundColor: "#ffffff",
    headerRightButton: {
      title: "Edit",
      style: "done",
      onPress: () => {
        console.log("Edit profile");
      },
    },
  }}
/>
```

### Native tab containers

`ScreenTabsContainer` manages the content area for tab navigation. `@zynth/router` uses it to preserve tab content and switch the selected tab index.

```tsx
import { ScreenTabsContainer } from "@zynth/screens";
import { createSignal } from "solid-js";

export function TabsExample() {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  return (
    <ScreenTabsContainer
      selectedIndex={selectedIndex()}
      tabBarOptions={{
        activeTintColor: "#2563eb",
        inactiveTintColor: "#6b7280",
        showLabels: true,
      }}
      tabBarItems={[
        {
          key: "feed",
          routeName: "Feed",
          label: "Feed",
          icon: { type: "descriptor", systemName: "newspaper" },
        },
        {
          key: "settings",
          routeName: "Settings",
          label: "Settings",
          icon: { type: "descriptor", systemName: "gearshape" },
        },
      ]}
      nativeTabBarEnabled={true}
      onNativeTabSelect={setSelectedIndex}
    >
      <FeedScreen />
      <SettingsScreen />
    </ScreenTabsContainer>
  );
}
```

### Sheet-style navigation

`ScreenSheetContainer` is the container used by `@zynth/router` for iOS bottom-sheet flows. The router’s bottom-sheet navigator builds on this primitive together with `@zynth/components` bottom sheet presentation.

BottomSheet navigation is currently experimental and unstable.

```tsx
import { Screen, ScreenSheetContainer } from "@zynth/screens";

export function SheetStack(props: { route: "filters" | "sort" }) {
  return (
    <ScreenSheetContainer>
      <Screen
        screenKey="filters"
        active={props.route === "filters"}
        animation="none"
      >
        <FiltersScreen />
      </Screen>

      <Screen
        screenKey="sort"
        active={props.route === "sort"}
        animation="sheet-blur"
      >
        <SortScreen />
      </Screen>
    </ScreenSheetContainer>
  );
}
```

## Special cases and unusual features

- Router stack navigation uses `ScreenContainer` and `Screen` directly. The first route is rendered without animation, and later transitions are chosen from router screen options such as `animation`, `presentation`, and `animationEnabled`.
- Router tab navigation does not wrap each tab in `Screen`. It uses `ScreenTabsContainer` to manage selected content while preserving route state and tab history.
- Router bottom-sheet navigation uses `ScreenSheetContainer` on iOS and `ScreenContainer` on Android. BottomSheet navigation is currently experimental and unstable.
- `gestureEnabled` is wired to native back-swipe handling on iOS stack screens. When disabled, the interactive back gesture is disabled for that screen.
- `headerOptions` are primarily a native iOS feature. Router maps stack screen options such as `title`, `subtitle`, `largeTitle`, `headerTintColor`, `headerBackgroundColor`, `headerBlurEffect`, `headerStyle`, `headerBackVisible`, and native right-side accessories onto this API.
- `covered` is relevant when a screen should remain visually behind another screen, such as modal presentation. Router computes this automatically for modal-style stack transitions.
- Supported screen animation values are `push`, `modal`, `sheet-blur`, `zoom`, `fade`, and `none`.
- On iOS, the native layer includes dedicated implementations for push, modal, blur-sheet, zoom, and fade transitions.
- On Android, push, modal, zoom, fade, and none are implemented natively. The package export includes `sheet-blur`, but Android uses its standard native transition path for sheet-style flows.
- Web support is partial. `Screen`, `ScreenContainer`, and `ScreenTabsContainer` are available with CSS-based transitions. Native headers, native tab bars, and sheet-specific containers do not have the same behavior as iOS and Android.
- In direct usage, `screenKey` should stay stable for the lifetime of a route. Router generates and maintains these keys automatically.

## API reference

### Components

#### `ScreenContainer(props)`

Container for stack-like screen flows.

- `style?: Style`
- `children?: JSX.Element`

#### `ScreenSheetContainer(props)`

Container for sheet-style screen flows.

- `style?: Style`
- `children?: JSX.Element`

#### `ScreenTabsContainer(props)`

Container for tab content and optional native tab bar metadata.

- `selectedIndex: number`
- `tabAnimation?: ScreenAnimationType`
- `tabBarOptions?: ScreenTabBarOptions`
- `tabBarItems?: ScreenTabBarItemDescriptor[]`
- `nativeTabBarEnabled?: boolean`
- `onNativeTabSelect?: (index: number) => void`
- `onNativeTabMount?: (event: { surfaceId: number; routeKey: string; active: boolean }) => void`
- `onNativeTabUpdate?: (event: { surfaceId: number; routeKey: string; active?: boolean }) => void`
- `style?: Style`
- `children?: JSX.Element`

#### `Screen(props)`

Primitive representing a single screen in a container.

- `screenKey: string`
- `active: boolean`
- `covered?: boolean`
- `animation?: ScreenAnimationType`
- `gestureEnabled?: boolean`
- `headerOptions?: ScreenHeaderOptions`
- `onNativeBack?: () => void`
- `onNativeHeaderRightPress?: () => void`
- `onWillAppear?: () => void`
- `onDidAppear?: () => void`
- `onWillDisappear?: () => void`
- `onDidDisappear?: () => void`
- `style?: Style`
- `children?: JSX.Element`

### Types

#### `ScreenAnimationType`

- `"push"`
- `"modal"`
- `"sheet-blur"`
- `"zoom"`
- `"fade"`
- `"none"`

#### `ScreenHeaderOptions`

- `title?: string`
- `subtitle?: string`
- `prefersLargeTitle?: boolean`
- `headerStyle?: ScreenHeaderStyle`
- `visible?: boolean`
- `backVisible?: boolean`
- `tintColor?: string`
- `titleColor?: string`
- `backgroundColor?: string`
- `transparent?: boolean`
- `shadowVisible?: boolean`
- `blurEffect?: ScreenHeaderBlurEffect`
- `userInterfaceStyle?: ScreenUserInterfaceStyle`
- `rightButton?: ScreenHeaderButtonOptions`
- `rightAccessory?: ScreenHeaderAccessoryDescriptor`

#### `ScreenHeaderStyle`

- `"default"`
- `"liquidGlass"`

#### `ScreenHeaderBlurEffect`

- `"systemUltraThin"`
- `"systemThin"`
- `"systemChromatic"`

#### `ScreenUserInterfaceStyle`

- `"dark"`
- `"light"`
- `"system"`

#### `ScreenHeaderButtonOptions`

- `title?: string`
- `style?: "plain" | "done" | "icon" | "prominent"`
- `systemItem?: "close"`

#### `ScreenTabBarOptions`

- `visible?: boolean`
- `backgroundColor?: string`
- `activeIndicatorColor?: string`
- `activeTintColor?: string`
- `inactiveTintColor?: string`
- `showLabels?: boolean`
- `blurEffectStyle?: "systemUltraThinMaterial" | "systemThinMaterial" | "systemChromeMaterial" | "systemMaterial" | "none"`

#### `ScreenTabBarItemDescriptor`

- `key: string`
- `routeName: string`
- `label?: string`
- `badge?: string | number`
- `badgeColor?: string`
- `hidden?: boolean`
- `icon?: ScreenTabBarIcon`

#### `ScreenTabBarIcon`

Union of:

- `{ type: "descriptor"; systemName?: string; assetName?: string; uri?: string; glyph?: string; glyphFontFamily?: string; glyphFontSize?: number }`
- `{ type: "surface"; routeKey: string }`

### Router-related helper types

#### `RouteDefinition<Params>`

- `name: string`
- `params?: Params`

#### `NavigationState<ParamList>`

- `routes: RouteDefinition<ParamList[keyof ParamList]>[]`
- `index: number`
