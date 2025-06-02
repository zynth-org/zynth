# iOS Tabs as Root Navigator

_Last updated: 2025-11-22_

## Motivation

Today, iOS must host `<Tabs>` inside a stack screen. The UIKit hierarchy looks like:

```
UIViewController (RNStackController)
 └─ UINavigationController
     └─ RNScreenHostController (TabsRoot)
         ├─ contentView (Solid surface host)
         └─ UITabBar
```

That stack wrapper exists because:

1. `RNStackController` owns the single Rune surface and moves it between screens.
2. `useRoute` / `useNavigation` expect a stack route context (Navigator ID and key).
3. Native bridge methods (`setOptions`, `configureTabs`, `selectTab`) are keyed by stack route keys.

This forces apps to wrap tabs inside a stack and disable the header manually. It also causes the brief "TabsRoot" header flicker before Solid applies `headerShown: false`.

To make `<NavigationContainer><Router.Tabs /></NavigationContainer>` the root, we need a dedicated host controller on iOS, similar to how Android can mount tabs directly.

## Proposed Solution: `RNTabsHostController`

Introduce a parallel native controller that can host tabs without a stack:

```
UIViewController (RNTabsHostController)
 ├─ contentView (Solid surface host)
 └─ UITabBar
```

### Responsibilities

- Own the shared `RuneRuntime.rootView` when tabs are the root navigator.
- Manage tab selection, tab icon surfaces, and badges.
- Expose the same bridge methods (`configureTabs`, `selectTab`, `removeTabs`) keyed by a "tabs root" identifier instead of stack route key.
- Provide a surrogate `RouteContext` so `useRoute` and `useNavigation` work inside tab screens.

## Required Changes (High-Level)

### Native (`packages/rune-router/ios`)

1. **New Files**

   - `ios/RuneRouter/RNTabsHostController.swift`
     - Similar to `RNStackController` but specialized for tabs. Embeds a `UITabBar`, `contentView`, and handles icon hosts.
   - Optional: `ios/RuneRouter/RNTabsRouterHost.swift` to bootstrap when tabs are root.

2. **RuneRouterModule.swift**

   - Detect when JS requests a tabs root and route `configureTabs`/`selectTab` calls to `RNTabsHostController`.
   - Expose a new identifier for the tabs root (e.g., `tabs-root`).

3. **RuneRouterHost.swift**

   - Provide an entry point to install either `RNStackController` (default) or `RNTabsHostController` when the app declares tabs as the root navigator.

4. **RNScreenHostController.swift**

   - Minimal changes; tabs root would no longer require a fake stack screen, so this class stays unchanged for stack routes.

5. **RuneTabIconHostView.swift**
   - Reuse as-is; both stack-hosted tabs and tabs root would mount icon surfaces the same way.

### JS (`packages/rune-router/src`)

1. **NavigationContainer.tsx / routerFactory.ts**

   - Detect when the root navigator is `Tabs` and provide a "tabs root" context instead of stack.
   - Create a route context for tab screens without going through a stack route.

2. **Tabs.tsx**

   - Support mounting at the root by:
     - Handling `useRoute` when no stack route key exists.
     - Registering screens with a new navigator ID (e.g., `tabs-root`).

3. **core/actions.ts**

   - Allow addressing the tabs root in `setNativeTabs`, `selectNativeTab`, etc.

4. **Docs / Types**
   - Update `core/types.ts` to describe the tabs-root navigator descriptor.

## Challenges

- **Route Context:** Tabs screens rely on `useRoute` to build paths and set options. Without a stack wrapper, we must synthesize route keys/params for the tabs root.
- **Surface Management:** Today only `RNStackController` owns the root surface. We need the same attach/detach logic in `RNTabsHostController` so tab screens can take over the surface and use snapshots when switching.
- **Bridge APIs:** JS currently calls `setOptions` with a stack route key. For tabs root, we must ensure `navigation.setOptions` still works (likely by mapping the tabs root to a pseudo route key).
- **Back Handling:** A tabs root still needs back handling (pop to stack, etc.) when nested navigators exist. We must ensure the tabs root can coexist with nested stacks.

## Summary

- `RNTabsHostController` would remove the need for a placeholder stack screen (`TabsRoot`) and eliminate header flicker when tabs are the top-level navigator.
- Implementation touches both native (new host controller, module routing, host bootstrap) and JS (context detection, actions routing).
- Until this lands, tabs must remain inside a stack with `headerShown: false`, but the architectural notes above outline the work required to support `<NavigationContainer><Tabs /></NavigationContainer>` as the root on iOS.
