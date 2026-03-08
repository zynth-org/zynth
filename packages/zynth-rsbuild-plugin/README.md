# @zynth/rsbuild-plugin

The official Rsbuild plugin for Zynth applications.

This package provides the build configuration and tooling required to compile Zynth apps for both Native (iOS/Android) and Web platforms. It abstracts away the complexity of configuring Rsbuild/Rspack for the unique requirements of the Zynth runtime (Hermes) and the SolidJS universal renderer.

## Features

*   **Dual-Platform Support**: Automatically switches between Native and Web build configurations based on the target platform.
*   **Monorepo Support**: Automatically discovers and aliases `@zynth/*` packages to their source files, enabling a seamless "edit-refresh" loop for framework development.
*   **Hermes Compatibility**: Shims browser-specific code (HMR clients, CSS injection) that would crash the native JS engine.
*   **SolidJS Integration**: Configures the Babel preset for SolidJS, selecting the `universal` output for Native and `dom` for Web.
*   **Asset Management**: Custom handling for image assets to support native resolution strategies.

## Usage

In your `rsbuild.config.ts`:

```ts
import { defineZynthConfig } from "@zynth/rsbuild-plugin";

export default defineZynthConfig({
  // Your standard Rsbuild config here
  source: {
    entry: {
      index: "./src/index.tsx",
    },
  },
}, {
  // Zynth-specific options
  platform: process.env.ZYNTH_PLATFORM as "ios" | "android" | "web",
});
```

## Configuration

### `defineZynthConfig(config, options)`

A wrapper around `defineConfig` that applies Zynth's defaults.

#### Options

*   `platform`: The target platform (`ios`, `android`, `web`). Defaults to `ios` or `process.env.ZYNTH_PLATFORM`.
*   `babel`: Options for the internal Babel plugin.
    *   `enable`: Enable/disable Babel (default: `true`).
    *   `targets`: Custom Babel targets.
*   `plugin`: Options passed to the underlying plugin.
    *   `hermesCompat`: Enable Hermes shims (default: `true` for native).
    *   `writeArtifacts`: Write HMR tokens to `.zynth/artifacts.json` (default: `true`).
    *   `features`: Extensible feature descriptors (including generated modules).

### Feature Ownership

`@zynth/rsbuild-plugin` is intentionally agnostic. It executes generic feature
descriptors (for example, generated module features), while feature packages
own domain-specific semantics.

Example with router filesystem routing:

```ts
import { defineZynthConfig } from "@zynth/rsbuild-plugin";
import { routerFileSystem } from "@zynth/router/rsbuild";

export default defineZynthConfig({}, {
  plugin: {
    features: [routerFileSystem({ enable: true })],
  },
});
```

In this setup, `@zynth/router` owns route scanning and manifest semantics.
`@zynth/rsbuild-plugin` only writes/aliases the generated module.
Router-specific filesystem conventions are documented by each router package.

## How it Works

### Native Build
*   **Target**: `web` (shimmed for Hermes).
*   **Output**: Single JS bundle (`main.js`), no HTML, no CSS files.
*   **JSX**: Transpiles SolidJS JSX to `universal` create calls (`@zynth/core/universal`).
*   **HMR**: Uses a custom shim to prevent the standard WebSocket client from breaking the native bridge.

### Web Build
*   **Target**: Standard web.
*   **Output**: HTML, JS, CSS.
*   **JSX**: Transpiles SolidJS JSX to standard DOM operations.
*   **Aliases**: Automatically resolves `@zynth/core` to its web entry point (`index.web.ts`).
