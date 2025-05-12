# Native Bottom Sheet Plan (Android)

## Context
Rune's Android router already supports `push` and `modal` presentations (see `RouterScreenOptions`), but the current UI stack lacks a true bottom sheet overlay with snap points, a scrim, and adaptive content sizing. The goal is to introduce a native bottom sheet component with platform-agnostic props, reusable JS defaults, and a clean Retrofit integration with the router.

## Goals
- Treat bottom sheets like modal screens that register through the existing router registry so navigation and stack events remain consistent.
- Provide a JS-friendly API that allows defining snap points (`[number | string]`), an initial index, overlay behavior, scrollable content, and style overrides without touching native code.
- Implement a native host (`RuneBottomSheetLayout`) that exposes a scrim, snap sheet container, and a `RuneRootView` constrained to the active snap height.
- Emit snap change events and provide listeners so apps can respond to state transitions (e.g., `onSnapChange`, `onDismiss`).
- Keep surface disposal policies (delayed like modals) and renderer notifications intact so the existing runtime lifecycle logic requires minimal changes.

## API direction
- Extend `ScreenPresentation` to include `"bottomSheet"` and add an optional `bottomSheetOptions` payload to `ScreenOptions`.
- Define a `BottomSheetOptions` interface in TypeScript with fields such as:
  * `snapPoints: Array<number | string>` (`"50%"` resolves to viewport height, numbers are dp).
  * `initialIndex?: number`.
  * `overlayColor?: string` and `overlayOpacity?: number`.
  * `dismissOnOverlayPress?: boolean`.
  * `onSnapChange?: (index: number, progress: number) => void`.
  * `style?: CSSProperties`.
  * `contentContainerStyle` for the inner holder to cap height.
- Introduce a Solid helper component (e.g., `<BottomSheet />`) that renders default rounded corners, a drag handle, and a scrollable content wrapper sized to the sheet height.

## Native integration path
- Introduce a `RuneBottomSheetFragment` that mirrors `RouterScreenFragment` but inflates a coordinator layout with a `FrameLayout` for the scrim and a container tied to a custom `BottomSheetBehavior`.
- Create `RuneBottomSheetLayout` which:
  * Manages a semi-transparent scrim view behind the sheet that fades in/out when `hostLayout.setBottomSheetActive()` is invoked.
  * Applies `BottomSheetBehavior` to the content container and resolves snap points by translating `%` values against the available height.
  * Hosts a `RuneRootView` inside a `MaxHeightFrameLayout` so Solid content never expands beyond the current snap height while still allowing internal scrolling.
  * Hooks into behavior callbacks to emit snap changes to the runtime and to notify the router when the sheet is nearly closed.
- Update `RouterScreenOptions.fromMap`/`fromBundle` to parse bottom sheet config and pass it through `RouterScreenRequest`.
- Adjust `RuneNavigationContainer.push` to instantiate the new fragment when `options.presentation == BOTTOM_SHEET`, and keep overlay tracking aligned so the router shows a scrim cover (new flag in `RuneNavigationHostLayout`).
- Keep `shouldDelaySurfaceDispose` logic for sheets so the overlay can animate out before the surface is removed.

## Router/Runtime bridge
- Extend the native bridge module (`packages/rune-android-router/src/nativeBridge.ts`) with new methods/events:
  * `callNative("presentBottomSheet", payload)` if the sheet is driven by a dedicated module.
  * Emit events like `rune.androidRouter.bottomSheetSnap` when the sheet rests on a new snap or is dragged (forwarded to Solid hooks/listeners).
- Solid screens can subscribe via `globalThis` event listeners or the navigation context to receive snap updates and dismissal notices.

## Proposed next steps
1. Document and agree on the TypeScript props + default styles for `BottomSheet` so Solid code can render content immediately.
2. Scaffold a standalone `packages/rune-android-bottom-sheet` package with the host layout + behavior logic; validate the snapping math and scrim animation via a test app.
3. Wire the new package into `rune-android-router` by recognizing the `bottomSheet` presentation and instantiating `RuneBottomSheetFragment`.
4. Add runtime events/dispatch hooks and the necessary option serialization to keep navigation events aligned.
5. Treat this module as a reusable dependency for any future host (including the planned iOS router) so we can reapply the same API surface.
