# Android AppBar Quick Start Guide

## Basic Usage

### Adding a Header to Your Screen

```typescript
import { createRouter } from "@rune/android-router";

type AppRoutes = {
  Home: undefined;
  Details: { id: string };
};

const Router = createRouter<AppRoutes>();

// In your app:
<Router.Stack.Screen
  name="Home"
  component={HomeScreen}
  options={{
    title: "Home",
    headerShown: true, // default is true
    headerTintColor: "#ffffff",
    headerBackgroundColor: "#1a1a2e",
  }}
/>;
```

### All Available Header Options

```typescript
interface HeaderOptions {
  // Content
  title?: string; // Header title text
  subtitle?: string; // Subtitle below title

  // Visibility
  headerShown?: boolean; // Show/hide header (default: true)

  // Colors
  headerTintColor?: string; // Title, subtitle, and icon color
  headerBackgroundColor?: string; // Header background color
  headerTransparent?: boolean; // Make header transparent

  // Appearance
  headerShadowVisible?: boolean; // Show/hide shadow (default: true)
  userInterfaceStyle?: "light" | "dark" | "system"; // Theme
  largeTitle?: boolean; // iOS-style large title (future)

  // Advanced (future)
  headerBlurEffect?: "systemUltraThin" | "systemThin" | "systemChromatic";
  custom?: JSX.Element; // Custom header component
}
```

### Dynamic Header Updates

Use `navigation.setOptions()` to update the header after the screen mounts:

```typescript
import { useNavigation } from "@rune/android-router";

const MyScreen = () => {
  const navigation = useNavigation<AppRoutes>();
  const [isDark, setIsDark] = createSignal(true);

  const toggleTheme = () => {
    setIsDark(!isDark());
    navigation.setOptions({
      headerBackgroundColor: isDark() ? "#000000" : "#ffffff",
      headerTintColor: isDark() ? "#ffffff" : "#000000",
    });
  };

  return (
    <View>
      <Pressable onPress={toggleTheme}>
        <Text>Toggle Theme</Text>
      </Pressable>
    </View>
  );
};
```

### Hiding the Header

```typescript
<Router.Stack.Screen
  name="Fullscreen"
  component={FullscreenVideo}
  options={{
    headerShown: false,
  }}
/>
```

### Dynamic Options Based on Route Params

```typescript
<Router.Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={({ route }) => ({
    title: route.params?.name || "Details",
    headerTintColor: route.params?.color || "#000000",
  })}
/>
```

## Common Patterns

### Dark Mode Header

```typescript
options={{
  title: "Dark Mode",
  headerTintColor: "#e0e0e0",
  headerBackgroundColor: "#121212",
  headerShadowVisible: false,
}}
```

### Light Transparent Header

```typescript
options={{
  title: "Overlay",
  headerTransparent: true,
  headerTintColor: "#ffffff",
  headerShadowVisible: false,
}}
```

### Colorful Branded Header

```typescript
options={{
  title: "My App",
  headerTintColor: "#ffffff",
  headerBackgroundColor: "#6366f1", // Indigo
  headerShadowVisible: true,
}}
```

## Tips

1. **Color Format**: Use hex colors with optional alpha: `"#rrggbbaa"` or `"#rrggbb"`
2. **Default Behavior**: Headers are shown by default; you must explicitly set `headerShown: false` to hide
3. **Back Button**: Automatically appears on non-root screens; uses `headerTintColor` for icon
4. **Performance**: Header updates are batched and happen on the UI thread
5. **Fallback**: If header options fail to parse, the header still renders with defaults

## Troubleshooting

### Header Not Showing

- Check that `headerShown` is not set to `false`
- Verify options are passed correctly to the Screen component

### Colors Not Applied

- Ensure color strings are valid hex format
- Check logs for parsing errors

### Dynamic Updates Not Working

- Make sure you're calling `navigation.setOptions()` from within a screen component
- Verify the screen has already mounted

### Back Button Missing

- Back button only appears for screens in the back stack
- First screen (root) never shows a back button

## Example: Complete Screen

```typescript
import { View, Text, Pressable } from "@rune/components";
import { useNavigation } from "@rune/android-router";

const MyScreen = () => {
  const navigation = useNavigation();

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>
        My Screen with Header
      </Text>

      <Pressable
        onPress={() =>
          navigation.setOptions({
            headerTintColor: "#ff5733",
          })
        }
        style={{
          backgroundColor: "#6366f1",
          padding: 16,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "#ffffff" }}>Change Header Color</Text>
      </Pressable>
    </View>
  );
};

// Usage in router:
<Router.Stack.Screen
  name="MyScreen"
  component={MyScreen}
  options={{
    title: "Welcome",
    headerTintColor: "#38f935",
    headerBackgroundColor: "#181a24",
    headerShadowVisible: true,
  }}
/>;
```
