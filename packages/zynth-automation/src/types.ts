export type AutomationReadOptions = {
  surfaceId?: number;
  rootNodeId?: number;
  maxDepth?: number;
  includeYogaStyles?: boolean;
  includeResolvedStyles?: boolean;
  includeComponentState?: boolean;
  includeGlobalFrame?: boolean;
  includeText?: boolean;
};

export type AutomationConfig = {
  enableProductionInspection?: boolean;
};

export type AutomationRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AutomationNodeSnapshot = {
  id: number;
  type: string;
  surfaceId: number;
  parentId: number | null;
  childIds: number[];
  viewClass: string;
  frameLocal: AutomationRect;
  frameGlobal?: AutomationRect;
  visibility: "visible" | "invisible" | "gone/hidden";
  alpha: number;
  yogaStyles?: Record<string, unknown>;
  resolvedStyles?: Record<string, unknown>;
  componentState?: Record<string, unknown>;
  text?: string;
};

export type AutomationSurfaceSnapshot = {
  surfaceId: number;
  rootViewFrameGlobal: AutomationRect;
  rootChildren: number[];
  nodes: Record<string, AutomationNodeSnapshot>;
};

export type AutomationSnapshot = {
  version: number;
  platform: "ios" | "android";
  timestampMs: number;
  density: number;
  surfaces: AutomationSurfaceSnapshot[];
  warnings: string[];
};

export type AutomationExpectedNode = {
  id: number;
  type?: string;
  surfaceId?: number;
  parentId?: number | null;
  childIds?: number[];
  visibility?: "visible" | "invisible" | "gone/hidden";
  alpha?: number;
  text?: string;
  yogaStyles?: Record<string, unknown>;
  resolvedStyles?: Record<string, unknown>;
  componentState?: Record<string, unknown>;
};

export type AutomationExpectedSurface = {
  surfaceId: number;
  rootChildren?: number[];
  nodes: AutomationExpectedNode[];
};

export type AutomationExpectedSnapshot = {
  surfaces: AutomationExpectedSurface[];
};

export type AutomationDiffIssue = {
  kind:
    | "missing_surface"
    | "missing_node"
    | "unexpected_type"
    | "unexpected_value"
    | "missing_child"
    | "unexpected_child";
  message: string;
  surfaceId?: number;
  nodeId?: number;
  field?: string;
  expected?: unknown;
  actual?: unknown;
};
