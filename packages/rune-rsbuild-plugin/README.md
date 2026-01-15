# @rune/rsbuild-plugin

The official Rsbuild plugin for Rune applications.

This package provides the build configuration and tooling required to compile Rune apps for both Native (iOS/Android) and Web platforms. It abstracts away the complexity of configuring Rsbuild/Rspack for the unique requirements of the Rune runtime (Hermes) and the SolidJS universal renderer.

## Features

*   **Dual-Platform Support**: Automatically switches between Native and Web build configurations based on the target platform.
*   **Monorepo Support**: Automatically discovers and aliases `@rune/*` packages to their source files, enabling a seamless "edit-refresh" loop for framework development.
*   **Hermes Compatibility**: Shims browser-specific code (HMR clients, CSS injection) that would crash the native JS engine.
*   **SolidJS Integration**: Configures the Babel preset for SolidJS, selecting the `universal` output for Native and `dom` for Web.
*   **Asset Management**: Custom handling for image assets to support native resolution strategies.

## Usage

In your `rsbuild.config.ts`:

```ts
import { defineRuneConfig } from "@rune/rsbuild-plugin";

export default defineRuneConfig({
  // Your standard Rsbuild config here
  source: {
    entry: {
      index: "./src/index.tsx",
    },
  },
}, {
  // Rune-specific options
  platform: process.env.RUNE_PLATFORM as "ios" | "android" | "web",
});
```

## Configuration

### `defineRuneConfig(config, options)`

A wrapper around `defineConfig` that applies Rune's defaults.

#### Options

*   `platform`: The target platform (`ios`, `android`, `web`). Defaults to `ios` or `process.env.RUNE_PLATFORM`.
*   `babel`: Options for the internal Babel plugin.
    *   `enable`: Enable/disable Babel (default: `true`).
    *   `targets`: Custom Babel targets.
*   `plugin`: Options passed to the underlying plugin.
    *   `hermesCompat`: Enable Hermes shims (default: `true` for native).
    *   `writeArtifacts`: Write HMR tokens to `.rune/artifacts.json` (default: `true`).

## How it Works

### Native Build
*   **Target**: `web` (shimmed for Hermes).
*   **Output**: Single JS bundle (`main.js`), no HTML, no CSS files.
*   **JSX**: Transpiles SolidJS JSX to `universal` create calls (`@rune/core/universal`).
*   **HMR**: Uses a custom shim to prevent the standard WebSocket client from breaking the native bridge.

### Web Build
*   **Target**: Standard web.
*   **Output**: HTML, JS, CSS.
*   **JSX**: Transpiles SolidJS JSX to standard DOM operations.
*   **Aliases**: Automatically resolves `@rune/core` to its web entry point (`index.web.ts`).