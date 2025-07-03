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
| Navigation container props | `linking`, `persistence`, `onStateChange`, `enableDevtoolsTimeline`, safe-area warning | `children` plus full `getState`/`dispatch` parity; safe-area warning still iOS-only |
| Screen registration | `router.registerScreen` + `ScreenDescriptor` + memory policy (`keepAlive`, `unmountOnBlur`) | Registers screens with native; memory hints not wired |
| Navigation helpers | `navigate`, `push`, `pop`, `goBack`, `replace`, `reset`, `setParams`, `setOptions`, `tabBarMetrics` | `navigate`, `push`, `goBack`, `setOptions`; `getState`/`dispatch` now available but `setParams`/`reset` still stubby in JS |
| Hooks | `useNavigation`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, `useNavigationEvents`, `RouteProvider` | All hooks wired; route context/providers wrapped in native renderer |
| Events | Rich emitter (`ROUTER_EVENT_*`) including focus, transition progress, before remove | Focus/blur/back/state/tab metrics emitted; transition events still missing |
| Tabs | JS “keep alive” scenes + metrics + icon surfaces | Native tab navigator; emits tab metrics; icon surfaces supported |
| Bottom sheets | JS fallback + native surfaces + `enableDynamicSizing`, `allowDismissOnInteraction` | Native sheet options (`preferredDetent`, `enablePanningGesture`); renders JS content wrapped |
| Screen options | Full set of header/tab/gesture/presentation options (`core/types.ts`) | Subset; `backgroundColor` added; parity for most headers/tabs; some iOS-only props remain |
| Linking/persistence | Supported | Bridge now exposes state/dispatch; helpers still stubbed |
| Tab icons | Surface + glyph helpers + `createTabIcon` utilities | Surface rendering + `registerTabIcon` (shared) |

## Unified API proposal

The plan is to make `@rune/router` the canonical package, consume it from `apps/components`, and under the hood dispatch to the platform-specific implementations we already have.

1. **Single public API.** Keep the exports in `packages/rune-router/src/index.ts` as the surface: `NavigationContainer`, `createRouter`, `Stack`, `Tabs`, `BottomSheet`, `useNavigation`, `useRoute`, `useBeforeRemove`, `addBackHandler`, `useHeaderMetrics`, `createTabBarMetrics`, `handleLink`, `getPathFromState`, and the type helpers from `core/types.ts`. This is the API apps already expect.  
2. **Platform-specific implementations.** Done. Entry points branch on `Platform.OS` and delegate to `src/platform/ios` or `src/platform/android`, sharing types/context.  
3. **Shared context + types.** Done. Android uses the shared context types and now wraps screens with providers in the native renderer.  
4. **Feature parity via intersection.** In progress. Android supports most header/tab options and backgroundColor; iOS-only props (header blur, right button, userInterfaceStyle) still pending a decision.  
5. **Event/bridge unification.** In progress. Android now emits focus/blur/back/state/tab metrics via `ROUTER_EVENT_*`; transition events are still missing.  
6. **Tab icon surfaces.** Done. Both platforms share the tab icon registry/renderer.  
7. **Navigation container responsibilities.** Android bridge now exposes `getState`/`dispatch`; linking/persistence helpers still need wiring on the JS side.

## Current status (late November)

- JS entry point unified; platform-specific implementations under `src/platform/ios` and `src/platform/android`.
- Hooks: `useRoute`, `useFocusEffect`, `useBeforeRemove`, `useNavigationEvents` now work on Android; screens are wrapped with providers in the native renderer.
- Bridge: Android exposes `getState`/`dispatch`; emits `ROUTER_EVENT_*` for focus/blur/back/state/tab metrics; tab backgroundColor supported; screen backgroundColor default added.
- Tab metrics: emitted from native; JS metrics hooks can consume real values.
- Remaining work:
  - Emit transition events (start/end/progress) on Android.
  - Complete before-remove round-trip: JS should respond to `requestId` to block/allow; native currently emits `beforeRemove` and accepts `resolveBeforeRemove`.
  - Wire linking helpers (`handleLink`, `getPathFromState`) and `setParams`/`reset` on Android now that state/dispatch are present.
  - Decide on iOS-only options (header blur, right button, userInterfaceStyle) and either gate or implement on Android.
