# Nested Navigators

Nested navigators allow you to compose different navigation patterns together, such as having a Stack Navigator inside each tab of a Tab Navigator.

## Overview

Nesting navigators is a core pattern in React Navigation and `@zynth/router`. Common use cases include:

- **Stack in Tabs** - Each tab has its own navigation stack
- **Tabs in Stack** - Modal or authentication flows that sit above tabs
- **Multiple Levels** - Complex hierarchies like tabs → stacks → modals

## Stack Navigator Inside Tabs

The most common pattern is having each tab contain its own stack of screens.

### Example: E-commerce App

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  createTabNavigator,
  useNavigation,
} from "@zynth/router";

// Define tab-level routes
type AppTabParams = {
  HomeTab: undefined;
  SearchTab: undefined;
  ProfileTab: undefined;
};

// Define stack routes for each tab
type HomeStackParams = {
  HomeMain: undefined;
  ProductDetails: { productId: string };
  Cart: undefined;
};

type SearchStackParams = {
  SearchMain: undefined;
  SearchResults: { query: string };
};

type ProfileStackParams = {
  ProfileMain: undefined;
  Settings: undefined;
  EditProfile: undefined;
};

// Create navigators
const Tabs = createTabNavigator<AppTabParams>();
const HomeStack = createStackNavigator<HomeStackParams>();
const SearchStack = createStackNavigator<SearchStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

// Home tab with nested stack
function HomeTabScreen() {
  return (
    <HomeStack.Navigator initialRouteName="HomeMain">
      <HomeStack.Screen
        name="HomeMain"
        component={HomeMainScreen}
        options={{ title: "Home" }}
      />
      <HomeStack.Screen
        name="ProductDetails"
        component={ProductDetailsScreen}
        options={{ title: "Product" }}
      />
      <HomeStack.Screen
        name="Cart"
        component={CartScreen}
        options={{
          title: "Shopping Cart",
          presentation: "modal",
        }}
      />
    </HomeStack.Navigator>
  );
}

// Search tab with nested stack
function SearchTabScreen() {
  return (
    <SearchStack.Navigator initialRouteName="SearchMain">
      <SearchStack.Screen
        name="SearchMain"
        component={SearchMainScreen}
        options={{ title: "Search" }}
      />
      <SearchStack.Screen
        name="SearchResults"
        component={SearchResultsScreen}
        options={{ title: "Results" }}
      />
    </SearchStack.Navigator>
  );
}

// Profile tab with nested stack
function ProfileTabScreen() {
  return (
    <ProfileStack.Navigator initialRouteName="ProfileMain">
      <ProfileStack.Screen
        name="ProfileMain"
        component={ProfileMainScreen}
        options={{ title: "Profile" }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <ProfileStack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ title: "Edit Profile" }}
      />
    </ProfileStack.Navigator>
  );
}

