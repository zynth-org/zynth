# @rune/router Parity Checklist

High-level tracker for bringing the unified router surface to feature parity across iOS and Android. JS consumers should only depend on `@rune/router`; anything listed here either needs an Android implementation or must be trimmed from the public API if it remains iOS-only.

## JS runtime gaps (Android)

- [ ] **Route context & hooks** – Port `RouteProvider`, `createRouteContextValue`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, and `useNavigationEvents` so they run off the Android navigation state instead of just logging warnings.
- [ ] **NavigationContainer state bridge** – Expose `getState`/`dispatch` parity on Android so `handleLink`, persistence, and deep-link helpers can work identically.
- [ ] **Linking helpers** – Once Android emits full `NavigationState`, hook up `handleLink(url)` and `getPathFromState(state)` rather than returning placeholders.
- [ ] **Reactive `setOptions` + `setParams`** – Mirror the Solid effect plumbing from iOS so Android screens can call `navigation.setOptions(() => …)` and `setParams` without warnings.
- [ ] **Tab/Stack JS renderers** – Evaluate whether we keep the iOS-style keep-alive scene management for Android tabs/bottom sheets or remove that surface entirely if the native host owns rendering.

## Native bridge gaps (Android)

- [ ] **Event stream** – Emit the shared `ROUTER_EVENT_*` events (focus/blur, transitions, before-remove, tab metrics) so the JS hooks stay platform-agnostic.
- [ ] **Before-remove guards** – Support `RouterContext`’s `beforeRemove` pipeline so Android can block navigation like iOS does.
- [ ] **Tab/header metrics** – Replace the hard-coded 56pt fallbacks with actual measurements emitted from native (`ROUTER_EVENT_TAB_METRICS`) and read via `useHeaderMetrics`.
- [ ] **Tabs + icons** – Reuse the shared `tabIconRegistry`/renderer surface so dynamic icons behave the same way on both platforms; ensure tab registration populates glyph data (`glyphFontFamily`, `glyphFontSize`, etc.).
- [ ] **Bottom-sheet descriptors** – Confirm Android registers sheets using the same descriptor format (options + snap points) so `ScreenOptions.bottomSheet` stays consistent.

## API trim/removal candidates

- [ ] Audit iOS-only header props (`headerBlurEffect`, `headerRightButton`, `userInterfaceStyle`) and decide whether to hide them or ship Android equivalents.
- [ ] Revisit presentation styles (modal/pageSheet/formSheet) to ensure unsupported ones don’t leak into Android builds.
- [ ] Confirm any `Tabs.TabBar` customization hooks that have no Android analog should be gated or documented as iOS-only.

## Developer-facing follow-ups

- [ ] Update docs/README once the missing pieces land so the public story explicitly calls out what’s implemented vs. in progress.
- [ ] Add tests or sample routes in `apps/components` that cover the newly unified APIs as they become available on Android.
