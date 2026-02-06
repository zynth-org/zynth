export { Automation } from "./automation";
export { diffSnapshot, assertSnapshotMatches } from "./diff";
export { installAutomationDevtoolsBridge } from "./remote";
export type {
  AutomationConfig,
  AutomationExpectedNode,
  AutomationExpectedSnapshot,
  AutomationExpectedSurface,
  AutomationDiffIssue,
  AutomationReadOptions,
  AutomationRect,
  AutomationNodeSnapshot,
  AutomationSurfaceSnapshot,
  AutomationSnapshot,
} from "./types";

import { installAutomationDevtoolsBridge } from "./remote";

installAutomationDevtoolsBridge();
