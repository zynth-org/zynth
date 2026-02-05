import type {
  AutomationDiffIssue,
  AutomationExpectedNode,
  AutomationExpectedSnapshot,
  AutomationNodeSnapshot,
  AutomationSnapshot,
} from "./types";

function compareSubset(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | undefined,
  fieldPrefix: string,
  issues: AutomationDiffIssue[],
  surfaceId: number,
  nodeId: number
) {
  if (!expected) return;
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual?.[key];
    if (!deepEqual(actualValue, expectedValue)) {
      issues.push({
        kind: "unexpected_value",
        message: `Node ${nodeId} field ${fieldPrefix}.${key} mismatch`,
        surfaceId,
        nodeId,
        field: `${fieldPrefix}.${key}`,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keysA = Object.keys(aObj).sort();
    const keysB = Object.keys(bObj).sort();
    if (!deepEqual(keysA, keysB)) return false;
    for (const key of keysA) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

function findActualNode(
  actualSurface: AutomationSnapshot["surfaces"][number],
  expectedNode: AutomationExpectedNode
): AutomationNodeSnapshot | undefined {
  const node = actualSurface.nodes[String(expectedNode.id)];
  return node;
}

export function diffSnapshot(
  actual: AutomationSnapshot,
  expected: AutomationExpectedSnapshot
): AutomationDiffIssue[] {
  const issues: AutomationDiffIssue[] = [];
  const actualSurfaceMap = new Map(actual.surfaces.map((surface) => [surface.surfaceId, surface]));

  for (const expectedSurface of expected.surfaces) {
    const actualSurface = actualSurfaceMap.get(expectedSurface.surfaceId);
    if (!actualSurface) {
      issues.push({
        kind: "missing_surface",
        message: `Surface ${expectedSurface.surfaceId} missing`,
        surfaceId: expectedSurface.surfaceId,
      });
      continue;
    }

    if (expectedSurface.rootChildren) {
      const expectedSet = new Set(expectedSurface.rootChildren);
      const actualSet = new Set(actualSurface.rootChildren);
      for (const nodeId of expectedSet) {
        if (!actualSet.has(nodeId)) {
          issues.push({
            kind: "missing_child",
            message: `Surface ${expectedSurface.surfaceId} missing root child ${nodeId}`,
            surfaceId: expectedSurface.surfaceId,
            nodeId,
            field: "rootChildren",
            expected: nodeId,
            actual: [...actualSet],
          });
        }
      }
    }

    for (const expectedNode of expectedSurface.nodes) {
      const actualNode = findActualNode(actualSurface, expectedNode);
      if (!actualNode) {
        issues.push({
          kind: "missing_node",
          message: `Node ${expectedNode.id} missing on surface ${expectedSurface.surfaceId}`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
        });
        continue;
      }

      if (expectedNode.type && actualNode.type !== expectedNode.type) {
        issues.push({
          kind: "unexpected_type",
          message: `Node ${expectedNode.id} type mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "type",
          expected: expectedNode.type,
          actual: actualNode.type,
        });
      }
      if (expectedNode.surfaceId !== undefined && actualNode.surfaceId !== expectedNode.surfaceId) {
        issues.push({
          kind: "unexpected_value",
          message: `Node ${expectedNode.id} surfaceId mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "surfaceId",
          expected: expectedNode.surfaceId,
          actual: actualNode.surfaceId,
        });
      }
      if (expectedNode.parentId !== undefined && actualNode.parentId !== expectedNode.parentId) {
        issues.push({
          kind: "unexpected_value",
          message: `Node ${expectedNode.id} parentId mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "parentId",
          expected: expectedNode.parentId,
          actual: actualNode.parentId,
        });
      }
      if (expectedNode.visibility && actualNode.visibility !== expectedNode.visibility) {
        issues.push({
          kind: "unexpected_value",
          message: `Node ${expectedNode.id} visibility mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "visibility",
          expected: expectedNode.visibility,
          actual: actualNode.visibility,
        });
      }
      if (expectedNode.alpha !== undefined && actualNode.alpha !== expectedNode.alpha) {
        issues.push({
          kind: "unexpected_value",
          message: `Node ${expectedNode.id} alpha mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "alpha",
          expected: expectedNode.alpha,
          actual: actualNode.alpha,
        });
      }
      if (expectedNode.text !== undefined && actualNode.text !== expectedNode.text) {
        issues.push({
          kind: "unexpected_value",
          message: `Node ${expectedNode.id} text mismatch`,
          surfaceId: expectedSurface.surfaceId,
          nodeId: expectedNode.id,
          field: "text",
          expected: expectedNode.text,
          actual: actualNode.text,
        });
      }
      if (expectedNode.childIds) {
        const expectedSet = new Set(expectedNode.childIds);
        const actualSet = new Set(actualNode.childIds);
        for (const childId of expectedSet) {
          if (!actualSet.has(childId)) {
            issues.push({
              kind: "missing_child",
              message: `Node ${expectedNode.id} missing child ${childId}`,
              surfaceId: expectedSurface.surfaceId,
              nodeId: expectedNode.id,
              field: "childIds",
              expected: childId,
              actual: actualNode.childIds,
            });
          }
        }
      }

      compareSubset(
        actualNode.yogaStyles,
        expectedNode.yogaStyles,
        "yogaStyles",
        issues,
        expectedSurface.surfaceId,
        expectedNode.id
      );
      compareSubset(
        actualNode.resolvedStyles,
        expectedNode.resolvedStyles,
        "resolvedStyles",
        issues,
        expectedSurface.surfaceId,
        expectedNode.id
      );
      compareSubset(
        actualNode.componentState,
        expectedNode.componentState,
        "componentState",
        issues,
        expectedSurface.surfaceId,
        expectedNode.id
      );
    }
  }
  return issues;
}

export function assertSnapshotMatches(
  actual: AutomationSnapshot,
  expected: AutomationExpectedSnapshot
): void {
  const issues = diffSnapshot(actual, expected);
  if (issues.length === 0) return;
  const details = issues
    .slice(0, 10)
    .map((issue) => `- ${issue.message}`)
    .join("\n");
  throw new Error(`Automation snapshot mismatch (${issues.length}):\n${details}`);
}
