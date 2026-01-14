# Gemini Context: Rune Framework

## Project Overview

**Rune** is an experimental hybrid UI runtime that brings **SolidJS-style reactivity** to native platforms (iOS and Android). It allows developers to build native applications using SolidJS, providing fine-grained reactivity without a virtual DOM, while rendering to true native UI components.

The project is a **monorepo** managed with Yarn Workspaces.

### Core Architecture

- **Reactive Engine:** SolidJS (running in a JS environment, likely JavaScriptCore on iOS / Hermes on Android).
- **Renderer:** `@rune/core` implements a custom solid-js universal renderer that bridges calls to native modules.
- **Native SDKs:**
  - `packages/rune-ios`: Swift/Objective-C implementation (`RuneKit`).
  - `packages/rune-android`: Kotlin/C++ implementation.
- **Router:** `@rune/router` provides native navigation primitives (Stacks, Modals, Tabs) that integrate with the native view controller hierarchies (`UINavigationController`, `FragmentTransaction`, etc.).
- **CLI:** `@rune/cli` orchestrates the build, prebuild, and bundle processes, copying templates and resolving native dependencies.

## Key Directories

- `apps/`
  - `apps/components`: The primary testbed/demo application. Contains examples of all components and router features.
- `packages/`
  - `rune-core`: Platform-agnostic renderer logic.
  - `rune-memory-router`: Cross-platform native router implementation.
  - `rune-ios` / `rune-android`: Core native bridges.
  - `rune-components`: Core UI components (View, Text, Image, ScrollView).
  - `rune-cli`: The `rune` command-line tool.
- `scripts/`: Helper scripts for generation and synchronization.

## Development Workflow

### Building and Running

Most commands should be run from the root or the specific app directory (`apps/components`).

**From `apps/components`:**

- **Start JS Dev Server & Open iOS:**
  ```bash
  yarn dev:ios
  ```
- **Start JS Dev Server & Open Android:**
  ```bash
  yarn dev:android
  ```
- **Regenerate Native Projects (Prebuild):**
  Use this when adding new native packages or changing configuration.
  ```bash
  yarn prebuild:ios
  yarn prebuild:android
  ```
- **Reset Native Projects:**
  Cleans and recreates the `ios` and `android` folders from templates.
  ```bash
  yarn reset:ios
  yarn reset:android
  ```

### Common Tasks

- **Adding a new Component:**

  1.  Define the JS interface in `packages/rune-components`.
  2.  Implement the native view in `packages/rune-components/ios` (Swift) and `packages/rune-components/android` (Kotlin).
  3.  Register the view manager in the respective native SDKs.

- **Router Debugging:**
  - **iOS:** `packages/rune-memory-router/ios/RuneRouter/RNStackController.swift` manages the navigation stack.
  - **Android:** `packages/rune-android-router/android` manages Fragments/Activities.
  - **JS:** `packages/rune-memory-router/src` contains the SolidJS context and actions.

## Conventions

- **Code Style:** Prettier is used for JS/TS.
- **Native Modules:** Distributed as source packages. `node_modules` paths are resolved at build time and linked into the native projects.
- **Safe Area:** Always use `@rune/safe-area` for handling notches and home indicators.
- **View Managers:** Follow the pattern of `RuneNativeView` (iOS) and `RuneNativeView` (Android) for properties and event bridging.