// Root app with tabs
export function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator>
        <Tabs.Screen
          name="HomeTab"
          component={HomeTabScreen}
          options={{
            tab: { label: "Home", icon: HomeIcon },
          }}
        />
        <Tabs.Screen
          name="SearchTab"
          component={SearchTabScreen}
          options={{
            tab: { label: "Search", icon: SearchIcon },
          }}
        />
        <Tabs.Screen
          name="ProfileTab"
          component={ProfileTabScreen}
          options={{
            tab: { label: "Profile", icon: ProfileIcon },
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```

## Navigation Between Nested Navigators

### Navigate Within Current Stack

From a screen inside a tab's stack, navigate within that stack:

```tsx
function HomeMainScreen() {
  const navigation = useNavigation<HomeStackParams>();

  return (
    <Pressable
      onPress={() =>
        navigation.navigate("ProductDetails", { productId: "123" })
      }
    >
      <Text>View Product</Text>
    </Pressable>
  );
}
```

### Navigate to Different Tab

From inside a nested stack, navigate to a different tab:

```tsx
function ProductDetailsScreen() {
  const stackNav = useNavigation<HomeStackParams>(); // Current stack
  const tabNav = useNavigation<AppTabParams>(); // Parent tabs

  return (
    <View>
      <Pressable onPress={() => stackNav.navigate("Cart")}>
        <Text>Add to Cart</Text>
      </Pressable>

      <Pressable onPress={() => tabNav.navigate("ProfileTab")}>
        <Text>Go to Profile</Text>
      </Pressable>
    </View>
  );
}
```

### Open Modal from Nested Screen

```tsx
function HomeMainScreen() {
  const navigation = useNavigation<HomeStackParams>();

  return (
    <Pressable onPress={() => navigation.navigate("Cart")}>
      <Text>Open Cart</Text>
    </Pressable>
  );
}
```

## Tab Navigator Inside Stack

Less common, but useful for authentication flows or onboarding:

```tsx
type RootStackParams = {
  Onboarding: undefined;
  MainApp: undefined;
  Settings: undefined;
};

type MainTabParams = {
  Home: undefined;
  Search: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParams>();
const MainTabs = createTabNavigator<MainTabParams>();

function MainTabsScreen() {
  return (
    <MainTabs.Navigator>
      <MainTabs.Screen name="Home" component={HomeScreen} />
      <MainTabs.Screen name="Search" component={SearchScreen} />
      <MainTabs.Screen name="Profile" component={ProfileScreen} />
    </MainTabs.Navigator>
  );
}

export function App() {
  return (
    <NavigationContainer>
      <RootStack.Navigator initialRouteName="Onboarding">
        <RootStack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="MainApp"
          component={MainTabsScreen}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ presentation: "modal" }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
```

## Multiple Levels of Nesting

You can nest as deeply as needed:

```tsx
// Level 1: Root Stack (for auth flows)
const RootStack = createStackNavigator<RootStackParams>();

// Level 2: Main Tabs
const MainTabs = createTabNavigator<MainTabParams>();

// Level 3: Stack per tab
const HomeStack = createStackNavigator<HomeStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

// Level 4: Nested modals or additional flows
const CheckoutStack = createStackNavigator<CheckoutStackParams>();
```

## Best Practices

### 1. Keep Route Types Separate

Define separate types for each navigator level:

```tsx
// ❌ Don't merge all routes
type AllRoutes = {
  Home: undefined;
  Details: { id: string };
  Profile: undefined;
  Settings: undefined;
};

// ✅ Separate by navigator
type HomeStackParams = {
  HomeMain: undefined;
  Details: { id: string };
};

type ProfileStackParams = {
  ProfileMain: undefined;
  Settings: undefined;
};
```

### 2. Use Descriptive Names

Append "Tab", "Stack", "Main" to clarify structure:

```tsx
// Tab-level screen
function HomeTabScreen() { ... }

// Main screen within tab's stack
function HomeMainScreen() { ... }

// Nested detail screen
function ProductDetailsScreen() { ... }
```

### 3. Handle Navigation Correctly

Use the appropriate navigator's type:

```tsx
function NestedScreen() {
  // Navigate within current stack
  const stackNav = useNavigation<HomeStackParams>();

  // Navigate to different tab
  const tabNav = useNavigation<AppTabParams>();

  return (
    <View>
      <Pressable onPress={() => stackNav.push("Details", { id: "1" })}>
        <Text>Stack Navigation</Text>
      </Pressable>

      <Pressable onPress={() => tabNav.navigate("Profile")}>
        <Text>Tab Navigation</Text>
      </Pressable>
    </View>
  );
}
```

### 4. Hide Tab Bar When Needed

Hide the tab bar for deeper screens:

```tsx
<HomeStack.Screen
  name="ProductDetails"
  component={ProductDetailsScreen}
  options={{
    title: "Product Details",
    // Tab bar automatically hidden for nested stacks
  }}
/>
```

### 5. Manage State Properly

Each navigator maintains its own state:

- Tab switches preserve stack state
- Going back to a tab shows its last screen
- Use `reset()` to clear a tab's stack if needed

```tsx
function LogoutButton() {
  const navigation = useNavigation<HomeStackParams>();

  const handleLogout = () => {
    // Reset the stack to initial state
    navigation.reset({
      index: 0,
      routes: [{ name: "HomeMain" }],
    });
  };

  return (
    <Pressable onPress={handleLogout}>
      <Text>Logout</Text>
    </Pressable>
  );
}
```

## Complete Example: Social Media App

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  createTabNavigator,
  useNavigation,
} from "@zynth/router";

// Tab-level routes
type AppTabParams = {
  FeedTab: undefined;
  DiscoverTab: undefined;
  ProfileTab: undefined;
};

// Feed stack routes
type FeedStackParams = {
  FeedMain: undefined;
  PostDetails: { postId: string };
  Comments: { postId: string };
  UserProfile: { userId: string };
};

// Discover stack routes
type DiscoverStackParams = {
  DiscoverMain: undefined;
  HashtagFeed: { hashtag: string };
};

// Profile stack routes
type ProfileStackParams = {
  ProfileMain: undefined;
  Settings: undefined;
  EditProfile: undefined;
  Followers: undefined;
};

const Tabs = createTabNavigator<AppTabParams>();
const FeedStack = createStackNavigator<FeedStackParams>();
const DiscoverStack = createStackNavigator<DiscoverStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

// Feed Tab
function FeedTabScreen() {
  return (
    <FeedStack.Navigator>
      <FeedStack.Screen
        name="FeedMain"
        component={FeedMainScreen}
        options={{ title: "Feed" }}
      />
      <FeedStack.Screen
        name="PostDetails"
        component={PostDetailsScreen}
        options={{ title: "Post" }}
      />
      <FeedStack.Screen
        name="Comments"
        component={CommentsScreen}
        options={{ title: "Comments" }}
      />
      <FeedStack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{ title: "Profile" }}
      />
    </FeedStack.Navigator>
  );
}

// Discover Tab
function DiscoverTabScreen() {
  return (
    <DiscoverStack.Navigator>
      <DiscoverStack.Screen
        name="DiscoverMain"
        component={DiscoverMainScreen}
        options={{ title: "Discover" }}
      />
      <DiscoverStack.Screen
        name="HashtagFeed"
        component={HashtagFeedScreen}
        options={{ title: "Hashtag" }}
      />
    </DiscoverStack.Navigator>
  );
}

// Profile Tab
function ProfileTabScreen() {
  return (
    <ProfileStack.Navigator>
      <ProfileStack.Screen
        name="ProfileMain"
        component={ProfileMainScreen}
        options={{ title: "Profile" }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <ProfileStack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ title: "Edit Profile" }}
      />
      <ProfileStack.Screen
        name="Followers"
        component={FollowersScreen}
        options={{ title: "Followers" }}
      />
    </ProfileStack.Navigator>
  );
}

// Root App
export function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator>
        <Tabs.Screen
          name="FeedTab"
          component={FeedTabScreen}
          options={{
            tab: { label: "Feed", icon: FeedIcon },
          }}
        />
        <Tabs.Screen
          name="DiscoverTab"
          component={DiscoverTabScreen}
          options={{
            tab: { label: "Discover", icon: DiscoverIcon },
          }}
        />
        <Tabs.Screen
          name="ProfileTab"
          component={ProfileTabScreen}
          options={{
            tab: { label: "Profile", icon: ProfileIcon },
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```

## Next Steps

- Master [Navigation Hooks](./hooks.md) for advanced navigation
- Learn about [TypeScript](./typescript.md) integration
- Check the [API Reference](./api-reference.md)
