# Navigation Hooks

`@rune/memory-router` provides several hooks for accessing navigation state and functionality within your screens.

## useNavigation

Get access to navigation methods for the current screen.

```tsx
import { useNavigation } from "@rune/memory-router";

type StackParams = {
  Home: undefined;
  Details: { id: string };
};

function MyScreen() {
  const navigation = useNavigation<StackParams>();

  return (
    <Pressable onPress={() => navigation.navigate("Details", { id: "123" })}>
      <Text>Go to Details</Text>
    </Pressable>
  );
}
```

### Methods

```tsx
const navigation = useNavigation<ParamList>();

// Navigate to a screen
navigation.navigate(name, params?);

// Push a new screen (stack only)
navigation.push(name, params?);

// Pop screens (stack only)
navigation.pop(count?);

// Go back
navigation.goBack();

// Replace current screen
navigation.replace(name, params?);

// Reset navigation state
navigation.reset(state);

// Update params
navigation.setParams(params);

// Update options
navigation.setOptions(options);

// Check if can go back
navigation.canGoBack();

// Get parent navigator (for nested navigators)
navigation.getParent();

// Check if screen is focused
navigation.isFocused();
```

## useRoute

Access the current route's information (name, params, key).

```tsx
import { useRoute } from "@rune/memory-router";

type StackParams = {
  Details: { id: string; title: string };
};

function DetailsScreen() {
  const route = useRoute<StackParams, "Details">();

  // Access params (reactive)
  const { id, title } = route.params();

  // Access route metadata
  const routeName = route.name; // "Details"
  const routeKey = route.key; // unique key

  return (
    <View>
      <Text>ID: {id}</Text>
      <Text>Title: {title}</Text>
    </View>
  );
}
```

### Properties

```tsx
const route = useRoute<ParamList, RouteName>();

route.key; // Unique route key
route.name; // Route name
route.params(); // Route params (Accessor)
route.setParams; // Update params function
```

## useParams

Shorthand for accessing route params.

```tsx
import { useParams } from "@rune/memory-router";

type StackParams = {
  Details: { id: string; title: string };
};

function DetailsScreen() {
  const params = useParams<StackParams, "Details">();

  return (
    <View>
      <Text>ID: {params().id}</Text>
      <Text>Title: {params().title}</Text>
    </View>
  );
}
```

## useRouteName

Get the current route name.

```tsx
import { useRouteName } from "@rune/memory-router";

function MyScreen() {
  const routeName = useRouteName();

  return <Text>Current route: {routeName}</Text>;
}
```

## useIsFocused

Check if the current screen is focused.

```tsx
import { useIsFocused } from "@rune/memory-router";
import { createEffect } from "solid-js";

function MyScreen() {
  const isFocused = useIsFocused();

  createEffect(() => {
    if (isFocused()) {
      console.log("Screen is focused");
      // Fetch fresh data, resume animations, etc.
    } else {
      console.log("Screen is not focused");
      // Pause animations, clean up, etc.
    }
  });

  return (
    <View>
      <Text>Focused: {String(isFocused())}</Text>
    </View>
  );
}
```

## useFocusEffect

Run side effects when the screen comes into focus.

```tsx
import { useFocusEffect } from "@rune/memory-router";

function MyScreen() {
  useFocusEffect(() => {
    console.log("Screen focused");

    // Fetch data
    fetchData();

    // Return cleanup function
    return () => {
      console.log("Screen unfocused");
      // Cancel requests, clean up subscriptions, etc.
    };
  });

  return <View>{/* ... */}</View>;
}
```

### Example: Refresh Data on Focus

```tsx
function FeedScreen() {
  const [posts, setPosts] = createSignal([]);
  const [loading, setLoading] = createSignal(false);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const data = await fetchPosts();
      setPosts(data);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(() => {
    loadPosts();
  });

  return (
    <View>
      <Show when={!loading()} fallback={<Spinner />}>
        <For each={posts()}>{(post) => <PostCard post={post} />}</For>
      </Show>
    </View>
  );
}
```

## useBeforeRemove

Prevent navigation or show confirmation dialog.

```tsx
import { useBeforeRemove } from "@rune/memory-router";
import { createSignal } from "solid-js";

function EditProfileScreen() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = createSignal(false);

  useBeforeRemove((event) => {
    if (!hasUnsavedChanges()) {
      return; // Allow navigation
    }

    // Prevent navigation
    event.preventDefault();

    // Show confirmation dialog
    const confirmed = confirm("You have unsaved changes. Discard them?");

    if (confirmed) {
      setHasUnsavedChanges(false);
      // Allow navigation by dispatching the action again
      event.retry();
    }
  });

  return (
    <View>
      <Input onChange={() => setHasUnsavedChanges(true)} />
      {/* ... */}
    </View>
  );
}
```

## useNavigationState

Access the raw navigation state.

```tsx
import { useNavigationState } from "@rune/memory-router";

function MyScreen() {
  const state = useNavigationState();

  return (
    <View>
      <Text>Current index: {state().index}</Text>
      <Text>Total routes: {state().routes.length}</Text>
    </View>
  );
}
```

### Use Cases

- Display breadcrumbs
- Show custom back button based on stack depth
- Debug navigation state

