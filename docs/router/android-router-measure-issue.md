# Android Router Measurement Investigation

## Symptoms Observed

- Two `RuneRootView` instances appear in the hierarchy. Root `0` (the runtime host) keeps rendering JS content while the fragment-specific root attempts to render native screens, leading to duplicate UI trees.
- The fragment root reports wildly different heights on each launch (e.g., 680–808 dp) and often applies a positive `y` offset equal to the toolbar height, producing white bands above/below the content.
- `RuneScreenFragment` frequently hits the 800 ms timeout fallback because the fragment surface never receives a JS frame—the JS tree already rendered into root `0`.

## Root Causes

1. **Two render authorities.** The Solid `Stack` continues to render even when the native router is active, so the runtime `RuneRootView` gains the Home screen. The native fragment renders the same tree again, but because the Solid components are already mounted elsewhere, the second root often stays empty (or loses the measurement race).
2. **Historic measurement hacks.** The fragment rooted its layout in `android.R.id.content`, then layered padding/margin locks, layout-stability timers, and post-render adjustments to guess the final viewport. Once we introduced a dedicated host (`CoordinatorLayout` + `AppBarLayout`), those timers still triggered, forcing stale heights (e.g., 2088 px) even though the host was stable.
3. **Padding instead of sizing.** Rather than sizing the fragment `RuneRootView` to the host’s measured height minus toolbar and nav insets, the code padded the container. The fragment root remained full height and simply translated down, so it always overflowed by the toolbar height.
4. **No definitive native flag.** JS had no reliable signal that the native router bootstrapped, so heuristics (`__modules` existing) weren’t enough. The runtime root stayed active, and JS kept rendering there at startup.

## Lessons & Requirements for the Rewrite

- **Single renderer:** Introduce an explicit flag from `RuneAndroidRouterHost.bootstrap`/`__renderRouterScreen` that tells JS whether native owns the stack. When true, JS must not render any scenes into root `0`; only the fragment surfaces should render.
- **Dedicated host sizing:** Use a `CoordinatorLayout` host (similar to `react-native-screens`) and size the fragment `RuneRootView` directly to `hostHeight - toolbarHeight - navInset`. Avoid padding/margin hacks that keep the view at full height.
- **No layout timers:** Rely on the host’s `onGlobalLayout` for a single “measured” signal. Do not reintroduce stability timers, forced height locks, or timeouts that compete with the coordinator.
- **Instrument renders:** Log the `rootId`, host height, and applied content height whenever we render or dispose a screen. This makes it obvious which root is active and prevents silent regressions.

## Action Items for the New Implementation

1. Mirror the `react-native-screens` structure: a `ScreensCoordinatorLayout`-style host with `AppBarLayout` + `Toolbar`, and a `Fragment` surface sized via layout params (not padding).
2. Gate the JS stack with the native flag so only one renderer is active at a time.
3. Keep the runtime `RuneRootView` for overlays/dev tooling, but ensure it never renders app scenes once native mode is enabled.
4. Treat host measurement as the single source of truth; when the host reports a new size (rotation, inset change), resize the fragment surface immediately without waiting for multiple stability samples.

Document prepared so we can reference these pitfalls while rebuilding on top of `react-native-screens`.
