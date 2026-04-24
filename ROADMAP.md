# Zynth Development Roadmap

This document outlines the current status and future development plan for the Zynth framework.

---

## Current Framework Status

### Core Runtime

- [x] @zynthjs/core: Universal renderer and bridge protocol.
- [x] @zynthjs/android: Native Android runtime (ZynthKit).
- [x] @zynthjs/ios: Native iOS runtime (ZynthKit).
- [x] @zynthjs/hypervisor: Isolated guest runtime hosting.

### UI & Layout

- [x] @zynthjs/components: Core native primitives (View, Text, FlatList, etc).
- [x] @zynthjs/ui: Themed high-level components.
- [x] @zynthjs/animate: Shared value animation system.
- [x] @zynthjs/icons: Font-based multi-set icon library.
- [x] @zynthjs/safe-area: Native inset handling.
- [x] @zynthjs/keyboard: Keyboard avoidance and management.
- [x] @zynthjs/bottom-sheet: Native gesture-driven sheets.

### Navigation

- [x] @zynthjs/router: JS-state navigation (Stack, Tabs, BottomSheet).
- [x] @zynthjs/screens: Native screen container primitives.

### System APIs

- [x] @zynthjs/apis: Platform, Dimensions, and Font management.
- [x] @zynthjs/filesystem: Native file and directory access.
- [x] @zynthjs/async-storage: Persistent unencrypted storage.
- [x] @zynthjs/secure-store: Encrypted keychain storage.
- [x] @zynthjs/haptics: Native vibration feedback.
- [x] @zynthjs/image-picker: Camera and gallery access.
- [x] @zynthjs/webserver: Embedded HTTP server.
- [x] @zynthjs/splash-screen: Boot screen control.

### Tooling

- [x] @zynthjs/cli: Project management and build orchestration.
- [x] @zynthjs/rsbuild-plugin: Build configuration for Native/Web.
- [x] CLI-bundled templates: Project scaffolding blueprints.
- [x] @zynthjs/skyhook: AI-powered generation backend.
- [ ] iOS project generation cleanup: move inline `project.yml` bundle packaging logic into a generated script and validate XcodeGen build phases. See `docs/ios-project-generation-migration.md`.

---

## Pending Tasks

## SharedSignal + Worklets (Native-First Skia)

This track hardens `@zynthjs/skia` so animation hooks and shader pipelines stay UI-thread/native by default and avoid JS resubmit loops.

### Objectives

- One command submit should be sufficient for continuous shared-signal-driven rendering.
- Shared-signal updates from native/worklet runtimes must invalidate only affected surfaces.
- Hook internals must emit native-bindable values (token-capable), not JS polling wrappers.
- Validation must include measurable frame-budget/perf gates, not only visual checks.

### Current Status

- [x] Packed scalar protocol v2 (`literal` + `sharedSignal(id,snapshot)`), JS encoder + native decoders.
- [x] Declarative compile path preserves shared-signal tokens across geometry/paint/runtime uniforms.
- [x] Native draw-time shared-signal resolution on Android + iOS.
- [x] Signal-to-surface invalidation wiring (`surface -> signals`, `signal -> surfaces`) on Android + iOS.
- [x] JS-block proof demo (`SkiaNativeSharedSignalDriveExample`) confirms native render updates when JS stalls.
- [x] Runtime shader effect caching added in native renderers (avoid `SkRuntimeEffect::MakeForShader` on each draw path).
- [ ] Formal perf gates with reproducible metrics and pass/fail thresholds.
- [ ] Cleanup hardening pass (dispose/unmount mapping audits, regression tests).
- [ ] Hook implementation phase (`useClock`, `usePathInterpolation`, `usePathValue`) on top of native token pipeline.

## Bad Behaviors

