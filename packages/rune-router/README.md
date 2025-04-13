# @rune/router

Native-first navigation primitives for Rune apps. The router keeps iOS and Android containers as the source of truth while Solid mirrors state for reactivity. Phase 1 ships stacks, tabs, actions, and focus helpers with a keep-alive policy optimized for memory. Phase 2 adds ergonomics: reactive `setOptions`, persistence hooks, deep linking, tab mounting strategies, guarded exits, and devtools taps.

## Highlights

- **Native state authority** – `UINavigationController`/`FragmentManager` drive the stack. JS listens via the shared Rune emitter and dispatches commands through a minimal bridge.
- **Solid-friendly APIs** – `<NavigationContainer>`, `<Stack>`, `<Tabs>`, hooks like `useNavigation`, `useRoute`, and `useFocusEffect` follow familiar patterns.
- **Safe-area aware defaults** – Header/Tab metrics read from `@rune/safe-area` to avoid first paint jumps. Apps must wrap in `SafeAreaProvider` with `getInitialWindowMetrics()`.
- **Memory policy baked-in** – Screens register keep-alive hints (default top two routes). Native hosts can choose to detach or destroy off-screen views under pressure.
- **Predictive back + guarded exits** – Back gestures funnel through the shared emitter. `useBeforeRemove` blocks accidental pops and feeds results back to native.
- **Reactive options + devtools** – `navigation.setOptions(() => …)` tracks Solid signals, pauses when the screen blurs, and pipes snapshots into a lightweight devtools event stream when `enableDevtoolsTimeline` is on.
- **Persistence + deep link ready** – `NavigationContainer` accepts persistence adapters, emits `onStateChange`, and exposes helper utilities (`handleLink`, `getPathFromState`) so Android Intents/URL schemes hydrate stacks instantly.

## File map

```
src/
  NavigationContainer.tsx         // Safe-area guard + router context provider
  core/                           // Types, context helpers, native bridge wiring
  stack/, tabs/                   // Declarative config for stacks and tabs
  integration/                    // Back dispatcher + inset helpers
ios/RuneRouter/                   // UINavigationController + host stubs
android/runerouter/               // FragmentManager controller + host fragment
```

## Usage

```tsx
import { NavigationContainer, createRouter } from "@rune/router";
import { SafeAreaProvider, getInitialWindowMetrics } from "@rune/safe-area";

const Router = createRouter<{
  Home: undefined;
  Details: { title?: string };
  Tabs: undefined;
  Feed: undefined;
  Profile: { userId: string };
}>();

const initialMetrics = getInitialWindowMetrics();

export function App() {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <NavigationContainer
        persistence={asyncStorageAdapter}
        linking={{
          prefixes: ["rune://", "https://example.com"],
          config: {
            Home: "",
            Details: "details/:id",
            Tabs: {
              path: "tabs",
              screens: {
                Feed: "feed",
                Profile: "profile/:userId",
              },
            },
          },
        }}
        enableDevtoolsTimeline
      >
        <Router.Stack initialRouteName="Home">
          <Router.Stack.Screen name="Home" component={Home} />
          <Router.Stack.Screen name="Details" component={Details} />
          <Router.Stack.Screen name="Tabs" component={TabsRoot} />
        </Router.Stack>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
```

### Reactive options

```tsx
import { useNavigation, useBeforeRemove, useNavigationEvents } from "@rune/router";

function Details() {
  const navigation = useNavigation();
  createEffect(() => {
    const dispose = navigation.setOptions(() => ({
      title: detailSignal().title,
      gestureEnabled: !isModal(),
    }));
    onCleanup(dispose);
  });

  useBeforeRemove((event) => {
    if (!isDirty()) {
      return;
    }
    event.preventDefault();
    showDiscardSheet({
      onConfirm: () => navigation.dispatch(event.action),
    });
  });

  useNavigationEvents({
    transitionStart: ({ key }) => console.log("start", key),
    transitionEnd: ({ key }) => console.log("end", key),
  });
}
```

`setOptions` accepts either an object or a signal-driven callback and returns a disposer. By default the effect pauses while the screen is unfocused; pass `{ runWhileBlurred: true }` to opt out.

### NavigationContainer props

| Prop | Description |
| --- | --- |
| `initialState` | Optional preloaded `NavigationState` to bootstrap before native emits its first snapshot. |
| `persistence` | `{ load(): NavigationState \| Promise<NavigationState>; save(state): void; }` adapter; useful for Android `SavedStateHandle`, disk caches, or experiments. |
| `onStateChange` | Called with every native `stateChanged` payload (after focus updates). |
| `linking` | Prefix/config object used by `handleLink(url)` and `getPathFromState(state)` to parse/serialize URLs. |
| `enableDevtoolsTimeline` | When true, pushes `{ type: "action" | "state", timestamp }` events through `globalThis.__RUNE_ROUTER_DEVTOOLS__?.emit`. |

### Deep linking helpers

```ts
import { handleLink, getPathFromState } from "@rune/router";

Linking.addEventListener("url", (event) => {
  if (!handleLink(event.url)) {
    console.warn("Unhandled URL", event.url);
  }
});

const shareURL = getPathFromState(currentState);
```

`handleLink` strips the matching prefix, builds a native-first `NavigationState`, and dispatches a `RESET` action synchronously so UIKit/Fragments take over immediately. `getPathFromState` performs the inverse so you can surface sharable URLs or analytics metadata.

### Tabs + mounting

`<Tabs>` now takes a `lazy` flag, and every `<Tabs.Screen>` accepts `mountStrategy?: "lazy" | "eager" | "resume"`. This information is registered with the native bridge so Liquid Glass / Android predictive tabs can decide whether to hydrate content immediately, lazily on first focus, or detach the view while keeping state in memory.

## Native bridge expectations

- Native sets `globalThis.__RUNE_ROUTER__` with `dispatch`, `getState`, `setOptions`, and `registerScreens`. When the package is linked, the templates will attempt to call the optional hosts (`RuneRouterHost.bootstrap(...)` on both platforms) so you can hook up your own controllers or fall back to the provided `RNStackController`/`StackController` later.
- State updates emit `rune.router.stateChanged` through `RuneNativeEmitter` (`@rune/core` already polyfills this on JS).
- Each screen host (`RNScreenHostController` / `ScreenHostFragment`) bootstraps a Rune surface and wraps the Solid component with `RouteProvider` so hooks like `useRoute()` work.

## Next steps

1. Wire Swift/Kotlin stubs to the actual Rune surface manager and dispatch events through JSI.
2. Fill in predictive back progress events + transition progress payloads for `ROUTER_EVENT_TRANSITION_*`.
3. Add presentation presets, shared transition hooks, and prefetch APIs (Phase 3 scope) once the Phase 2 runtime stabilizes.
