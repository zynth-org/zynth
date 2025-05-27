# Rune Bottom Sheet (iOS)

Native implementation for the `@rune/bottom-sheet` component on iOS (`RuneBottomSheetView`, presenter, bridge descriptor, etc.).

## Platform requirements

- Requires iOS 16.0+ (uses `UISheetPresentationController` custom detents).
- Built with Swift + Objective-C bridge. All source lives under `ios/src`.
- Exposed to Rune through `SNUIManager+RuneBottomSheet` descriptor and the `rune-bottom-sheet` component type.

## Feature overview

The presenter (`RuneBottomSheetPresenter`) wraps `UISheetPresentationController` to provide:

- Custom detents resolved from the JS `snapPoints` prop (`number` or `"xx%"` strings).
- Programmatic control via JS commands (open/close/snapTo) mapped to presenter methods.
- Overlay customization (`overlayColor`, `overlayOpacity`, `dismissOnOverlayPress`). Overlay tap dismisses by calling `dismiss()`.
- Controlled/uncontrolled open state with `onOpenChange`, `onDismiss`, and `onSnapChange` events dispatched through the manager.
- The new `allowDismissOnInteraction` prop toggles every user-driven dismissal path (swipe/grabber + overlay tap). When `false`, the sheet may only be closed programmatically.

## Limitations / known behaviors

- Because we rely on `UISheetPresentationController`, UIKit always adds its own dimming view and respects safe-area insets at the bottom. We insert our overlay underneath, but the system dimming view cannot be styled via public API.
- The bottom safe area inside the sheet cannot be removed without replacing the presentation controller.
- `allowDismissOnInteraction={false}` blocks both swipe dismissal and overlay taps; `dismissOnOverlayPress` only works when the interaction prop is `true`.
- Programmatic `close()` now routes through `completeDismiss()` so snap/open/dismiss callbacks fire even when the sheet is dismissed imperatively.

## Development notes

- Register new props/events in `SNUIManager+RuneBottomSheet.m`, then add setters to `RuneBottomSheetView.swift` and wire them into `RuneBottomSheetPresenter.swift`.
- When adding props that affect presentation, update `RuneBottomSheetOptions` to keep state centralized.
- Any changes that require behavior beyond what `UISheetPresentationController` offers (custom dimming, ignoring safe area, etc.) will need a bespoke presentation controller in the future.
