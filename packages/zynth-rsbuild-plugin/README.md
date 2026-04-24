# Rsbuild Plugin

`@zynthjs/rsbuild-plugin` configures Rsbuild for Zynth applications on iOS, Android, and Web.

It provides the default build shape used by Zynth apps, including platform-aware compilation, local asset imports for images and fonts, monorepo package aliasing for `@zynthjs/*` packages, and the feature hook used by packages that generate build-time modules.

For most apps, this package is used through `defineZynthConfig()`. The plugin applies Zynth defaults and still allows standard Rsbuild configuration to be merged in normally.

## Basic usage

### Default app configuration

```ts
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig();
```

### Select a target platform

```ts
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig(
  {
    source: {
      entry: {
        app: "./src/index.tsx",
      },
    },
  },
  {
    platform: process.env.ZYNTH_PLATFORM as "ios" | "android" | "web",
  },
);
```

### Local asset imports

The plugin configures image and font imports so application code can consume local files directly.

```tsx
import { onMount } from "solid-js";
import { Image } from "@zynthjs/components";
import { Font } from "@zynthjs/apis";
import logo from "./assets/logo.png";
import brandFont from "./assets/brand.ttf";

export function Screen() {
  onMount(async () => {
    await Font.loadAsync("Brand", brandFont);
  });

  return <Image source={logo} style={{ width: 96, height: 96 }} />;
}
```

## Advanced examples

### Merge standard Rsbuild configuration

`defineZynthConfig()` accepts a regular Rsbuild config as its first argument. Zynth defaults are applied first, and your app-specific configuration is merged on top.

```ts
import path from "node:path";
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig({
  tools: {
    rspack(config) {
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.unshift({
        test: /\.html$/i,
        include: [path.resolve(process.cwd(), "src/assets/misc")],
        type: "asset/source",
      });
    },
  },
});
```

### Generated-module features

Build-time features can generate source files and expose them through stable module identifiers. This is how packages such as `@zynthjs/router` integrate filesystem-driven features into the build.

```ts
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";
import { routerFileSystem } from "@zynthjs/router/rsbuild";

export default defineZynthConfig(
  {},
  {
    plugin: {
      features: [routerFileSystem()],
    },
  },
);
```

### Custom generated module

```ts
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig(
  {},
  {
    plugin: {
      features: [
        {
          kind: "generated-module",
          moduleId: "@app/build-info",
          outputPath: ".zynth/build-info.ts",
          generate() {
            return [
              "export const buildInfo = {",
              '  channel: "dev",',
              "  platform: __ZYNTH_PLATFORM__,",
              "};",
            ].join("\\n");
          },
        },
      ],
    },
  },
);
```

### Extra aliases

Use `extraAliases` when the app needs to inject additional resolve aliases. Package aliases discovered from the workspace remain the default for `@zynthjs/*` packages.

```ts
import path from "node:path";
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig(
  {},
  {
    plugin: {
      extraAliases: {
        "@app/theme": path.resolve(process.cwd(), "src/theme"),
      },
    },
  },
);
```

### Babel configuration

The plugin configures Babel for Zynth defaults, including platform-aware Solid output. Additional targets can be supplied when an app needs different browser or native baselines.

```ts
import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";

export default defineZynthConfig(
  {},
  {
    babel: {
      targets: {
        ios: "14.0",
        android: "10.0",
      },
    },
  },
);
```

## Special cases and unusual features

- Web is supported by this package. When `platform` is `"web"`, the plugin enables a standard web build with HTML and CSS output.
- Native and web builds use different defaults. Native emits a single JavaScript bundle and disables CSS output. Web emits HTML, JavaScript, and CSS.
- Native development injects `__ZYNTH_DEV_SERVER_URL` so runtime asset loaders can resolve local files through the dev server.
- Imported images and fonts are transformed into asset descriptors rather than plain URL strings. In development they include a file-backed path; on web production builds they emit hashed files.
- Native builds write asset manifests to `dist/assets/images-manifest.json` and `dist/assets/fonts-manifest.json` so the native toolchain can discover bundled files.
- Native development also writes `.zynth/artifacts.json` by default. This is used by the development workflow to exchange bundle metadata.
- Native HMR support is present but still being worked on. It should be treated as development-only and may not behave as consistently as the web development flow.
- Workspace package aliasing prefers app-local installed packages when available, then falls back to workspace source resolution for `@zynthjs/*` packages.
- For web builds, `@zynthjs/core` resolves to its web entrypoint automatically when one is available.
- If `platform` is omitted, the plugin uses `process.env.ZYNTH_PLATFORM` when present and otherwise defaults to `"ios"`.

## API reference

### `defineZynthConfig(userConfig?, options?)`

Wraps a standard Rsbuild config with Zynth defaults and returns the final config for the selected platform.

- `userConfig?: RsbuildConfig`
- `options?: DefineZynthConfigOptions`

### `DefineZynthConfigOptions`

- `platform?: "ios" | "android" | "web"`
- `plugin?: ZynthRsbuildPluginOptions`
- `babel?: { enable?: boolean; targets?: { android?: string; ios?: string; [platform: string]: string | undefined } }`

### `ZynthRsbuildPluginOptions`

- `artifactPath?: string`
  Path for the dev artifact file. Defaults to `<app>/.zynth/artifacts.json`.
- `workspaceRoot?: string`
  Explicit workspace root. When omitted, the plugin walks upward to detect the workspace automatically.
- `hermesCompat?: boolean`
  Enables the native compatibility shims used by the Zynth development runtime.
- `extraAliases?: Record<string, string | false | (string | false)[]>`
  Adds resolve aliases on top of the plugin defaults.
- `writeArtifacts?: boolean`
  Controls whether development artifact metadata is written.
- `features?: ZynthBuildFeature[]`
  Registers build-time features such as generated modules.

### `ZynthBuildFeatureContext`

The context object passed to generated-module features.

- `appRoot: string`
- `workspaceRoot: string`
- `platform: "ios" | "android" | "web"`

### `ZynthGeneratedModuleFeature`

Feature descriptor for generating a module at build time.

- `kind: "generated-module"`
- `moduleId: string`
- `outputPath?: string`
- `generate(context: ZynthBuildFeatureContext): string | Promise<string>`

### `ZynthBuildFeature`

Union of:

- `ZynthGeneratedModuleFeature`
- `ZynthOpaqueFeature`


### Asset handling enabled by the plugin

Imported image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`) are transformed into objects with this shape:

- `type: "asset"`
- `name: string`
- `ext: string`
- `hash: string`
- `scale?: number`
- `relativePath?: string`
- `devPath?: string`

Imported font files (`.ttf`, `.otf`, `.woff`, `.woff2`, `.eot`) are transformed into objects with this shape:

- `type: "font"`
- `name: string`
- `ext: string`
- `hash: string`
- `relativePath?: string`
- `devPath?: string`
