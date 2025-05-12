# rune-bottom-sheet

This package will expose the shared SolidJS + native implementation for Rune's bottom sheet UI. It is currently in Phase 1 (scaffolding) and will later provide:

- A JS-friendly `<BottomSheet />` helper with snap points, overlay controls, and adaptive scroll handling.
- A native Android/C++ host that renders a scrim-backed sheet with custom `BottomSheetBehavior` snapping into place.
- `runeNative` metadata so Rune's CLI can link the native modules during prebuild.

The roadmap lives in `docs/router/bottom-sheet-native-plan.md` and the rollout phases are documented in `docs/new-native-module.md` under “Rune Bottom Sheet Rollout Plan”.
