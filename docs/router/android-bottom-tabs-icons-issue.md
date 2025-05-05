# Android Bottom Tabs – Icon Render Issue

We currently surface tab icons by treating each icon slot as a tiny Rune surface that renders the JSX the user passes through the `tab.icon` API. The JS flow registers each icon factory via `registerTabIcon`, serializes a `runeId`, and exposes `__renderTabIcon` / `__disposeTabIcon` (see `packages/rune-android-router/src/tabIconRenderer.tsx`). On Android the `RuneTabController` swaps the default `NavigationBarItemView` icon for a `RuneTabIconHostView`, which owns a `RuneRootView` surface, and the native bridge tells the runtime to render into that surface whenever the tab becomes active (see `packages/rune-android-router/android/RuneAndroidRouter/src/main/java/com/rune/androidrouter/RuneNavigationContainer.kt` and `RuneTabIconHostView.kt`).

The issue is that even though the host view measures to 24 dp and the renderer logs show `renderTabIcon` called with the expected `runeId`, the Rune tree inside the icon surface has no measured nodes: `RuneViewContainer` and `RuneTextView` both report `0dp × 0dp`, so nothing actually appears inside the tab. This leaves the native icon slot blank even though JSX is running and `RuneRootView` is structured correctly. The problem persists across icon sizes and wrappers—it looks like the surface never forces the inner nodes to lay out, so their frames stay empty despite the layout inspector showing the parent at 24 dp. No workaround has surfaced yet.

## Resolution

1. **Force the Rune host queue to flush immediately** when tab icons are rendered or disposed (`packages/rune-android-router/src/tabIconRenderer.tsx`). That ensures the newly created `RuneRootView` in each `RuneTabIconHostView` actually synchronizes its layout tree instead of waiting for the next render phase, so the measured child size is rooted at 24 dp instead of `0 × 0`.
2. **Wrap icon JSX in a Rune `<View>`** instead of a plain fragment (`packages/rune-android-router/src/tabIconWrapper.tsx`). The view centers its children, fills the icon slot, and maintains layout props such as `pointerEvents="none"`, which keeps the native tab inspector satisfied while rendering a real container instead of an invisible host.
3. **Stabilize TypeScript tooling** by loading both the core and components JSX declaration files through the shared `types/rune-jsx` package and guarding the `process` access in `nativeBridge.ts`. That resolves the cascade of intrinsic-element errors and allows the router workspace to typecheck again so the runtime fixes can land cleanly.

## Validation

- `yarn workspace @rune/android-router build:types` now completes without errors, confirming the new JSX intrinsic declarations and guards satisfy the compiler.
