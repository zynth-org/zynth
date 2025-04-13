# Rune Router Phase 2 Status Report

## Overview

This document captures the current implementation state of the native-first Rune router as of YYYY-MM-DD. It summarizes the Solid APIs, the native iOS/Android bridges, the sample app wiring, and the remaining gaps before Phase 2 can be considered feature complete.

---

## Table of Contents

1. Goals
2. JS Runtime Components
3. Native Bridges
4. Template Integration
5. Sample App (`apps/components`)
6. Diagnostics & Logging
7. Known Gaps / TODOs
8. Testing Notes
9. Next Steps

---

## 1. Goals

- Deliver a native-first router that keeps iOS/Android as the source of truth while Solid mirrors the state.
- Implement Phase 2 features: reactive `setOptions`, params/state persistence hooks, deep linking helpers, tab mount strategies, `beforeRemove`, and transition/predictive-back events.
- Provide sample UI (in `apps/components`) to exercise stacks, tabs, focus events, and before-remove guards.
- Ensure templates auto-detect the router package and bootstrap native controllers without custom app edits.

---

## 2. JS Runtime Components

### 2.1 NavigationContainer

- Subscribes to native `rune.router.stateChanged` events, mirrors navigation state into a Solid signal.
- Exposes context methods `dispatch`, `setOptions`, `addBeforeRemoveListener`, etc.
- Supports persistence adapters (load/save), deep-link linking options, and devtools timeline hooks.
- Logs when devtools timeline is enabled (optional).

### 2.2 Stack Component

- Registers screens via `Stack.Screen` for metadata (component, options, params).
- On mount, dispatches a `RESET` action using the `initialRouteName` or the first registered screen.
- Renders the active route by traversing the mirrored native state and wrapping the component with `RouteProvider`.
- Includes dev logging (only in non-production) for stack state and active route snapshots.

### 2.3 Tabs Component

- Works similarly to Stack, but for tab routes.
- Accepts `lazy` flag (propagated as mount strategy metadata) for native to decide tab caching.

### 2.4 Hooks & Helpers

- `useNavigation`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, `useNavigationEvents`.
- `handleLink` / `getPathFromState` for deep linking.
- Integration helpers for SafeArea metrics (`useHeaderMetrics`, `useTabBarMetrics`).

### 2.5 Type Additions

- Added `BeforeRemove` event interfaces, tab mount strategies, linking configs, persistence adapters, etc.

---

## 3. Native Bridges

### 3.1 iOS

- Swift pod (`RuneRouter.podspec`) with:
  - `RuneRouterHost` (bootstraps `RNStackController` as the window root).
  - `RNStackController`: wraps `UINavigationController`, mirrors stack routes, emits events, manages the single Rune surface view.
  - `RNScreenHostController`: attaches the shared Rune view to the visible screen, applies options.
  - `RuneRouterModule`: registers with `RuneRuntime`, exposes `dispatch`, `setOptions`, `getState`, `resolveBeforeRemove`.
  - `RuneRouterEmitter`: emits state/transition/focus/predictive events via `RuneRuntime.emitEvent` (now public).
- RNStackController now:
  - Handles push/pop/replace/reset, emits state on every change.
  - Reparents the single Rune surface to the active screen.
  - Integrates predictive back updates via pan gesture progress.

### 3.2 Android

- Gradle module `android/RuneRouter` with:
  - `RuneRouterHost.bootstrap(activity, runtime, surfaceView)` invoked via reflection from the template.
  - `RuneRouterModule`: registers controller, handles dispatch/setOptions/getState/resolved beforeRemove.
  - `StackController`: manages FragmentManager stack, attaches shared Rune surface to active fragment.
  - `ScreenHostFragment`: hosts Rune view placeholder and updates when surface is reattached.
  - `RouterControllerRegistry`: maps route keys to controllers for callbacks.
  - `RuneRouterEmitter`: sends state/transition/back events via `RuneRuntime.emitEvent`.

### 3.3 Shared Notes

- Native controllers own navigation state; JS dispatches actions via module bridge.
- After any reset/push/pop, controllers emit `rune.router.stateChanged` immediately to keep Solid in sync.
- Before-remove confirmations travel through `ROUTER_EVENT_BEFORE_REMOVE` and `resolveBeforeRemove`.
- Predictive back updates emit progress percentages to feed `useNavigationEvents`.

---

## 4. Template Integration

### 4.1 iOS Template (`packages/rune-templates/ios`)

- AppDelegate imports `RuneRouterHost` when the pod exists.
- After runtime initialization and module initializers, `RuneRouterHost.bootstrap(window:runtime:)` is invoked.
- If bootstrap returns `false` (router not linked) it falls back to the legacy view-only mode.
- Podfile auto-includes `RuneRouter` when dependency graph has `runeNative.ios` entry.

