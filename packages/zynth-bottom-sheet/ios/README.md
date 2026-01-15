# Zynth Bottom Sheet (iOS)

Native implementation for the `@zynth/bottom-sheet` component on iOS (`ZynthBottomSheetView`, presenter, bridge descriptor, etc.).

## Platform requirements

- Requires iOS 16.0+ (uses `UISheetPresentationController` custom detents).
- Built with Swift + Objective-C bridge. All source lives under `ios/src`.
- Exposed to Zynth through `SNUIManager+ZynthBottomSheet` descriptor and the `zynth-bottom-sheet` component type.

## Feature overview

The presenter (`ZynthBottomSheetPresenter`) wraps `UISheetPresentationController` to provide:

- Custom detents resolved from the JS `snapPoints` prop (`number` or `"xx%"` strings).
- Programmatic control via JS commands (open/close/snapTo) mapped to presenter methods.
- Overlay customization (`overlayColor`, `overlayOpacity`, `dismissOnOverlayPress`, `showOverlay`). Overlay tap dismisses by calling `dismiss()`.
- Background interaction control through the `allowBackgroundInteraction` prop. When enabled, UIKit’s dimming view is removed so content behind the sheet stays interactive—pair with `showOverlay={false}` for an Apple Maps-style experience.
- Controlled/uncontrolled open state with `onOpenChange`, `onDismiss`, and `onSnapChange` events dispatched through the manager.
- The new `allowDismissOnInteraction` prop toggles every user-driven dismissal path (swipe/grabber + overlay tap). When `false`, the sheet may only be closed programmatically.

## Limitations / known behaviors

- Because we rely on `UISheetPresentationController`, UIKit adds its own dimming view and respects safe-area insets at the bottom. Use `allowBackgroundInteraction` when that dimming view (and the tap interceptor) needs to go away completely.
- The bottom safe area inside the sheet cannot be removed without replacing the presentation controller.
- `allowDismissOnInteraction={false}` blocks both swipe dismissal and overlay taps; `dismissOnOverlayPress` only works when the interaction prop is `true`.
- Programmatic `close()` now routes through `completeDismiss()` so snap/open/dismiss callbacks fire even when the sheet is dismissed imperatively.

## Development notes

- Register new props/events in `SNUIManager+ZynthBottomSheet.m`, then add setters to `ZynthBottomSheetView.swift` and wire them into `ZynthBottomSheetPresenter.swift`.
- When adding props that affect presentation, update `ZynthBottomSheetOptions` to keep state centralized.
- Any changes that require behavior beyond what `UISheetPresentationController` offers (custom dimming, ignoring safe area, etc.) will need a bespoke presentation controller in the future.