```tsx
function Breadcrumbs() {
  const state = useNavigationState();

  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <For each={state().routes}>
        {(route, index) => (
          <>
            <Text>{route.name}</Text>
            <Show when={index() < state().routes.length - 1}>
              <Text> → </Text>
            </Show>
          </>
        )}
      </For>
    </View>
  );
}
```

## useScreenOptions

Get or update screen options dynamically.

```tsx
import { useScreenOptions } from "@rune/memory-router";
import { createEffect, createSignal } from "solid-js";

function MyScreen() {
  const [options, setOptions] = useScreenOptions();
  const [count, setCount] = createSignal(0);

  // Update title based on state
  createEffect(() => {
    setOptions({
      title: `Count: ${count()}`,
    });
  });

  return (
    <View>
      <Text>Current title: {options().title}</Text>
      <Pressable onPress={() => setCount((c) => c + 1)}>
        <Text>Increment</Text>
      </Pressable>
    </View>
  );
}
```

## useHeaderMetrics

Get header dimensions (useful for layouts).

```tsx
import { useHeaderMetrics } from "@rune/memory-router";

function MyScreen() {
  const headerMetrics = useHeaderMetrics();

  return (
    <View style={{ paddingTop: headerMetrics().height }}>
      {/* Content positioned below header */}
    </View>
  );
}
```

## useTabBarMetrics

Get tab bar dimensions.

```tsx
import { useTabBarMetrics } from "@rune/memory-router";

function MyScreen() {
  const tabBarMetrics = useTabBarMetrics();

  return (
    <View style={{ paddingBottom: tabBarMetrics().height }}>
      {/* Content positioned above tab bar */}
    </View>
  );
}
```

## Advanced: useNavigationContext

Access the raw navigation context (advanced use cases).

```tsx
import { useNavigationContext } from "@rune/memory-router";

function MyScreen() {
  const navContext = useNavigationContext();

  console.log("Navigator ID:", navContext.navigatorId);
  console.log("Navigator Type:", navContext.navigatorType); // "stack" | "tabs"

  return <View>{/* ... */}</View>;
}
```

## Advanced: useRouteContext

Access the raw route context (advanced use cases).

```tsx
import { useRouteContext } from "@rune/memory-router";

function MyScreen() {
  const routeContext = useRouteContext();

  console.log("Route key:", routeContext.key);
  console.log("Route name:", routeContext.name);
  console.log("Is focused:", routeContext.isFocused());

  return <View>{/* ... */}</View>;
}
```

## Combining Hooks

```tsx
import {
  useNavigation,
  useRoute,
  useIsFocused,
  useFocusEffect,
  useBeforeRemove,
} from "@rune/memory-router";
import { createSignal, createEffect } from "solid-js";

type StackParams = {
  EditPost: { postId: string; initialContent: string };
};

function EditPostScreen() {
  const navigation = useNavigation<StackParams>();
  const route = useRoute<StackParams, "EditPost">();
  const isFocused = useIsFocused();

  const { postId, initialContent } = route.params();
  const [content, setContent] = createSignal(initialContent);
  const [hasChanges, setHasChanges] = createSignal(false);

  // Track changes
  createEffect(() => {
    setHasChanges(content() !== initialContent);
  });

  // Warn before leaving with unsaved changes
  useBeforeRemove((event) => {
    if (hasChanges()) {
      event.preventDefault();
      if (confirm("Discard changes?")) {
        event.retry();
      }
    }
  });

  // Auto-save when screen loses focus
  useFocusEffect(() => {
    return () => {
      if (hasChanges()) {
        savePost(postId, content());
      }
    };
  });

  // Update title dynamically
  createEffect(() => {
    navigation.setOptions({
      title: hasChanges() ? "Editing* Post" : "Edit Post",
    });
  });

  return (
    <View>
      <TextInput
        value={content()}
        onChange={(e) => setContent(e.target.value)}
      />
      <Pressable
        onPress={async () => {
          await savePost(postId, content());
          navigation.goBack();
        }}
      >
        <Text>Save</Text>
      </Pressable>
    </View>
  );
}
```

## Best Practices

### 1. Type Your Hooks

Always provide route param types:

```tsx
// ❌ Untyped
const navigation = useNavigation();
const route = useRoute();

// ✅ Typed
const navigation = useNavigation<StackParams>();
const route = useRoute<StackParams, "Details">();
```

### 2. Use Appropriate Hooks

- `useParams()` when you only need params
- `useRoute()` when you need full route info
- `useRouteName()` when you only need the name

### 3. Cleanup in useFocusEffect

Always return a cleanup function:

```tsx
useFocusEffect(() => {
  const subscription = subscribe();

  return () => {
    subscription.unsubscribe();
  };
});
```

### 4. Guard useBeforeRemove

Only prevent navigation when necessary:

```tsx
useBeforeRemove((event) => {
  if (!shouldPrevent()) {
    return; // Allow navigation
  }

  event.preventDefault();
  // Show dialog...
});
```

## Next Steps

- Learn about [TypeScript](./typescript.md) integration
- Check the [API Reference](./api-reference.md)
- Explore [Stack Navigator](./stack-navigator.md)
- Explore [Tab Navigator](./tab-navigator.md)
