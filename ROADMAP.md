# Rune Development Roadmap

This document outlines the current status and future development plan for the Rune framework.

---

## Current Framework Status

### Core Runtime

[x] @rune/core: Universal renderer and bridge protocol.
[x] @rune/android: Native Android runtime (RuneKit).
[x] @rune/ios: Native iOS runtime (RuneKit).
[x] @rune/hypervisor: Isolated guest runtime hosting.

### UI & Layout

[x] @rune/components: Core native primitives (View, Text, FlatList, etc).
[x] @rune/ui: Themed high-level components.
[x] @rune/animate: Shared value animation system.
[x] @rune/icons: Font-based multi-set icon library.
[x] @rune/safe-area: Native inset handling.
[x] @rune/keyboard: Keyboard avoidance and management.
[x] @rune/bottom-sheet: Native gesture-driven sheets.

### Navigation

[x] @rune/memory-router: JS-state navigation (Stack, Tabs, BottomSheet).
[x] @rune/screens: Native screen container primitives.

### System APIs

[x] @rune/apis: Platform, Dimensions, and Font management.
[x] @rune/filesystem: Native file and directory access.
[x] @rune/async-storage: Persistent unencrypted storage.
[x] @rune/secure-store: Encrypted keychain storage.
[x] @rune/haptics: Native vibration feedback.
[x] @rune/image-picker: Camera and gallery access.
[x] @rune/webserver: Embedded HTTP server.
[x] @rune/splash-screen: Boot screen control.

### Tooling

[x] @rune/cli: Project management and build orchestration.
[x] @rune/rsbuild-plugin: Build configuration for Native/Web.
[x] @rune/templates: Project scaffolding blueprints.
[x] @rune/skyhook: AI-powered generation backend.

---

## Pending Tasks

### Core Framework

[ ] Lean Core Refactor: Ensure @rune/core contains ZERO components, only the engine.
[ ] StyleSheet API: Implement a StyleSheet.create for style de-duplication and native optimization.
[ ] Hermes Intl: Enable native Intl support on Android (fbjni initialization).

### Component Refinements

[ ] TextInput Android: Resolve focus/blur inconsistencies and performance issues.
[ ] TextInput iOS: Fix toggle blink issues.
[ ] ScrollView Parity: Resolve height (iOS) vs minHeight (Android) declaration requirements.
[ ] Button Parity: Ensure high-fidelity native look and feel on both platforms.
[ ] FlatList Optimization: Fix "empty first frame" when itemSize is not provided.

### System APIs

[ ] @rune/apis expansion: - [ ] AppState (active/background detection). - [ ] Network (connectivity monitoring). - [ ] Device (model, version, serial info).
[ ] Unified Permissions: Create @rune/permissions for a single API to request all system access.

---

## Known Bugs

[!] Android: Previous screen touch events are active under current screen.
[!] Android: Bottom tab icons sometimes render twice during rapid switching.
[!] iOS: Font registration occasionally requires a double RAF to sync with native registry.
