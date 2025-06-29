# Router unification plan

## Background

We currently ship two bespoke router packages:

- `@rune/router` (a.k.a. `packages/rune-router`) is the feature-complete, iOS-first runtime. It contains the full Solid-powered context system, `NavigationContainer`, `Stack`, `Tabs`, `BottomSheet`, hooks, devtools, linking helpers, and the view surface plumbing needed to hydrate Swift/Objective‑C hosts.  
- `@rune/android-router` (a.k.a. `packages/rune-android-router`) is a lightweight Android-only prototype where each navigator registers screens with the native controller, and the native host retains responsibility for rendering, navigation state, tabs, and bottom sheets.

The goal of this document is to capture how each package currently works, surface the API/feature gaps, and sketch the work needed to move `@rune/router` into the “one router to rule them both” position that the CLI and apps will ultimately consume.

## Android router architecture (`packages/rune-android-router`)

### Entry points and screen registration

- `NavigationContainer` simply monitors the screen registry (`registry.ts`), writes flags into `globalThis` (`__RUNE_NATIVE_ROUTER_ACTIVE`, `__RUNE_NATIVE_ROUTER_STACK`, `__RUNE_NATIVE_ROUTER_CAN_GO_BACK`), and tells native which screens exist via `registerScreensNative`, then issues a single `resetStackNative` call to make the native stack show the first screen.  
  (`NavigationContainer.tsx`)
- `Stack` exposes an `initialRouteName` and `Stack.Screen` that register a screen definition with the registry (`context.ts`, `registry.ts`). Each registration includes the surface (`stack` or `bottomSheet`) so the native host knows where to render it. (`Stack.tsx`)
- `createRouter` wires together the `Stack`, `Tabs`, and `BottomSheet` factories so apps have the familiar namespace. (`createRouter.ts`)

### Native bridge & rendering

- Communication with Android happens through the `__modules` bridge (`modules.call`) inside `nativeBridge.ts`. It exposes helpers such as `registerScreensNative`, `resetStackNative`, `navigateNative`, `setOptionsNative`, `registerTabsNative`, and `registerBottomSheetNavigatorNative` along with `notifyScreenRenderedNative`.  
- `nativeRenderer.tsx` listens for `__renderRouterScreen`/`__disposeRouterScreen` invocations from Android, looks up the requested component via `registry.findScreenDefinition`, renders it through `@rune/core` hosts, and wires navigation helpers (`navigateNative`, `goBackNative`, `setOptionsNative`).  
- Tabs and tab icons are special cased: `Tabs.tsx` calls `registerTabsNative` with the metadata, `tabIconRenderer.tsx` exposes `__renderTabIcon` + `__disposeTabIcon`, and `tabIconRegistry.ts` lets tab screen definitions register Solid factories.  
- Bottom sheets register their options via `registerBottomSheetNavigatorNative`, wrap each screen with a transparent `View`, and rely on the native host’s sheet implementation (`BottomSheet.tsx`).

### Feature surface and existing gaps

- Navigation helpers are minimal: only `useNavigation()` exists and it merely forwards to the native actions (`hooks.ts`). There is no `useRoute`, no `setParams`, no focus tracking, no `beforeRemove`, and the only hooks are the native events declared in `events.ts` (`STACK_CHANGED_EVENT`, `BACK_PRESS_EVENT`).  
- There are no persistence, linking, or devtools helpers. Screens can only expose the options that the Android types define (`types.ts`) – which is a subset of iOS screen options (no header blur, no custom right button, no `userInterfaceStyle`, no advanced presentation styles).  
- Tabs and bottom sheets exist, but their options differ (Android’s `BottomSheetScreenOptions` exposes `preferredDetent` / `enablePanningGesture`, whereas iOS’s version leans on the native sheet config).  
- There is no JS fallback path for stacks/bottom sheets; rendering runs on native surfaces from the start. That simplifies Android’s JS, but it also means there’s no `RouteContext` for Android screens and `navigation` is always a thin bridge to the host.

## iOS router architecture (`packages/rune-router`)

### Core runtime

- The router is driven by `RouterContext` (`core/RouterContext.tsx`) which exposes the shared context, focus manager, before-remove manager, and helpers such as `useNavigation`, `useRoute`, `registerScreen`, and `applyScreenOptions`.  
- `core/actions.ts` defines the `NativeRouterBridge` interface, caches screen descriptors, dispatches navigation actions (`dispatchNavigationAction`), forwards `setOptions`, and keeps native tabs in sync. It also wires the fallback bridge that consoles warnings when the native module isn’t installed yet.  
- `core/events.ts` uses `@rune/core`’s `NativeEventEmitter` to emit `ROUTER_EVENT_*` constants (focus/blur, transition events, tab selection, tab metrics, before-remove, etc.).  
- `core/types.ts` defines the shared `RouteParamList`, `NavigationHelpers`, navigator props, `ScreenOptions`, tab/bottom-sheet options, and `SetOptionsConfig` that drive all the components.

### Navigators & surfaces

