# @zynth/error-overlay

A dev-only, Redbox-style error and warning overlay for Zynth.

This package listens to devtools diagnostics events (emitted by the native Hermes runtime) and renders an in-app overlay UI for errors and warnings.

## Usage

In most apps this is injected automatically by `@zynth/core` in dev mode.

If you need to wire it manually, wrap your root app component:

```ts
import { wrapWithErrorOverlay } from "@zynth/error-overlay";

export const App = wrapWithErrorOverlay(() => <Root />);
```

## Diagnostics Sources

The overlay reacts to:

- `error/*` and `crash/*` devtools topics
- `log/console` events with `level: "warn"`

Native diagnostics are forwarded into JS via the global handler `__zynth_onDevtoolsEventRaw`.
