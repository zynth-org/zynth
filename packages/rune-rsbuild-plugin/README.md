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

## Hot Module Replacement (HMR) Solution

Rune implements a comprehensive HMR solution for building native iOS and Android apps using SolidJS, leveraging Rsbuild with Rspack and Solid Refresh. This enables fast development iteration by updating components in real-time without full app reloads.

### Architecture Overview

The HMR system consists of several integrated components:

1. **Rsbuild Plugin Integration**: Configures the build system with SolidJS refresh and Hermes-compatible settings
2. **Dev Server Communication**: Native runtimes connect to the Rsbuild dev server via WebSocket
3. **Module Update Handling**: Webpack-style hot updates are bridged to native JavaScriptCore/Hermes contexts
4. **SolidJS Component Refresh**: Leverages `solid-refresh/babel` for granular component updates

### Key Features

- **Hermes Compatibility**: Shims Rsbuild's web HMR client to prevent evaluation errors in native JavaScript engines
- **Automatic Aliases**: Resolves Rune package imports during development
- **Token-Based Authentication**: Secure WebSocket connections between dev server and native apps
- **Artifact Persistence**: HMR server tokens are written to disk for native runtime discovery

### HMR Flow

1. **Build Time**: Rsbuild compiles with Solid Refresh enabled, generating hot-update chunks
2. **Dev Server**: Serves bundles and broadcasts HMR messages via WebSocket
3. **Native Runtime**: Connects using token from `.rune/artifacts.json`
4. **Module Updates**: Receives chunk manifests and applies updates to running JavaScript context
5. **Component Refresh**: SolidJS refresh triggers selective re-rendering of changed components

### Scope and Capabilities

#### ✅ Supported Updates

- **Nested Component Changes**: Individual SolidJS components can be updated without affecting the app root
- **Style Updates**: Style changes are applied instantly
- **Module Hot Swapping**: JavaScript modules are replaced in the running context
- **State Preservation**: Component state is maintained during updates where possible

#### ⚠️ Current Limitations

**App.tsx Acceptance Boundary**
Changes to `App.tsx` trigger a complete app refresh rather than hot module replacement. This occurs because:

- `App.tsx` serves as the hot acceptance boundary in the module graph
- Updates to the root component require full re-initialization of the SolidJS renderer
- The native runtime disposes and recreates the root container on app-level changes

**Error Handling During Hot Updates**

- JavaScript errors during module evaluation may cause inconsistent state
- Warning messages from compilation are displayed but don't prevent updates
- Failed hot updates fall back to full reload, but error recovery is not always graceful

**Hermes Bytecode Compatibility**

- Hot updates work with JavaScript source but may have limitations with pre-compiled Hermes bytecode
- Bytecode bundles require full reload for consistency

**Platform-Specific Behaviors**

- iOS and Android handle module updates slightly differently due to JavaScriptCore vs Hermes implementations
- WebSocket reconnection logic varies between platforms

### Configuration Options

```ts
export default defineRuneConfig(
  {
    // Custom dev server port
    server: { port: 8081 },
  },
  {
    plugin: {
      // Custom artifact location
      artifactPath: ".rune/custom-artifacts.json",
      // Disable HMR shimming (not recommended)
      hermesCompat: true,
      // Additional resolve aliases
      extraAliases: {
        "@custom": "./src/custom",
      },
    },
    babel: {
      // Target specific platform versions
      targets: {
        android: "10.0",
        ios: "14.0",
      },
    },
  }
);
```

### Development Workflow

1. **Start Dev Server**: Run `rsbuild dev` with the Rune plugin
2. **Launch Native App**: iOS/Android apps automatically connect using the artifact token
3. **Make Changes**: Edit SolidJS components - changes appear instantly
4. **Handle App Changes**: Updates to `App.tsx` will trigger full refresh
5. **Monitor Logs**: Check console for HMR debug messages and warnings

### Debugging HMR

Enable debug logging by setting environment variables:

```bash
# Enable HMR debug logs in the native runtime
RUNE_HMR_DEBUG=1

# iOS specific dev server override
RUNE_DEV_SERVER_URL=http://localhost:8081
```

Look for `[HMR-DEBUG]` and `[Rune HMR]` messages in the console.

### Future Improvements

- **Enhanced Error Recovery**: Better handling of failed hot updates with rollback capabilities
- **App.tsx Hot Reloading**: Investigate selective app root updates without full refresh
- **State Migration**: Preserve component state across module boundaries during updates
- **Performance Optimization**: Reduce bundle analysis overhead for large applications
- **Cross-Platform Consistency**: Unify HMR behavior between iOS JavaScriptCore and Android Hermes

## Building

```bash
yarn workspace @rune/rsbuild-plugin build
```
