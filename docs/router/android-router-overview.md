# Android Router Overview

This document captures the current design of the native Android router and summarizes the issues we resolved while getting the first `RouterMinimal` screen to render inside `RuneNavigationContainer`.

## Architecture

- **Bootstrap** – `MainActivity` instantiates the legacy `RuneRootView` (surface `0`) for overlays/devtools. When the router module is present we invoke `RuneAndroidRouterHost.bootstrap(activity, runtime, rootView)` which swaps in a `RuneNavigationContainer` as the activity content view and registers the router bridge.
- **Navigation container** – `RuneNavigationContainer` is a `FrameLayout` that owns the original runtime `RuneRootView` (kept hidden) and a `FragmentContainerView`. It registers screens provided by JS via `RuneAndroidRouterBridge` and pushes `RouterScreenFragment` instances onto the fragment manager.
- **Router screen fragment**
  - Builds a vertical `LinearLayout`, adds an `AppBarLayout + Toolbar`, then hosts a `RuneRootView` inside a `FrameLayout` to isolate runtime layout params from the toolbar.
  - Registers that `RuneRootView` as a new surface via `RuneRuntime.registerSurface`.
  - Calls `runtime.setActiveSurface(surfaceId)` whenever the fragment is created, resumed, or rendered so all subsequent JS mutations target the fragment surface, not the hidden root `0`.
  - Evaluates `__renderRouterScreen(surfaceId, routeName, params)` which invokes `nativeRenderer.ts` on the JS side.
- **JS renderer**
  - `NavigationContainer` registers the Solid components for each `<Router.Stack.Screen />` and instructs native to `reset` once the registry is ready.
  - `nativeRenderer.ts` calls `setActiveSurface(surfaceId)` before running Solid’s `render`, guaranteeing `@rune/core` issues commands against the fragment surface. Disposal mirrors this via `__disposeRouterScreen`.

## Issues We Hit & Fixes

| Problem | Impact | Fix |
| --- | --- | --- |
| **FrameLayout vs LinearLayout params** – `RouterScreenFragment` originally added the fragment `RuneRootView` directly to a `LinearLayout`. `RuneLayoutFlush` always applies `FrameLayout.LayoutParams`, so the view hierarchy crashed with `ClassCastException`. | App crashed on startup before any UI. | Wrap `RuneRootView` in an intermediate `FrameLayout` before adding it to the linear column (and drop the unused `CoordinatorLayout`). |
| **Surface focus race** – JS kept rendering into surface `0` because native never told the runtime which surface should be active. | The fragment `RuneRootView` stayed empty even though Solid rendered successfully elsewhere. | Call `runtime.setActiveSurface(surfaceId)` whenever the fragment registers, resumes, renders, or disposes. Also focus the surface before sending the `__disposeRouterScreen` script. |
| **Dispose order** – We were unregistering the fragment surface before JS disposed it, so `__disposeRouterScreen` logged warnings and leaked nodes. | Orphaned nodes and inconsistent stack bookkeeping when navigating back. | Reorder teardown to (1) focus the surface, (2) run `__disposeRouterScreen`, (3) call `runtime.unregisterSurface(surfaceId)`. |
| **Node/surface ID collision** – `RuneUIManager` increments node IDs globally. When we registered surface `1`, the next node ID was also `1`, so the Yoga tree tried to insert the surface container as its own child and nothing rendered. | Surface logs showed nodes targeting `surface=1` but layout never happened. | Ensure `registerSurfaceInternal` bumps `nextId` to `surfaceId + 1` before creating any nodes so surfaces and nodes occupy disjoint ID ranges. |
| **Visibility/measurement** – Without focus + frame host, the fragment root sat at height 0 or got padded under the toolbar. | White screen under the app bar. | Host layout now sets linear weights and the fragment `RuneRootView` adopts its parent height; measurement logs confirm consistent sizes. |

## Current Status

- Router boots without crashing and renders the Home screen.
- Toolbar titles/tints come from `RouterScreenOptions`.
- `RuneNavigationContainer` spans the window, with the fragment `RuneRootView` filling the remaining space under the toolbar.
- Surface instrumentation (`RuneSurface` logs) provides a high‑signal trace of registration, activation, node creation, and insertion for debugging.

## Next Steps

1. Re-enable navigation to Details and verify surface disposal + creation when popping/pushing fragments.
2. Polish pressable props (the “Unhandled prop” logs are harmless but noisy).
3. Capture scroll/inset behavior once we add nested content.
4. Expand this doc with diagnostics for future regression triage (e.g., what logs to expect per lifecycle phase).

This document should remain the canonical reference for the Android router until we split it into deeper topics (navigation, surfaces, diagnostics). Feel free to append findings as we continue iterating. 