### 4.2 Android Template (`packages/rune-templates/android`)

- `MainActivity` reflects `RuneRouterHost.bootstrap(this, runtime, rootView)` after modules init.
- If router host returns `false`, falls back to `setContentView(root)`.
- `package.json` dependency ensures `runeNative.android` metadata instructs `prebuild` to include the module.

### 4.3 Prebuild Outputs

- Running `yarn workspace com.components.app prebuild:ios` now lists RuneRouter in the native component pods and installs it via Cocoapods.
- Likewise for Android: settings.gradle/app build include the module (not yet run but wiring is there).

---

## 5. Sample App (`apps/components`)

- Added dependency on `@rune/router`.
- `src/App.tsx` renders `components/router/RouterBasic`.
- `RouterBasic` demonstrates:
  - Stack screens (Home, Details, Tabs entry).
  - Nested tabs (Feed, Profile).
  - `setOptions`, `navigate`, `push`, `useFocusEffect`, `useBeforeRemove`.
  - Logging transition events and route guards.
- UI tweaks:
  - Added `container` style with `#101217` background for readability.
  - Each screen logs actions to console for debugging.

---

## 6. Diagnostics & Logging

- `Stack` dev-mode logging prints the current stack state and active route whenever state changes.
- `RNStackController` / `StackController` logs transitions, predictive back progress, and errors.
- Sample app logs focus events, `beforeRemove`, and transition events to the console.
- `NavigationContainer` can emit devtools timeline events (action/state) when `enableDevtoolsTimeline` is `true`.

---

## 7. Known Gaps / TODOs

1. **Matchers for nested stack keys**  
   - Currently `stackId` is synthetic; native state doesn’t yet mirror the same key, so JS falls back to the first stack found. Need to align keys so nested stacks render deterministically.

2. **Multiple surfaces / per-screen rendering**  
   - Native currently reuses a single Rune surface across screens. We still need to hook up multiple surfaces or a proper view container per screen to support keeping off-screen React trees alive.

3. **Tabs renderer**  
   - Similar to Stack, Tabs needs a renderer component to display Solid tab content. Native tab controllers still only host the root view.

4. **SafeArea + layout**  
   - The sample screens rely on manual padding. Need to integrate the router with SafeArea header heights and default backgrounds.

5. **State persistence adapters**  
   - JS contract exists but no real adapters (e.g., AsyncStorage) provided yet.

6. **Deep link parsing**  
   - Basic parser implemented, but not yet wired to platform-specific intent/URL handlers.

7. **Android module linking verification**  
   - Need to run `prebuild:android` to ensure the module is correctly included and fix any Gradle issues.

8. **Testing**  
   - No automated tests yet. Need unit tests for hooks and integration tests for sample flows.

9. **Documentation**  
   - Expand README with instructions for writing custom hosts, sample code, and troubleshooting.

10. **Animation / header integration**  
    - Current nav bars use default styles, and no Solid header component is rendered.

11. **Transition progress events**  
    - iOS uses CADisplayLink; Android uses gesture deltas. Need smoothing and proper predictive back hooking on Android 13+ APIs.

---

## 8. Testing Notes

- TypeScript builds:
  - `yarn workspace @rune/router build:types` ✅
  - `yarn workspace com.components.app tsc --noEmit` still fails due to unrelated demo components; router files pass.

- Native:
  - iOS: `prebuild:ios` installs RuneRouter pod; sample app launches without crash after removing nav bar delegate assignment.
  - Android: not yet recompiled after module addition (pending).

- Manual testing:
  - iOS simulator shows RouterBasic screens (needs more UI polish but functional).
  - Verified navigation events, before-remove guard, and transition logs via console.

---

## 9. Next Steps

1. **Polish Stack renderer**
   - Align stack keys between JS and native to avoid fallback.
   - Render headers/tab bars in Solid when appropriate.

2. **Add Tabs renderer**
   - Mirror active tab state and render tab content similar to stack.

3. **Multiple surfaces**
   - Investigate hooking each screen into `RuneRuntime`’s rendering pipeline (requires runtime changes).

4. **Android verification**
   - Run `prebuild:android`, fix any module include issues, ensure `RuneRouterHost` attaches and reuses the surface.

5. **Devtools**
   - Build a simple overlay or CLI to visualize the action/state log emitted by `NavigationContainer`.

6. **Docs & Samples**
   - Expand documentation detailing bootstrap steps, customizing hosts, and known pitfalls.
   - Add more sample flows (lazy tabs, nested stacks, before-remove prompts).

7. **Testing**
   - Write unit tests for stack/tabs renderers, hooks, and linking helpers.

---

*End of report.*