- `NavigationContainer` bootstraps the router state, subscribes to native events, wires persistence/linking/devtools options, and exposes `Dispatch`, `setOptions`, and registration helpers through `RouterContext`. It also asserts that a `SafeAreaProvider` has been mounted (so headers/tabs can read insets). (`NavigationContainer.tsx`)
- `Stack` renders JS scenes when native surfaces are not available, or, if the native host has already mounted a Solid surface, it reuses that surface via `createNativeSurfaceManager`. It registers each `Stack.Screen` descriptor (`stack/Stack.tsx`, `stack/Screen.tsx`), synchronizes options, and manages `RouteProvider` so hooks work.  
- `Tabs` manages JS “keep alive” scenes, publishes tab metadata to the native host (`setNativeTabs`), tracks icon state (`tabIconRegistry.ts`, `tabIconRenderer.tsx`), and renders a `TabBar` placeholder (the native tab bar lives elsewhere). It also exposes `lazy` + `mountStrategy` and `TabBar` metrics through `core/tabMetrics.ts`.  
- `BottomSheet` mirrors the stack renderer’s surface logic, registers descriptors, and proxies `navigation`/`route` props through the `SceneContent` wrapper so sheet screens can act like regular Stack screens while still letting the native host control the sheet surface. (`bottomSheet/BottomSheet.tsx`, `bottomSheet/Screen.tsx`)

### Hooks & integrations

- Hooks such as `useBeforeRemove`, `useNavigationEvents`, `useFocusEffect`, and the exported `useNavigation`/`useRoute` rely on `RouterContext` to plug into native events, focus email, and before-remove guards.  
- Integration helpers include `addBackHandler` (listens to `ROUTER_EVENT_BACK`) and inset/metrics helpers (`useHeaderMetrics`, `createTabBarMetrics`). (`hooks/*`, `integration/*`, `core/tabMetrics.ts`)
- Linking/persistence helpers are already wired through `NavigationContainer`: `linking` options call `setLinkingOptions`, `persistence` adapters call `adapter.load()` and `adapter.save()`, and `handleLink` / `getPathFromState` parse URLs. (`core/linking.ts`)
- Devtools and safe-area warnings are emitted via `emitDevtoolsEvent` and `createSafeAreaInsets`.

### Native expectations

- The native host must set `globalThis.__RUNE_ROUTER__` with `dispatch`, `getState`, `setOptions`, and `registerScreens`. The JS runtime also knows how to bootstrap a module-backed bridge via `modules.call` (so we can test without the native host). (`core/actions.ts`)
- Native screens get mounted to Rune surfaces; each route’s metadata carries a `meta.surfaceId` that tells `Stack`/`BottomSheet` how to hydrate the Solid tree via `@rune/core`’s `render`, `getHost`, `setActiveSurface`, `notifyScreenRendered`, etc.  
- Tabs also emit tab metrics and selection events that JS listens to so things like `createTabBarMetrics` can stay reactive.

## API disparity snapshot

| Capability | iOS router (`@rune/router`) | Android router (`@rune/android-router`) |
| --- | --- | --- |
| Navigation container props | `linking`, `persistence`, `onStateChange`, `enableDevtoolsTimeline`, safe-area warning | Only `children`; registry drives bootstrapping and `initialRouteName` is implicit |
| Screen registration | `router.registerScreen` + `ScreenDescriptor` + memory policy (`keepAlive`, `unmountOnBlur`) | `registerScreenDefinition` + surface flag; no memory hints |
| Navigation helpers | `navigate`, `push`, `pop`, `goBack`, `replace`, `reset`, `setParams`, `setOptions`, `tabBarMetrics` | `navigate`, `push` (same), `goBack`, `setOptions` (thin bridge) |
| Hooks | `useNavigation`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, `useNavigationEvents`, `RouteProvider` | Only `useNavigation` |
| Events | Rich emitter (`ROUTER_EVENT_*`) including focus, transition progress, before remove | Only stack/back events (`rune.androidRouter.*`) |
| Tabs | JS “keep alive” scenes + metrics + icon surfaces (supports `lazy`, `mountStrategy`) | Native tab navigator that receives descriptor list + icons; no JS keep-alive |
| Bottom sheets | JS fallback + native surfaces + `enableDynamicSizing`, `allowDismissOnInteraction` | Native sheet options (`preferredDetent`, `enablePanningGesture`); content wrapped in transparent `View` |
| Screen options | Full set of header/tab/gesture/presentation options (`core/types.ts`) | Subset: title, header colors, presentation, tab config, bottom sheet config (`types.ts`) |
| Linking/persistence | Supported | Not implemented |
| Tab icons | Surface + glyph helpers + `createTabIcon` utilities | Surface rendering + `registerTabIcon` |

## Unified API proposal

The plan is to make `@rune/router` the canonical package, consume it from `apps/components`, and under the hood dispatch to the platform-specific implementations we already have.

