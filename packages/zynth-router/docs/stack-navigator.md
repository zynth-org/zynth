# Stack Navigator

The Stack Navigator manages a stack of screens with push/pop transitions, similar to navigation in mobile apps.

## Creating a Stack Navigator

```tsx
import { createStackNavigator } from "@zynth/router";

type StackParams = {
  Home: undefined;
  Details: { id: string };
  Settings: undefined;
};

const Stack = createStackNavigator<StackParams>();
```

## Basic Usage

```tsx
<Stack.Navigator initialRouteName="Home">
  <Stack.Screen name="Home" component={HomeScreen} />
  <Stack.Screen name="Details" component={DetailsScreen} />
  <Stack.Screen name="Settings" component={SettingsScreen} />
</Stack.Navigator>
```

## Navigator Props

### `initialRouteName`

The screen to show when the navigator first loads.

```tsx
<Stack.Navigator initialRouteName="Home">{/* ... */}</Stack.Navigator>
```

### `screenOptions`

Default options applied to all screens. Can be an object or a function.

```tsx
<Stack.Navigator
  screenOptions={{
    headerShown: true,
    headerBackgroundColor: "#1d4ed8",
    headerTintColor: "#ffffff",
  }}
>
  {/* ... */}
</Stack.Navigator>
```

Or as a function:

```tsx
<Stack.Navigator
  screenOptions={() => ({
    headerShown: true,
    headerBackgroundColor: isDarkMode() ? "#000" : "#fff",
  })}
>
  {/* ... */}
</Stack.Navigator>
```

## Screen Options

Each screen can have its own options:

```tsx
<Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={{
    title: "Details",
    headerShown: true,
    headerBackgroundColor: "#1d4ed8",
    headerTintColor: "#ffffff",
    headerShadowVisible: true,
    animation: "push", // "push" | "modal" | "zoom" | "fade" | "none"
    presentation: "push", // "push" | "modal"
    gestureEnabled: true,
  }}
/>
```

### Available Options

| Option                  | Type                  | Default     | Description                       |
| ----------------------- | --------------------- | ----------- | --------------------------------- |
| `title`                 | `string`              | Screen name | Header title text                 |
| `headerShown`           | `boolean`             | `true`      | Show/hide header                  |
| `headerBackgroundColor` | `string`              | `"#ffffff"` | Header background color           |
| `headerTintColor`       | `string`              | `"#111827"` | Header text and back button color |
| `headerShadowVisible`   | `boolean`             | `true`      | Show/hide header shadow           |
| `animation`             | Animation type        | `"push"`    | Screen transition animation       |
| `presentation`          | `"push"` \| `"modal"` | `"push"`    | Screen presentation style         |
| `gestureEnabled`        | `boolean`             | `true`      | Enable back gesture               |

## Navigation Methods

Use the `useNavigation` hook to access navigation methods:

```tsx
import { useNavigation } from "@zynth/router";

function MyScreen() {
  const navigation = useNavigation<StackParams>();

  // Navigation methods available:
  // navigation.navigate(name, params?)
  // navigation.push(name, params?)
  // navigation.pop(count?)
  // navigation.goBack()
  // navigation.replace(name, params?)
  // navigation.reset(state)
  // navigation.setParams(params)
  // navigation.setOptions(options)
  // navigation.canGoBack()
}
```

### `navigate(name, params?)`

Navigate to a screen. If the screen already exists in the stack, pop to it.

```tsx
navigation.navigate("Details", { id: "123" });
```

### `push(name, params?)`

Push a new screen onto the stack, even if it already exists.

```tsx
navigation.push("Details", { id: "456" });
```

### `pop(count?)`

Pop one or more screens from the stack.

```tsx
navigation.pop(); // Pop 1 screen
navigation.pop(2); // Pop 2 screens
```

### `goBack()`

Go back to the previous screen (same as `pop(1)`).

```tsx
navigation.goBack();
```

