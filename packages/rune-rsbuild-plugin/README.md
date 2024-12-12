# @rune/rsbuild-plugin

Rune-flavoured Rsbuild defaults wrapped as a plugin. It provides:

- Hermes-safe dev bundler settings with HMR client shims baked in.
- Automatic alias wiring to local Rune packages during development.
- A dev-only artifact writer that persists the Rsbuild HMR token to `.rune/artifacts.json`.
- A `defineRuneConfig` helper that merges common defaults so app configs stay lean.

## Usage

```ts
// rsbuild.config.ts
import { defineRuneConfig } from "@rune/rsbuild-plugin";

export default defineRuneConfig();
```

The helper registers the Rune plugin, Babel presets for SolidJS, and applies sane defaults for
Rune native apps. Custom config can still be merged in:

```ts
export default defineRuneConfig({
  server: {
    port: 8090,
  },
});
```

Artifacts land under `<app>/.rune/artifacts.json`:

```json
{
  "hmrServerToken": "c0616a0a52e087a3",
  "updatedAt": "2025-10-04T09:00:00.000Z"
}
```

## Building

```bash
yarn workspace @rune/rsbuild-plugin build
```
