# iOS Tab Icons: Surface-Based Rendering Plan

## Motivation

Android already renders tab icons by mounting a tiny Rune surface per icon. This keeps the API ergonomic (`tab.icon={() => <Text>...</Text>}`) and gives the icon full access to SolidJS lifecycle and context. On iOS, `UITabBar` currently receives static `UIImage`s, so we introduced `createTabGlyphIcon`. That stopgap breaks parity and limits expressiveness (no animated icons, no hooks, no theming). This doc explains the native constraints and the steps required to bring iOS to feature parity.

## Current Architecture

- **Single Surface Runtime**: `RuneRuntime` (Swift) exposes a single `rootView`. All Solid trees render into this view through `SNUIManager`.
- **Tab Controller**: `RNScreenHostController` embeds a `UITabBar`. Tabs are described via `TabBarConfiguration`, which currently only serializes static colors, labels, and icon descriptors.
- **JS API**: Tabs register screens and pass icon metadata. There is no hook for Solid factories because native cannot host additional surfaces.

## Requirements for Surface Icons

1. **Multiple Surfaces in RuneKit**
   - Add APIs to `RuneRuntime`/`SNUIManager` similar to Android's `registerSurface`/`unregisterSurface`.
   - Each surface needs its own Yoga root, layout pass, and update queue.
   - The runtime must allow switching the "active" surface before evaluating JSX, mirroring `setActiveSurface` in Android.

2. **Native Tab Icon Host**
   - Create `RuneTabIconHostView` (UIKit) that owns a small `RuneRootView`.
   - Each `UITabBarItem` swaps its icon view with this host, giving it a fixed 24×24 frame.
   - The host registers a surface via the runtime, requests JS to render, and disposes it on teardown.

3. **Bridge Methods**
   - Extend `RuneRouterModule` (`configureTabs`, `removeTabs`, `selectTab`) so it can request icon rendering.
   - Introduce RPCs that mirror Android's `__renderTabIcon(surfaceId, runeId, active)` and `__disposeTabIcon`.

4. **JS Runtime Hooks**
   - Reuse the existing `registerTabIcon` registry and the icon renderer from Android (`tabIconRenderer.tsx`).
   - Ensure the renderer detects the host platform and uses the new iOS surface API.

5. **Lifecycle Flow**
   - When tabs are configured, JS registers icon factories and passes runeIds to native.
   - Native tab host creates surfaces and invokes `__renderTabIcon` with `active=false`.
   - On focus changes, native calls `__renderTabIcon(surfaceId, runeId, true/false)` or `__disposeTabIcon` when tabs unmount.

## File-Level Changes

1. **RuneKit (Swift/ObjC)**
   - `RuneRuntime.swift`: add `registerSurface(rootView: UIView) -> Int` and `unregisterSurface(id: Int)`.
   - `SNUIManager`: maintain a map of surface IDs to root views + Yoga nodes; update flush logic to iterate through all surfaces.
   - `RuneRouterModule.swift`: surface IDs need to be exposed via the bridge so the router can instruct JS to render/dispose icons.

2. **Router iOS Layer**
   - `TabBarConfiguration.swift`: include `icon.surfaceId` metadata.
   - `RNScreenHostController.swift`: create `RuneTabIconHostView`, register surfaces per item, and call into the runtime to render icons.
   - Add a new Swift file (`RuneTabIconHostView.swift`) that is responsible for lifecycle (register, render, dispose).

3. **JS Runtime**
   - `packages/rune-router/src/tabs/Tabs.tsx`: keep current glyph fallback, but when `icon` is a function, register it and pass the runeId.
   - `packages/rune-router/src/tabs/createTabIcon.ts`: optional, but can expose helpers for glyph fallback when native surfaces are unavailable (dev mode, older runtimes).
   - `packages/rune-router/src/core/actions.ts`: provide methods to request icon renders (e.g., `renderNativeTabIcon(surfaceId, runeId, active)`).
   - Share the icon renderer from `packages/rune-android-router/src/tabIconRenderer.tsx`; ensure it works on iOS by importing `setActiveSurface` from `@rune/core`.

4. **Docs/Diagnostics**
   - Update `docs/router/ios-router-arch.md` and this document once implementation lands.
   - Add logging (`[RuneTabIconHost]`) similar to Android's `RuneSurface` logs to trace lifecycle.

## Open Questions

- **Surface Limits**: How many concurrent surfaces can UIKit handle without impacting performance? Need profiling.
- **Hit Testing**: Do we need to forward pointer events from the icon host back into Rune (e.g., for animated icons that respond to presses)?
- **Backward Compatibility**: Apps running on older iOS runtimes (without multi-surface support) should continue to work with glyph fallbacks. Consider feature detection to toggle behavior.

## Next Steps

1. Prototype `RuneTabIconHostView` + surface registration in RuneKit.
2. Wire router bridge methods for icon rendering.
3. Reuse Android tab icon renderer in JS and gate it behind an `__IOS_TAB_ICON_SURFACES__` feature flag.
4. Document the migration path and ship a sample (`RouterBottomTabsGlyph`) that uses JSX icons once both platforms support it.

This plan restores parity, removes the `createTabGlyphIcon` stopgap, and unlocks richer tab experiences on iOS.