- [x] Improve zynth-cli
- [x] zynth-ui TextInput use SytemGlyphs for icons on Android.
- [ ] zynth-network Warn about app.json Info.plist information left
- [ ] Investigate this HMR Error: ` WARN  [HMR] unexpected require(./src/App.tsx) from disposed module ../../packages/zynth-core/src/hmr.ts
WARN  [HMR] unexpected require(./src/components/styles/GradientExample.tsx) from disposed module ../../packages/zynth-core/src/hmr.ts`
- [ ] Improve templates of CLI, avoid ios and android packages
- [ ] zynth-cli Hook for third-party native packages
- [ ] zynth-ui Custom slider doesn't keep on the selected position when released on Android.
- [x] Android: BottomSheet doesn't remove the backdrop when is set.
- [?] Android: AsyncStorage sometimes didn't load/set on startup
- [x] Android: WARN [KeyboardProvider] Native keyboard module not found. Keyboard state will show as hidden. Make sure the native platform has initialized the module.
- [x] Create a new BottomSheet from scratch.
- [ ] Elevation discrepancy between iOS and Android.
- [ ] Individual Rounded corners have discrepancy between iOS and Android.
- [ ] iOS: Reload Hypervisor doesn't clean the redbox.
- [ ] iOS: Transparency buttons doesn't works.
- [ ] iOS: Custom CLI output when the app doesn't have the correct icons set, instead of the Xcode error
- [ ] Peer dep screens on router package.
- [ ] Autolink on new native packages.
- [x] iOS: DatePicker imperative won't open.
- [x] iOS: Stack Modal bug that return to details with.
- [x] iOS: Crash on `TextHighRefreshSignalExample`
- [x] iOS: Doest put the defaultValue on `TextInputsTest`
- [x] Android: Pressable many errors
- [x] Android: HypervisorDemo keeps the fallback loading text after success bundle load
- [?] Android: AsyncStorageExample discrepancy
- [x] Android: WebView first render like 2s displaying all screen.
- [x] Android: Contacts animation broken.
- [x] FlatList with decorators have a SolidJS owner warning
- [x] Migrate zynth-screens to new Runtime
- [x] Won't load system icons
- [x] Android: Modal blink on open
- [?] Android: KeyboardAvoidingView won't works sometimes
- [x] Android: Modal take top inset as a space and move the content below
- [?] FlatList: Item height expand on fast scroll
- [ ] iOS: BorderRadius change on press for disable state change
- [x] Migrate zynth-animate to new Runtime
- [x] Migrate zynth-apis to new Runtime
- [x] Migrate zynth-async-storage to new Runtime
- [x] Migrate zynth-bottom-sheet to new Runtime
- [x] Migrate zynth-components to new Runtime
- [x] Migrate zynth-filesystem to new Runtime
- [x] Migrate zynth-haptics to new Runtime
- [x] Migrate zynth-hypervisor to new Runtime
- [x] Migrate zynth-icons to new Runtime
- [x] Migrate zynth-image-picker to new Runtime
- [x] Migrate zynth-keyboard to new Runtime
- [x] Migrate zynth-markdown to new Runtime
- [x] Migrate zynth-router to new Runtime
- [x] Migrate zynth-secure-store to new Runtime
- [x] Migrate zynth-splash-screen to new Runtime
- [x] Migrate zynth-ui to new Runtime
- [x] Migrate zynth-webserver to new Runtime

- [x] Android: Keyboard Avoiding View: Fix inconsistent behavior on Android when set `height` as `bahavior`
- [x] When load Menu using HMR we have `[unhandled] Module Font resource 'ZynthIconsBS.ttf' not found in any bundle. not found.
- [x] TextInput on iOS don't center the text when declare `paddingVertical`.
- [x] ProgressIndicator on iOS display a glitch when return from stop, first frame display it on 0x0 on his parent container.
- [x] Android ScrollView/VerticalFeed demo has a visual issue when scroll down, the content go outside of the container, as vertical overflow, only on Controller API, FlatList demo doesn't have this issue.
- [x] Android: Horizontal snap demo doesn't work, it display the items but doesn't allow scroll on them.
- [x] Android: Resolve Pressable vs ScrollView gesture conflicts.
- [x] Android: Pressable ripple effect is not clipped on the component, and show outside like a circle.
- [x] iOS|Android: Pressable Doesn't cancel/blur the focus imperative.
- [x] iOS: Nested text are not displaying bold styles.
- [x] iOS: Icon didn't display when we add a new provider on `TwoFAManager.tsx`example.
- [x] Android: AppHub weather asset image didn't display, Local image doesn't works on Android.
- [x] GlassView overflow on`AppHub` example.
- [x] iOS: Nested modal on iOS have a double animation, the animation repeat when it finish the first one.
- [x] iOS: Border radius clip element on high values.

### Core Framework

- [x] Lean Core Refactor: Ensure @zynthjs/core contains ZERO components, only the engine.
- [ ] StyleSheet API: Implement a StyleSheet.create for style de-duplication and native optimization.
- [ ] Hermes Intl: Enable native Intl support on Android (fbjni initialization).
- [ ] Brand new RedBox.
- [ ] Dev information strip.
- [ ] iOS connect to HRM dev Android server.

### Component Refinements

- [ ] ScrollView Parity: Resolve height (iOS) vs minHeight (Android) declaration requirements.

### System APIs

- [x] @zynthjs/apis expansion: - [x] AppState (active/background detection). - [x] Network (connectivity monitoring). - [x] Device (model, version, serial info).
- [ ] Unified Permissions: Create @zynthjs/permissions for a single API to request all system access.

---
