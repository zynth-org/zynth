# @rune/router Parity Checklist

High-level tracker for bringing the unified router surface to feature parity across iOS and Android. JS consumers should only depend on `@rune/router`; anything listed here either needs an Android implementation or must be trimmed from the public API if it remains iOS-only.

## JS runtime gaps (Android)

- [x] **Route context & hooks** – Port `RouteProvider`, `createRouteContextValue`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, and `useNavigationEvents` so they run off the Android navigation state instead of just logging warnings.
  - ✅ JS hooks now wired to Android context; native renderer wraps screens with providers so hooks work.
- [x] **NavigationContainer state bridge** – Expose `getState`/`dispatch` parity on Android so `handleLink`, persistence, and deep-link helpers can work identically.
- [x] **Linking helpers** – Now that state/dispatch exist, wire `handleLink(url)` and `getPathFromState(state)` for Android.
- [x] **Reactive `setOptions` + `setParams`** – Mirror the Solid effect plumbing from iOS so Android screens can call `navigation.setOptions(() => …)` and `setParams` without warnings.
- [ ] **Tab/Stack JS renderers** – Evaluate whether we keep the iOS-style keep-alive scene management for Android tabs/bottom sheets or remove that surface entirely if the native host owns rendering.

## Native bridge gaps (Android)

- [x] **Event stream (focus/blur/back/state/tab metrics)** – Emit the shared `ROUTER_EVENT_*` events so the JS hooks stay platform-agnostic.
- [ ] **Transitions / before-remove** – Fill in transition events and complete the before-remove request/response loop with JS.
- [ ] **Before-remove guards** – Support `RouterContext`’s `beforeRemove` pipeline so Android can block navigation like iOS does.
- [x] **Tab/header metrics** – Replace the hard-coded fallbacks with actual measurements emitted from native (`ROUTER_EVENT_TAB_METRICS`) and read via `useHeaderMetrics`.
- [x] **Tabs + icons** – Reuse the shared `tabIconRegistry`/renderer surface so dynamic icons behave the same way on both platforms; ensure tab registration populates glyph data (`glyphFontFamily`, `glyphFontSize`, etc.).
- [ ] **Bottom-sheet descriptors** – Confirm Android registers sheets using the same descriptor format (options + snap points) so `ScreenOptions.bottomSheet` stays consistent.

## API trim/removal candidates

- [ ] Audit iOS-only header props (`headerBlurEffect`, `headerRightButton`, `userInterfaceStyle`) and decide whether to hide them or ship Android equivalents.
- [ ] Revisit presentation styles (modal/pageSheet/formSheet) to ensure unsupported ones don’t leak into Android builds.
- [ ] Confirm any `Tabs.TabBar` customization hooks that have no Android analog should be gated or documented as iOS-only.

## Developer-facing follow-ups

- [ ] Update docs/README once the missing pieces land so the public story explicitly calls out what’s implemented vs. in progress.
- [x] Add tests or sample routes in `apps/components` that cover the newly unified APIs as they become available on Android.