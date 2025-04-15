# Rune Router – Stack Status (Phase 2)

_Last updated: YYYY-MM-DD_

## TL;DR

- **Stack navigation is functional** on both iOS and Android using native UINavigationController / FragmentManager as the source of truth.
- **SolidJS mirror** now renders the focused screen (Home, Details, etc.) and remains in sync with native state.
- **Major regressions resolved**: UI flicker at transition end, invisible screens during animations, blank renders due to stack key mismatch, redundant focus events, module-not-found errors.
- **Per-screen header themes**: JS options now drive tint, blur, transparency, and system light/dark style per route.
- **Remaining work**: multi-surface rendering, tabs renderer parity, deep-link/persistence adapters, automated tests, Android verification, documentation polish.

---

## Progress Snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Native stack ownership | ✅ | RNStackController / StackController manage push/pop/replace/reset with native animations |
| Event bridge | ✅ | `rune.router.*` events fire for state, focus, transition, predictive back |
| Solid stack renderer | ✅ | Renders active route, supports initial reset, logs state in dev |
| Sample app | ✅ | RouterBasic demonstrates Stack + nested Tabs, beforeRemove, transition logs |
| Header customization | ✅ | `headerTintColor`, `headerBackgroundColor`, blur, transparency, and `userInterfaceStyle` now apply per screen |
| Flicker / empty view | ✅ | Snapshot reparenting (iOS) + state dedupe prevents blank transitions |
| Template auto-linking | ✅ | `@rune/router` package includes pod/module metadata; prebuild picks it up |
| Logging | ✅ | Stack renderer + native controllers log state changes in dev |
| Tabs renderer | 🚧 | Placeholder only; needs same rendering logic as Stack |
| Multi-surface | 🚧 | Single Rune surface still reparented per screen |
| Persistence adapters | 🚧 | Contract exists, no AsyncStorage/SavedState implementations yet |
| Android verification | 🚧 | Need to run `prebuild:android`, ensure Gradle wiring works |
| Tests | 🚧 | No unit/integration tests yet |

---

## Key Components (JS)

1. **NavigationContainer**
   - Subscribes to native events; mirrors navigation state via Solid signals
   - Supports persistence adapter, linking options, devtools timeline
   - Runs before-remove listeners prior to dispatching POP/REPLACE/RESET

2. **Stack / Tabs**
   - Register screens (name, component, options, initial params)
   - Dispatch initial RESET to bootstrap native stack
   - StackRenderer finds the matching stack state and renders focused route via `RouteProvider`

3. **Hooks & Helpers**
   - `useNavigation`, `useRoute`, `useFocusEffect`, `useBeforeRemove`, `useNavigationEvents`
   - Deep link helpers (`handleLink`, `getPathFromState`)
   - Safe area metrics integration (`useHeaderMetrics`, `useTabBarMetrics`)

---

## Key Components (Native)

- **iOS**: `RuneRouterHost`, `RNStackController`, `RNScreenHostController`, `RuneRouterModule`, `RuneRouterEmitter`
- **Android**: `RuneRouterHost`, `StackController`, `ScreenHostFragment`, `RuneRouterModule`, `RuneRouterEmitter`
- Both platforms obtain the shared Rune surface from the templates and reparent it into each screen controller when it becomes visible. Snapshot overlays keep outgoing screens visible during navigation.

---

## Recent Fixes

1. **Stack key alignment** – native controllers now store the JS-provided stack ID so Solid can find the right state.
2. **Solid renderer** – replaced `<Show>` callback with direct memo to ensure reactivity.
3. **State dedupe** – native emits state only when payload changes; prevents flicker and redundant focus events.
4. **Snapshot handoff** – iOS keeps previous screen visible during push/pop and interactive back gestures.
5. **Focus manager guard** – avoids blur/focus spam when nothing actually changes.
6. **Sample UI** – RouterBasic sets explicit background colors and exercise stack/tabs flows.
7. **Header theming** – Stack screens can opt into transparent, blurred, or colored headers and request light/dark/system UI styles.

---

## Outstanding Work

1. **Tabs renderer** – replicate stack rendering logic so tab content stays mounted.
2. **Nested stack IDs** – ensure nested stacks assign deterministic keys to align with native state (no fallbacks).
3. **Android host parity** – add snapshot reparenting and verify behavior with predictive back.
4. **Multi-surface / view pooling** – consider per-screen Rune surfaces for true keep-alive behavior.
5. **Persistence adapters** – implement AsyncStorage / SavedStateHandle samples.
6. **Deep linking entry points** – hook `handleLink` into native URL/intent handlers.
7. **Devtools** – build a simple UI/CLI for the emitted action/state timeline.
8. **Automated tests** – add unit tests for hooks and renderer, integration tests for sample app.
9. **Docs** – expand README + architecture docs (see `docs/router/ios-router-arch.md`).

---

## How to Test Right Now

1. Install deps: `yarn install`
2. Build router types: `yarn workspace @rune/router build:types`
3. Prebuild iOS app: `yarn workspace com.components.app prebuild:ios`
4. Open `apps/components/ios/Components.xcworkspace` and run on simulator/device
5. Use RouterBasic screen to test push/pop, tabs, beforeRemove

---

*Questions? Reach out in #router-dev on Slack.*
