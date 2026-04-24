# Automation

AI-agentic exploration and manipulation utilities for Zynth applications.

`@zynthjs/automation` provides the primitives required for AI agents and automated testing tools to perceive and verify the application's state. It enables deep UI tree introspection, including layout bounds, styles, component internal states, and visibility.

## Basic usage

### Capturing Application State

The `read()` method takes a point-in-time snapshot of the entire UI hierarchy across all active surfaces.

```tsx
import { Automation } from "@zynthjs/automation";

const explore = async () => {
  const snapshot = await Automation.read({
    includeResolvedStyles: true,
    includeComponentState: true
  });

  // Access surfaces and nodes
  snapshot.surfaces.forEach(surface => {
    console.log(`Surface ${surface.surfaceId} has ${Object.keys(surface.nodes).length} nodes`);
  });
};
```

## Advanced

### Snapshot Verification

You can compare actual application state against an expected schema using `diffSnapshot`. This is highly useful for verifying that an AI agent's action (like clicking a button) resulted in the correct UI transition.

```ts
import { Automation, diffSnapshot, assertSnapshotMatches } from "@zynthjs/automation";

const verifyUI = async (expected: AutomationExpectedSnapshot) => {
  const actual = await Automation.read();
  
  // Get an array of issues
  const issues = diffSnapshot(actual, expected);
  
  if (issues.length > 0) {
    console.error("Layout mismatch detected:", issues);
  }

  // Or throw an error immediately
  assertSnapshotMatches(actual, expected);
};
```

### Remote Inspection Bridge

The package automatically installs a **Devtools Bridge** upon import. This system is complemented by the **Zynth Runtime Devtools** to provide a remote command interface, enabling external AI agents or diagnostic tools to read application snapshots and manipulate the hierarchy via the internal messaging bus.

```ts
// Simply importing the package enables the remote bridge
import "@zynthjs/automation";
```

## Special cases

- **Production Inspection**: By default, "heavy" introspection fields (like `resolvedStyles` and `componentState`) are disabled in production builds to minimize overhead. You can override this behavior using `Automation.configure()` if you need to run agentic probes in a production-like environment.
- **JSI Synchronization**: Snapshots can be captured synchronously via `readSync()` if the runtime is running on the main thread or if the JSI bridge is active, ensuring zero-latency state retrieval for high-frequency agent loops.

## API Reference

### `Automation` Methods

- `read(options?: AutomationReadOptions): Promise<AutomationSnapshot>`
- `readSync(options?: AutomationReadOptions): AutomationSnapshot`
- `configure(config: AutomationConfig): { productionInspectionEnabled: boolean }`

### `AutomationReadOptions` (Type)

- `includeResolvedStyles?: boolean`: Whether to include final rendered styles.
- `includeComponentState?: boolean`: includes internal component signals and props.
- `includeText?: boolean`: includes raw text content from Text nodes.

### Diff Utilities

- `diffSnapshot(actual, expected): AutomationDiffIssue[]`
- `assertSnapshotMatches(actual, expected): void`
