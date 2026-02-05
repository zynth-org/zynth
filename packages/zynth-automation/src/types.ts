export type AutomationReadOptions = {
  surfaceId?: number;
  rootNodeId?: number;
  maxDepth?: number;
  includeYogaStyles?: boolean;
  includeResolvedStyles?: boolean;
  includeGlobalFrame?: boolean;
  includeText?: boolean;
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
