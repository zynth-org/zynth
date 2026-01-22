# Zynth Development Roadmap

This document outlines the current status and future development plan for the Zynth framework.

---

## Current Framework Status

### Core Runtime

- [x] @zynth/core: Universal renderer and bridge protocol.
- [x] @zynth/android: Native Android runtime (ZynthKit).
- [x] @zynth/ios: Native iOS runtime (ZynthKit).
- [x] @zynth/hypervisor: Isolated guest runtime hosting.

### UI & Layout

- [x] @zynth/components: Core native primitives (View, Text, FlatList, etc).
- [x] @zynth/ui: Themed high-level components.
- [x] @zynth/animate: Shared value animation system.
- [x] @zynth/icons: Font-based multi-set icon library.
- [x] @zynth/safe-area: Native inset handling.
- [x] @zynth/keyboard: Keyboard avoidance and management.
- [x] @zynth/bottom-sheet: Native gesture-driven sheets.

### Navigation

- [x] @zynth/memory-router: JS-state navigation (Stack, Tabs, BottomSheet).
- [x] @zynth/screens: Native screen container primitives.

### System APIs

- [x] @zynth/apis: Platform, Dimensions, and Font management.
- [x] @zynth/filesystem: Native file and directory access.
- [x] @zynth/async-storage: Persistent unencrypted storage.
- [x] @zynth/secure-store: Encrypted keychain storage.
- [x] @zynth/haptics: Native vibration feedback.
- [x] @zynth/image-picker: Camera and gallery access.
- [x] @zynth/webserver: Embedded HTTP server.
- [x] @zynth/splash-screen: Boot screen control.

### Tooling

- [x] @zynth/cli: Project management and build orchestration.
- [x] @zynth/rsbuild-plugin: Build configuration for Native/Web.
- [x] @zynth/templates: Project scaffolding blueprints.
- [x] @zynth/skyhook: AI-powered generation backend.

---

## Pending Tasks

## Bad Behaviors

- [ ] Improve bundle monorepo to a setup script with steps and order build commands.
- [ ] zynth-ui TextInput use SytemGlyphs for icons on Android.
- [ ] zynth-ui Custom slider doesn't keep on the selected position when released on Android.
- [ ] Android: BottomSheet doesn't remove the backdrop when is set.
- [ ] Create a new BottomSheet from scratch.
- [ ] Elevation discrepancy between iOS and Android.
- [ ] Individual Rounded corners have discrepancy between iOS and Android.
- [ ] iOS: Reload Hypervisor doesn't clean the redbox.
- [ ] iOS: Transparency buttons doesn't works.
- [ ] iOS: DatePicker imperative won't open.

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

- [ ] Lean Core Refactor: Ensure @zynth/core contains ZERO components, only the engine.
- [ ] StyleSheet API: Implement a StyleSheet.create for style de-duplication and native optimization.
- [ ] Hermes Intl: Enable native Intl support on Android (fbjni initialization).
- [ ] Brand new RedBox.
- [ ] Dev information strip.
- [ ] iOS connect to HRM dev Android server.

### Component Refinements

- [ ] TextInput iOS: Fix toggle blink issues.
- [ ] ScrollView Parity: Resolve height (iOS) vs minHeight (Android) declaration requirements.

### System APIs

- [ ] @zynth/apis expansion: - [ ] AppState (active/background detection). - [ ] Network (connectivity monitoring). - [ ] Device (model, version, serial info).
- [ ] Unified Permissions: Create @zynth/permissions for a single API to request all system access.

---
