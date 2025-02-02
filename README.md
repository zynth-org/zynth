Rune — Hybrid SolidJS native framework

Overview

Rune is an experimental hybrid UI runtime that brings SolidJS-style reactivity to native platforms. The monorepo ships everything you need to scaffold and build Solid-driven native apps:

- A small renderer core (`@rune/core`) that provides the platform-agnostic reconciler.
- Source-distributed iOS (`@rune/ios` / `RuneKit`) and Android (`@rune/android`) SDKs that expose the native bridges.
- Templates (`@rune/templates`) and a CLI (`@rune/cli`) that automate prebuild, bundling, and reset flows.
- A development app workspace (`@demo/sn-demo`) used to iterate on the SDK.

Why Rune / Why Solid

- SolidJS reactivity: fine-grained reactivity with minimal runtime overhead.
- Predictable updates: deterministic update propagation with explicit signals and memoization.
- Fast rendering: minimal reconciliation thanks to Solid's model (no virtual DOM diffing).

Features

- Platform-agnostic renderer API in `@rune/core` for declaring UI once.
- Native SDKs published as source packages so downstream apps consume them directly from `node_modules`, mirroring React Native’s approach.
- Rune CLI that drives `prebuild`, `dev`, `bundle`, and `reset` flows for both platforms.
- Example app `apps/sn-demo` demonstrating the full development workflow.
- Rollup-based JS bundling with optional Hermes bytecode generation during Android prebuild.

Repository layout

- `apps/sn-demo` — development app workspace (`@demo/sn-demo`). Uses Rollup, consumes the SDK packages, and is the target for CLI commands (`rune dev ios | android`).
- `packages/rune-core` — platform-agnostic renderer and helper components (`@rune/core`).
- `packages/rune-ios` — iOS SDK sources (Objective-C/C++/Swift) and Podspec exported as `@rune/ios`.
- `packages/rune-android` — Android SDK sources (Kotlin/C++/CMake) exported as `@rune/android`.
- `packages/rune-templates` — app + native scaffolding copied during prebuild (`@rune/templates`).
- `packages/rune-cli` — CLI surface (`rune`) that orchestrates prebuild/dev/reset/bundle flows.
- `scripts` — thin Node helpers invoked by the CLI (shared logic currently lives here).
- `README.md`, `TODO.md`, etc. — documentation.

## Architectural Principles & API Design

**Objective:** To build a framework that is not only powerful but also intuitive, logical, and a pleasure to use, drawing inspiration from the clean, modular design of modern development tools.

-   **Lean Core:** The `@rune/core` package is the minimal runtime engine (renderer, reconciler, native bridge). All components, including primitives like `View` and `Text`, and APIs live in separate, dedicated packages.
-   **Modular Ecosystem:** The framework is composed of small, focused packages (e.g., `@rune/components`, `@rune/animation`, `@rune/apis`). This promotes separation of concerns, independent versioning, and better tree-shaking.
-   **Intuitive Naming:** File and folder names are explicit and predictable. API and component names are clear and self-documenting.
-   **Developer-First API:** APIs are designed for clarity and ease of use. For example, hooks are the primary interface for accessing framework features (`useAnimation`, `useDimensions`).
-   **Convention over Configuration:** The framework provides sensible defaults and a clear project structure out of the box, minimizing the need for boilerplate configuration. The CLI enforces these conventions.

---

## Quick start (development)

1. Install dependencies (root of repo):

```bash
cd /path/to/repo
yarn
```

2. Run the CLI-driven dev flows from the demo app workspace:

```bash
# iOS
yarn ios:dev       # builds JS bundle, regenerates native project, compiles, installs, launches simulator

# Android
yarn android:dev   # same flow, plus Gradle assemble/install (skips install if no device/emulator detected)
```

3. Regenerate native projects without launching:

```bash
yarn prebuild:ios
yarn prebuild:android
```

4. Clean native artifacts if you need to start fresh:

```bash
yarn reset:ios
yarn reset:android
```

Under the hood these commands invoke the Rune CLI, which copies templates from `@rune/templates`, resolves SDK sources from `node_modules`, and delegates to the shared scripts in `/scripts`.

Important notes & troubleshooting

- Workspace name conflicts: If you rename packages, ensure there aren't duplicate folders in Yarn workspaces. Remove stale copies before `yarn install`.
- Peer dependencies: `@rune/core` declares a peer dependency on `solid-js`; the consuming app must install it.
- Rollup aliasing: `apps/sn-demo/rollup.config.mjs` aliases imports to local sources for iteration — keep the paths updated if package locations change.
- iOS module imports: The app template still uses `#import "RuneKit.h"`. See `packages/rune-ios/TODO.md` for the follow-up task to move to `@import RuneKit;` once the module map is fully hardened.
- Android devices: `rune dev android` skips install if no device/emulator is detected. If Gradle reports an "Unknown API Level", make sure the emulator is booted and recognized by `adb devices`.

Contributing

Contributions are welcome. Open issues for bugs or design discussions. For larger changes, please open a PR with tests and a short explanation of the design tradeoffs.

License

MIT
