# @zynth/automation

Cross-platform native automation primitives for Zynth.

Phase 1 includes screen inspection APIs:

- `Automation.readSync(options)`
- `Automation.read(options)`

These APIs return a native snapshot of the current rendered tree on iOS and Android.

## Production Safety

Heavy inspection fields are disabled by default in production builds:

- `includeResolvedStyles`
- `includeComponentState`
- `includeText`

Enable them explicitly only when needed:

```ts
import { Automation } from "@zynth/automation";

Automation.configure({
  enableProductionInspection: true,
});
```

## Phase 4 Diff Utilities

Use built-in diffing helpers for assertions:

```ts
import { Automation, diffSnapshot, assertSnapshotMatches } from "@zynth/automation";
```
