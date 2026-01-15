# Gemini Context: Rune Framework

## Project Overview

**Rune** is a high-performance hybrid UI runtime that brings **SolidJS** to native mobile platforms. Unlike React Native, Rune uses a **Universal Renderer** approach with **fine-grained reactivity**, eliminating the Virtual DOM entirely for surgical updates.

### Core Architecture

- **Engine:** [Hermes](https://hermesengine.dev/) on both iOS and Android. Supports bytecode precompilation and JSI.
- **Bridge:** Synchronous C++ **JSI (JavaScript Interface)**. No asynchronous JSON serialization overhead.
- **Renderer:** `@rune/core` acts as the SolidJS Host, translating reactive updates into native `createNode` / `setProp` instructions.
- **Layout:** [Yoga](https://yogalayout.dev/) (Flexbox) implemented natively.
- **Navigation:**
    - **State:** `@rune/memory-router` (Pure JS, React Navigation-like API).
    - **Views:** `@rune/screens` (Native `UINavigationController` / `Fragment` integration).
    - **Multi-App:** `@rune/hypervisor` allows embedding isolated Rune apps (Guests) inside a Host app.

## Package Map

| Package | Purpose |
| :--- | :--- |
| **Core** | |
| `@rune/core` | The SolidJS renderer, bridge protocol, and batched update queue. |
| `@rune/ios` | Native iOS runtime (Swift/ObjC/C++). "RuneKit". |
| `@rune/android` | Native Android runtime (Kotlin/C++). "RuneKit". |
| **UI & Interaction** | |
| `@rune/components` | Native primitives: `View`, `Text`, `Image`, `ScrollView`, `FlatList` (recycled). |
| `@rune/ui` | Themed component kit (`Card`, `Button`) and `UIThemeProvider`. |
| `@rune/animate` | 60fps animations on the UI thread (`useSharedValue`, `withSpring`). |
| `@rune/icons` | Font-based icon sets (FontAwesome, Ionicons, etc.). |
| **Navigation** | |
| `@rune/memory-router`| Stack/Tab/BottomSheet routers. Holds state in JS memory. |
| `@rune/screens` | Native container primitives for screen transitions. |
| `@rune/safe-area` | Insets for notches and home indicators. |
| **System Capabilities** | |
| `@rune/apis` | `Platform`, `Dimensions`, `Font`. |
| `@rune/filesystem` | Native file access (`read`, `write`, reactive signals). |
| `@rune/haptics` | Taptic engine feedback. |
| `@rune/keyboard` | Keyboard avoidance and observation. |
| `@rune/secure-store` | Keychain/Keystore access. |
| `@rune/splash-screen`| Startup screen control. |
| `@rune/image-picker` | Camera and Photo Library access. |
| `@rune/webserver` | Embedded HTTP server for local file sharing/uploads. |
| **Tooling & Platform** | |
| `@rune/cli` | The `rune` command (`dev`, `build`, `bundle`). |
| `@rune/rsbuild-plugin`| Rsbuild config for Native (Hermes) and Web targeting. |
| `@rune/templates` | Scaffolding for `rune create`. |
| `@rune/skyhook` | AI-powered backend for generating apps from prompts. |
| `@rune/hypervisor` | Runtime for loading dynamic bundles (Skyhook apps). |

## Development Workflow

### Primary Workspace: `apps/components`

This is the main testbed. It consumes the SDK packages from source (symlinked via Yarn Workspaces).

**Commands (run from project root or `apps/components`):**

*   **iOS Development:**
    ```bash
    yarn dev:ios
    ```
    *Bundles JS, generates Xcode project, installs pods, launches Simulator.*

*   **Android Development:**
    ```bash
    yarn dev:android
    ```
    *Bundles JS, generates Gradle project, installs APK, launches Emulator.*

*   **Prebuild Only:**
    ```bash
    yarn prebuild:ios      # Regenerate ios/ folder
    yarn prebuild:android  # Regenerate android/ folder
    ```

*   **Clean/Reset:**
    ```bash
    yarn reset:ios
    yarn reset:android
    ```

## Critical Mental Models

1.  **Solid, Not React:** Do not use `useState` or `useEffect`. Use `createSignal`, `createMemo`, and `createEffect`. Components run once; the reactivity graph stays alive.
2.  **No CSS:** Styles are JavaScript objects passed to the `style` prop. They map to Yoga properties (Flexbox).
3.  **Batching:** `rune-core` batches UI updates into microtasks. Native calls happen in chunks to maximize throughput.
4.  **Recycling:** `FlatList` recycles native views. Be careful when storing state in component instances within a list; it may be reset or reused.
5.  **Hypervisor:** Apps are not always "global". In a Hypervisor context, your app might be a small card inside another app. Avoid relying on global singletons if possible.

## Documentation References

*   **Architecture:** `docs/architecture.md` (Deep dive into internals)
*   **APIs:** See individual `packages/*/README.md` files.