1. **Single public API.** Keep the exports in `packages/rune-router/src/index.ts` as the surface: `NavigationContainer`, `createRouter`, `Stack`, `Tabs`, `BottomSheet`, `useNavigation`, `useRoute`, `useBeforeRemove`, `addBackHandler`, `useHeaderMetrics`, `createTabBarMetrics`, `handleLink`, `getPathFromState`, and the type helpers from `core/types.ts`. This is the API apps already expect.  
2. **Platform-specific implementations.** Introduce a `src/platform/ios` and `src/platform/android` folder (or similar) that each export their versions of `NavigationContainer`, `Stack`, `Tabs`, and `BottomSheet`. The shared entry points can branch on `Platform.OS` (see how `tabs/Tabs.tsx` already reads `Platform`/`OS`) and delegate to the right implementation while reusing the same TypeScript type definitions from `core/types.ts`.  
3. **Shared context + types.** Keep the `core/` folder (context, actions, events, types, tab metrics) as the truth. Both platform implementations should depend on it so we stay in sync on `ScreenDescriptor`, `NavigationHelpers`, and `RouterAction`. Android’s registry logic can be refactored into a platform helper that still uses those types.  
4. **Feature parity via intersection.** Reduce the public `ScreenOptions` / navigator props to the features both platforms support today (title, header tint, presentation, tabs, bottom sheet config). Extra iOS-only bits (header blur, right button, `userInterfaceStyle`, the full `linking` surface) should either be deferred or gated behind platform-specific props until Android can ship them. Tabs’ `lazy`/`mountStrategy` metadata should stay, but Android might ignore them for now (or we can plumbing them into the native host as future work).  
5. **Event/bridge unification.** Reuse `core/events.ts`’s emitter so `useNavigationEvents`, `addBackHandler`, and listeners like `ROUTER_EVENT_TAB_SELECTED` work on both platforms. The Android native controller should emit the same event names (instead of `rune.androidRouter.*`), or we wrap it to re-emit the shared constants.  
6. **Tab icon surfaces.** Share the `tabIconRegistry`, `tabIconRenderer`, and `tabIconWrapper` code between platforms (currently duplicated) so registering a custom icon factory works regardless of where the native host renders the icon surface.  
7. **Navigation container responsibilities.** The unified `NavigationContainer` should still expose `linking`, `persistence`, `onStateChange`, and devtools props, but each platform implementation will decide how best to surface them: iOS can keep the existing `NativeRouterBridge`, while Android’s bridge must eventually honor `linking`/`persistence` by forwarding the data to the native host.

## Migration considerations

1. **Copy the Android runtime into `@rune/router`.** As you plan to do, duplicate `packages/rune-android-router/src` under `packages/rune-router/src/platform/android` so the Android logic lives inside the unified package.  
2. **Modularize the entry points.** Turn `Stack`, `Tabs`, `BottomSheet`, and `NavigationContainer` into thin wrappers that choose between `/platform/ios` and `/platform/android` implementations based on `Platform.OS`.  
3. **Unify the type definitions.** Consolidate the shared `ScreenOptions`, `NavigationHelpers`, tab/bottom-sheet option types inside `core/types.ts` so both implementations depend on the same shape. Expand the Android types as needed (e.g., add glyph fields to `TabIconDescriptor`) instead of defining a separate `types.ts` file.  
4. **Standardize the native bridge interface.** Both host controllers should implement `NativeRouterBridge`’s `dispatch`, `setOptions`, `registerScreens`, `configureTabs`, `selectTab`, and event listener hooks so the JS runtime can treat them uniformly. Android can install its bridge on `globalThis.__RUNE_ROUTER__` just like iOS does.  
5. **Document platform-specific limitations.** Where we cannot implement parity yet (e.g., Android does not currently emit transition events or support `linking`), call those out cleanly in the docs and consider adding `Platform.OS === OS.ANDROID ? undefined : extraProp` in the TypeScript declarations until the bridge matures.  
6. **Harmonize event names.** Emit the shared `ROUTER_EVENT_*` constants from Android (via `addRouterEventListener`) instead of the legacy `rune.androidRouter.*` strings, so hooks and integrations can be platform-agnostic.  
7. **Align tabs/bottom sheets.** Share the `tabIcon` surface utilities and keep the `Tabs` component’s JS scene management for both platforms; Android’s native implementation can continue to drive the actual tab UI while still honoring the metadata from `Tabs.Screen`. Bottom sheets should also reuse the same `SceneContent` pattern so they pass `navigation`/`route` props to screen components in a consistent way.

## Outstanding questions

1. Should we keep separate navigator names (Stack/Tabs/BottomSheet) inside the unified `createRouter`, or give the Android runtime the same Flexible `Router.Stack.Screen` semantics that the iOS runtime currently uses?  
2. Once Android starts emitting the richer `ROUTER_EVENT_*` payloads, can we remove the simplified `events.ts` emitter and rely solely on `core/events.ts`?  
3. How do we want to signal “unsupported feature” in the public API? A runtime warning when a screen option is ignored, or TypeScript narrowing via `Platform.OS` unions?  
4. Are there parts of the Android registry/bridge that can be simplified once `Stack.Screen` is unified (for example, the [`registerScreenDefinition`](packages/rune-android-router/src/registry.ts) + `NavigationContainer` loop)?

Once we have consensus on the above and the Android files live inside `packages/rune-router`, we can start rewriting the platform wrappers and share the `core/` logic without duplicating documentation for two packages.
