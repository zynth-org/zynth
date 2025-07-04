# Android Router Migration & Parity Notes

This document outlines the architectural decisions and fixes implemented during the migration of `rune-android-router` to the unified `@rune/router` package. These patterns should be considered when ensuring parity on iOS or future platforms.

## 1. Native Restart (Bootstrap) Pattern

**Problem:**
When the Android Activity is destroyed (e.g., rotation, background memory reclamation) and recreated, the JS Runtime often persists.
1.  The old `RuneNavigationContainer` is destroyed.
2.  The `RuneAndroidRouterBridge` held a stale reference to the old container.
3.  The JS side thought the router was already "bootstrapped" and didn't re-register screens.
4.  Result: Blank screen on restart.

**Solution:**
*   **Dynamic Bridge Lookup:** The `RuneAndroidRouterBridge` no longer accepts a container in its constructor. Instead, it looks up `RuneAndroidRouterHost.containerOrNull()` on every call. This ensures it always talks to the active Activity's container.
*   **Re-Bootstrap Signal:** `RuneAndroidRouterHost.bootstrap` now emits a `rune.androidRouter.nativeRestart` event to JavaScript.
*   **JS Re-Registration:** `NavigationContainer.tsx` listens for this event. When received, it:
    1.  Resets its internal `bootstrapped` flag.
    2.  Increments a registry version signal.
    3.  Re-runs the effect that calls `registerScreensNative` and `resetStackNative`.

This ensures that whenever the native view hierarchy is reborn, the JS side re-sends the definitions to populate it.

## 2. Tab Icon Side-Effect Isolation

**Problem:**
`rune-router` imports both `platform/ios` and `platform/android` in its main index. Both platforms have a `tabIconRenderer.tsx` that executes a side-effect: `installIconRenderer()`.
Since iOS was imported first, it installed the iOS version of `__renderTabIcon`. Android calls to this global function failed to find icons registered in the Android registry.

**Solution:**
Added explicit `Platform.OS` checks inside `installIconRenderer` for both platforms.
*   iOS renderer only installs if `Platform.OS === OS.IOS`.
*   Android renderer only installs if `Platform.OS === OS.ANDROID`.

## 3. Param Updates & Flickering

**Problem:**
Navigating to the *current* screen with *new* parameters (e.g., `rune://details/123` -> `rune://details/456`) caused a visible flicker.
*   **Native:** Was detecting the route match but ignoring params.
*   **JS:** `nativeRenderer` was disposing the entire component tree and re-rendering it to inject new params.

**Solution:**
*   **Native:** `RuneNavigationContainer` and `RouterScreenFragment` now accept params updates for existing fragments. `RouterScreenFragment` has an `updateParams` method.
*   **JS:** `nativeRenderer.tsx` checks if the requested screen (`rootId`) is already mounted with the same route name.
    *   If yes: It calls `routeContext.__updateFromState(params)` (SolidJS signal update). It **does not** unmount the component.
    *   If no: It proceeds with standard unmount/mount logic.

## 4. Linking & URLSearchParams Polyfill

**Problem:**
Hermes (Android JS engine) does not support `URLSearchParams`, causing crashes when parsing deep link query strings.

**Solution:**
*   **Polyfill:** Added a lightweight `URLSearchParams` polyfill in `@rune/core/src/polyfills`.
*   **Injection:** `packages/rune-core/src/index.ts` imports this polyfill at the top level.
*   **Build:** Updated `rune-core/package.json` `sideEffects` to ensure the polyfill isn't tree-shaken.
*   **Implementation:** `packages/rune-router/src/platform/android/linking.ts` implements `handleLink` and `getPathFromState` matching the iOS implementation, relying on standard `URLSearchParams`.

## 5. Blank Screen on `goBack`

**Problem:**
When the native back stack had only 1 item, calling `goBack` popped that item, leaving the container empty (blank screen).

**Solution:**
Updated `RuneNavigationContainer.goBack`:
*   If `backStackEntryCount > 1`: Pop stack.
*   If `backStackEntryCount <= 1`: Call `activity.finish()` to close the Activity (standard Android behavior).

## 6. Overlay Visibility

**Problem:**
The `LinkingSmoke` debug overlay was invisible or hidden behind native fragments.

**Solution:**
*   **Z-Ordering:** In `RuneNavigationContainer`, changed the add order so `runtimeRootView` (JS layer) is added *after* `hostLayout` (Native Fragment layer).
*   **Visibility:** Removed logic that hid `runtimeRootView` when the router was active. Now the JS layer stays visible on top, allowing for overlays/HUDs.

## 7. Type Safety
Fixed build errors in Kotlin by explicitly typing `emptyMap<String, Any>()` when calling generic Bridge methods.