### `replace(name, params?)`

Replace the current screen with a new one.

```tsx
navigation.replace("Home");
```

### `reset(state)`

Reset the navigation state completely.

```tsx
navigation.reset({
  index: 0,
  routes: [{ name: "Home" }],
});
```

### `setParams(params)`

Update params for the current screen.

```tsx
navigation.setParams({ id: "789" });
```

### `setOptions(options)`

Update options for the current screen.

```tsx
navigation.setOptions({ title: "New Title" });
```

### `canGoBack()`

Returns `true` if there's a screen to go back to.

```tsx
if (navigation.canGoBack()) {
  navigation.goBack();
}
```

## Animation Types

Control how screens transition:

```tsx
<Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={{ animation: "push" }}
/>
```

Available animations:

- **`push`** (default) - Slide from right, previous screen slides left
- **`modal`** - Slide up from bottom
- **`zoom`** - Zoom in/out effect
- **`fade`** - Crossfade transition
- **`none`** - No animation

## Presentation Styles

```tsx
<Stack.Screen
  name="Modal"
  component={ModalScreen}
  options={{
    presentation: "modal",
    animation: "modal",
    headerShown: false,
  }}
/>
```

- **`push`** - Standard stack behavior
- **`modal`** - Presented as a modal (typically slides up)

## Dynamic Options

Update options based on state:

```tsx
import { createEffect } from "solid-js";
import { useNavigation } from "@zynth/router";

function MyScreen() {
  const navigation = useNavigation();
  const [title, setTitle] = createSignal("Initial Title");

  createEffect(() => {
    navigation.setOptions({
      title: title(),
    });
  });

  return (
    <View>
      <Pressable onPress={() => setTitle("Updated Title")}>
        <Text>Change Title</Text>
      </Pressable>
    </View>
  );
}
```

## Header Customization

While the router provides a default header, you can hide it and create your own:

```tsx
<Stack.Screen
  name="Custom"
  component={CustomScreen}
  options={{ headerShown: false }}
/>;

function CustomScreen() {
  const navigation = useNavigation();

  return (
    <View style={{ flex: 1 }}>
      {/* Your custom header */}
      <View
        style={{
          height: 60,
          backgroundColor: "#007AFF",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={{ color: "white" }}>← Back</Text>
        </Pressable>
        <Text style={{ color: "white", fontSize: 18 }}>Custom Header</Text>
      </View>

      {/* Screen content */}
      <View style={{ flex: 1 }}>{/* ... */}</View>
    </View>
  );
}
```

## Example: E-commerce Flow

```tsx
type ShopStackParams = {
  ProductList: undefined;
  ProductDetails: { productId: string };
  Cart: undefined;
  Checkout: { total: number };
  OrderConfirmation: { orderId: string };
};

const ShopStack = createStackNavigator<ShopStackParams>();

function ShopNavigator() {
  return (
    <ShopStack.Navigator initialRouteName="ProductList">
      <ShopStack.Screen
        name="ProductList"
        component={ProductListScreen}
        options={{ title: "Products" }}
      />
      <ShopStack.Screen
        name="ProductDetails"
        component={ProductDetailsScreen}
        options={{ title: "Product Details" }}
      />
      <ShopStack.Screen
        name="Cart"
        component={CartScreen}
        options={{ title: "Shopping Cart" }}
      />
      <ShopStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{
          title: "Checkout",
          presentation: "modal",
          animation: "modal",
        }}
      />
      <ShopStack.Screen
        name="OrderConfirmation"
        component={OrderConfirmationScreen}
        options={{
          title: "Order Complete",
          gestureEnabled: false,
        }}
      />
    </ShopStack.Navigator>
  );
}
```

## Next Steps

- Learn about [Tab Navigator](./tab-navigator.md)
- Explore [Nested Navigators](./nested-navigators.md)
- Master [Navigation Hooks](./hooks.md)
