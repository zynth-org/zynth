import type {
  Host,
  HostNode,
  HostBatchMeta,
  Style,
  RecyclingConfig,
  RecyclingContext,
} from "./HostTypes";
import type { RuneUIBridge } from "../bridge";

export function createAndroidHost(): Host {
  const g: any =
    typeof globalThis !== "undefined"
      ? globalThis
      : // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (0, eval)("this");
  const ui =
    (g.__ui as RuneUIBridge | undefined) ??
    (() => {
      throw new Error("__ui not found (native bindings missing)");
    })();

  const PARENTS = new Map<number, number | null>();
  const CHILDREN = new Map<number, number[]>();
  const TEXTS = new Map<number, string>();
  const TYPES = new Map<number, HostNode["type"]>();

  // Recycling system
  const RECYCLING_CONTEXTS = new Map<string, RecyclingContext>();
  const NODE_TO_CONTEXT = new Map<number, string>(); // track which context owns each node
  const CONTAINER_TO_CONTEXT = new Map<number, string>(); // map container nodeId -> contextId
  let nextContextId = 0;
  let activeRecyclingContext: string | null = null; // Currently active context for createNode

  let flushScheduled = false;
  const operations: Array<() => void> = [];
  const suppressionKey = "__runeSuppressNativeMutations";
  const isSuppressed = () => Boolean((g as any)[suppressionKey]);
  const enqueueOperation = (operation: () => void) => {
    if (isSuppressed()) return;
    operations.push(operation);
  };
  type BatchOperation =
    | { type: "setProp"; nodeId: number; name: string; value: any }
    | { type: "setText"; nodeId: number; value: any };

  type BatchContext = {
    meta: HostBatchMeta;
    operations: BatchOperation[];
  };

  const batchStack: BatchContext[] = [];

  const currentBatch = (): BatchContext | undefined =>
    batchStack[batchStack.length - 1];

  const tryEnqueueBatch = (operation: BatchOperation): boolean => {
    const batch = currentBatch();
    if (!batch) return false;
    batch.operations.push(operation);
    return true;
  };

  const runFlush = () => {
    flushScheduled = false;
    try {
      if (operations.length) {
        const pending = operations.splice(0);
        for (const op of pending) op();
      }
      ui.flush();
    } catch (e) {
      console.error("Flush error:", e);
    }
  };

  const schedule = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    if (typeof queueMicrotask === "function") {
      queueMicrotask(runFlush);
      return;
    }

    if (typeof Promise !== "undefined") {
      Promise.resolve()
        .then(runFlush)
        .catch((err) => {
          flushScheduled = false;
          console.error("Flush error:", err);
        });
      return;
    }

    if (typeof setTimeout !== "undefined") {
      setTimeout(runFlush, 0);
    } else {
      // final fallback: run synchronously
      runFlush();
    }
  };

  const ensure = (id: number) =>
    CHILDREN.has(id)
      ? CHILDREN.get(id)!
      : (CHILDREN.set(id, []), CHILDREN.get(id)!);

  const applyTextInputInitialProps = (id: number, props: any) => {
    if (!props) return;

    const assign = (key: string, value: unknown) => {
      if (value !== undefined) {
        enqueueOperation(() => ui.setProp(id, key, value));
      }
    };

    const measureProps: Array<[string, unknown]> = [
      ["multiline", props.multiline],
      ["numberOfLines", props.numberOfLines],
      ["maxLength", props.maxLength],
      ["editable", props.editable],
      ["secureTextEntry", props.secureTextEntry],
      ["inputMode", props.inputMode],
      ["autoCapitalize", props.autoCapitalize],
      ["autoCorrect", props.autoCorrect],
      ["spellCheck", props.spellCheck],
      ["returnKeyType", props.returnKeyType],
      ["blurOnSubmit", props.blurOnSubmit],
      ["submitBehavior", props.submitBehavior],
      ["eventThrottleMs", props.eventThrottleMs],
      [
        "allowProgrammaticJumpDuringEdit",
        props.allowProgrammaticJumpDuringEdit,
      ],
    ];

    for (const [key, value] of measureProps) assign(key, value);

    assign("value", props.value);
    assign("defaultValue", props.defaultValue);
    if (props?.defaultValue != null && props.value == null) {
      enqueueOperation(() => ui.setText(id, String(props.defaultValue)));
    }

    assign("placeholder", props.placeholder);
    assign("selection", props.selection);
    assign("selectionColor", props.selectionColor);
    assign("caretColor", props.caretColor);
    assign("clearButtonMode", props.clearButtonMode);
    assign("showClearAccessory", props.showClearAccessory);
    assign("testID", props.testID);

    const events: Record<string, Function | undefined> = {
      onChange: props.onChange,
      onChangeText: props.onChangeText,
      onSelectionChange: props.onSelectionChange,
      onSubmitEditing: props.onSubmitEditing,
      onKeyPress: props.onKeyPress,
      onFocus: props.onFocus,
      onBlur: props.onBlur,
      onCompositionStart: props.onCompositionStart,
      onCompositionEnd: props.onCompositionEnd,
    };

    for (const [name, handler] of Object.entries(events)) {
      if (typeof handler === "function") {
        enqueueOperation(() => ui.setHandler(id, name, handler));
      }
    }
  };

  // helper to compute physical index (exclude markers)
  const physicalIndex = (parentId: number, logicalInsertIdx: number) => {
    const kids = ensure(parentId);
    let count = 0;
    for (let i = 0; i < logicalInsertIdx; i++) {
      const k = kids[i];
      // find child type; markers are negative ids (from renderer.ts) => skip native
      const isMarker = k < 0; // relies on marker ids < 0
      if (!isMarker) count++;
    }
    return count;
  };

  const isMarkerId = (id: number) => id < 0;
  const typeFor = (id: number): HostNode["type"] =>
    TYPES.get(id) ?? (isMarkerId(id) ? "marker" : "view");

  const nodeFor = (id: number): HostNode => ({ id, type: typeFor(id) });

  // Recycling helper functions
  const resetNodeToDefault = (nodeId: number, type: HostNode["type"]) => {
    // Reset common props to default state
    enqueueOperation(() => ui.setProp(nodeId, "style", {}));
    if (type === "text") {
      enqueueOperation(() => ui.setText(nodeId, ""));
      TEXTS.set(nodeId, "");
    }

    // DON'T clear children - they will be managed by SolidJS
    // When a View is recycled, SolidJS will remove old Text children
    // and add new ones via normal removeNode/insertNode calls

    // Clear event handlers by setting them to no-op
    // (Native side should handle cleanup)
  };

  const findAvailableNodeInPool = (
    contextId: string,
    type: HostNode["type"]
  ): number | null => {
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (!context) {
      console.log(
        `[Host/findAvailableNodeInPool] ❌ Context ${contextId} not found`
      );
      return null;
    }

    const pool = context.pool.get(type);
    // console.log(
    //   `[Host/findAvailableNodeInPool] 🔍 Looking for ${type} in context ${contextId}, pool has ${
    //     pool?.length || 0
    //   } nodes`
    // );

    if (!pool || pool.length === 0) {
      // console.log(
      //   `[Host/findAvailableNodeInPool] ❌ Pool empty for type=${type}`
      // );
      return null;
    }

    const nodeId = pool.pop() ?? null;
    // console.log(
    //   `[Host/findAvailableNodeInPool] ✅ Found node ${nodeId} in pool`
    // );
    return nodeId;
  };

  const returnNodeToPool = (contextId: string, nodeId: number) => {
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (!context) return;

    const nodeType = TYPES.get(nodeId);
    if (!nodeType) return;

    // Reset node to clean state
    resetNodeToDefault(nodeId, nodeType);

    // Add to pool
    let pool = context.pool.get(nodeType);
    if (!pool) {
      pool = [];
      context.pool.set(nodeType, pool);
    }
    pool.push(nodeId);

    // Remove from active bindings
    context.activeBindings.delete(nodeId);

    // Log pool stats periodically
    // if (nodeId % 10 === 0) {
    //   const poolStats = Array.from(context.pool.entries())
    //     .map(([type, nodes]) => `${type}:${nodes.length}`)
    //     .join(", ");
    //   console.log(`[Host/Pool Stats] Context ${contextId}: ${poolStats}`);
    // }
  };

  const api: Host = {
    createRootContainer() {
      PARENTS.set(0, null);
      CHILDREN.set(0, []);
      TYPES.set(0, "root");
      return { id: 0, type: "root" };
    },
    createNode(type, props) {
      let id: number | null = null;
      let recycled = false;

      // Try to get from ANY active recycling context
      // We'll associate it with a container when it's inserted via insertNode
      if (RECYCLING_CONTEXTS.size > 0) {
        for (const [contextId, context] of RECYCLING_CONTEXTS) {
          const pooled = findAvailableNodeInPool(contextId, type);
          if (pooled !== null) {
            id = pooled;
            recycled = true;
            NODE_TO_CONTEXT.set(id, contextId);
            console.log(
              `[Host/createNode] ♻️  RECYCLED node ${id} (type=${type}) from context ${contextId}`
            );
            break;
          }
        }
      }

      if (id === null) {
        id = ui.createNode(type);
        console.log(`[Host/createNode] 🆕 CREATED node ${id} (type=${type})`);
      }

      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TYPES.set(id, type);
      if (props?.style)
        enqueueOperation(() => ui.setProp(id, "style", props.style as Style));
      if (typeof props?.onPress === "function") {
        enqueueOperation(() => ui.setHandler(id, "onPress", props.onPress));
      }
      if (typeof props?.onLayout === "function") {
        enqueueOperation(() => ui.setHandler(id, "onLayout", props.onLayout));
      }
      if (props?.accessibilityLabel)
        enqueueOperation(() =>
          ui.setProp(id, "accessibilityLabel", props.accessibilityLabel)
        );
      if (props?.accessibilityHint)
        enqueueOperation(() =>
          ui.setProp(id, "accessibilityHint", props.accessibilityHint)
        );
      if (props?.accessibilityRole)
        enqueueOperation(() =>
          ui.setProp(id, "accessibilityRole", props.accessibilityRole)
        );
      if (props?.pointerEvents)
        enqueueOperation(() =>
          ui.setProp(id, "pointerEvents", props.pointerEvents)
        );
      if (props?.testID)
        enqueueOperation(() => ui.setProp(id, "testID", props.testID));
      if (type === "text-input" || type === "secure-text-input") {
        applyTextInputInitialProps(id, props);
      }
      schedule();
      return { id, type } as HostNode;
    },
    createText(value) {
      let id: number | null = null;
      let recycled = false;

      // Try to recycle text nodes too
      if (RECYCLING_CONTEXTS.size > 0) {
        for (const [contextId, context] of RECYCLING_CONTEXTS) {
          const pooled = findAvailableNodeInPool(contextId, "text");
          if (pooled !== null) {
            id = pooled;
            recycled = true;
            NODE_TO_CONTEXT.set(id, contextId);
            // console.log(
            //   `[Host/createText] ♻️  RECYCLED text node ${id} from context ${contextId}`
            // );
            break;
          }
        }
      }

      if (id === null) {
        id = ui.createNode("text");
        console.log(`[Host/createText] 🆕 CREATED text node ${id}`);
      }

      enqueueOperation(() => ui.setText(id, value ?? ""));
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TEXTS.set(id, value ?? "");
      TYPES.set(id, "text");
      schedule();
      return { id, type: "text" };
    },
    setProperty(node, name, value) {
      if (value === undefined && name !== "style") {
        return;
      }
      if (name === "style") {
        if (
          tryEnqueueBatch({
            type: "setProp",
            nodeId: node.id,
            name: "style",
            value: value || {},
          })
        ) {
          return;
        }
        enqueueOperation(() => ui.setProp(node.id, "style", value || {}));
        schedule();
        return;
      }
      if (name === "controller") {
        return;
      }
      if (typeof value === "function") {
        enqueueOperation(() => ui.setHandler(node.id, name, value));
        schedule();
        return;
      }
      if (tryEnqueueBatch({ type: "setProp", nodeId: node.id, name, value })) {
        return;
      }
      enqueueOperation(() => ui.setProp(node.id, name, value));
      schedule();
    },
    setText(node, value) {
      TEXTS.set(node.id, value ?? "");
      if (
        tryEnqueueBatch({
          type: "setText",
          nodeId: node.id,
          value: value ?? "",
        })
      ) {
        return;
      }
      enqueueOperation(() => ui.setText(node.id, value ?? ""));
      schedule();
    },
    insertNode(parent, node, anchor) {
      const kids = ensure(parent.id);
      const aIdx = anchor ? kids.indexOf(anchor.id) : -1;
      const logicalAt = aIdx >= 0 ? aIdx : kids.length;

      // physical index counts only non-markers STRICTLY BEFORE logicalAt
      let physIdx = 0;
      for (let i = 0; i < logicalAt; i++) if (!isMarkerId(kids[i])) physIdx++;

      // Check if this is a recycled node being reinserted
      const wasRecycled = NODE_TO_CONTEXT.has(node.id);

      // Check if parent or any ancestor is a recycling container
      // If yes, mark this node for recycling BUT ONLY if it's a direct child
      // We don't want to recycle nested children (like Text inside View)
      let currentParent: number | null = parent.id;
      let isDirectChildOfContainer = false;

      while (currentParent !== null) {
        const contextId = CONTAINER_TO_CONTEXT.get(currentParent);
        if (contextId && RECYCLING_CONTEXTS.has(contextId)) {
          // Check if this is a DIRECT child of the recycling container
          // (not a grandchild or deeper)
          isDirectChildOfContainer =
            PARENTS.get(parent.id) === currentParent ||
            parent.id === currentParent;

          if (isDirectChildOfContainer) {
            // This node is a direct child - mark it for recycling
            if (!NODE_TO_CONTEXT.has(node.id)) {
              NODE_TO_CONTEXT.set(node.id, contextId);
              console.log(
                `[Host/insertNode] 🏷️  Marked node ${node.id} (type=${node.type}) for recycling in context ${contextId}`
              );
            } else if (wasRecycled) {
              console.log(
                `[Host/insertNode] ♻️  RE-INSERTING recycled node ${node.id} (type=${node.type}) into parent ${parent.id} at index ${physIdx}`
              );
            }
          }

          // Propagate recycling context to nested descendants so their pools can be reused.
          if (!NODE_TO_CONTEXT.has(node.id)) {
            let ancestorId: number | null = parent.id;
            let inheritedContext: string | null = null;
            while (ancestorId !== null) {
              const ancestorContext = NODE_TO_CONTEXT.get(ancestorId);
              if (ancestorContext) {
                inheritedContext = ancestorContext;
                break;
              }
              ancestorId = PARENTS.get(ancestorId) ?? null;
            }

            const isNativeElement = node.type !== "marker";
            if (inheritedContext && isNativeElement) {
              NODE_TO_CONTEXT.set(node.id, inheritedContext);
              // console.log(
              //   `[Host/insertNode] 🪆 Marked nested node ${node.id} (type=${node.type}) for recycling with context ${inheritedContext}`
              // );
            }
          }

          break;
        }
        currentParent = PARENTS.get(currentParent) ?? null;
      }

      // mutate logical structure AFTER computing physIdx
      kids.splice(logicalAt, 0, node.id);
      PARENTS.set(node.id, parent.id);

      if (!isMarkerId(node.id)) {
        enqueueOperation(() => ui.insertChild(parent.id, node.id, physIdx));
      }
      schedule();
    },
    removeNode(parent, node) {
      const kids = ensure(parent.id);
      const i = kids.indexOf(node.id);
      if (i < 0) return;

      const nonMarkerBefore = (() => {
        let n = 0;
        for (let j = 0; j < i; j++) if (!isMarkerId(kids[j])) n++;
        return n;
      })();

      // Check if this node came from a recycling pool
      const contextId = NODE_TO_CONTEXT.get(node.id);
      const shouldRecycle = contextId && RECYCLING_CONTEXTS.has(contextId);

      if (shouldRecycle) {
        // Return to pool instead of destroying
        // console.log(
        //   `[Host/removeNode] ♻️  RETURNING node ${node.id} (type=${node.type}) to pool ${contextId}`
        // );
        returnNodeToPool(contextId!, node.id);

        // Detach from parent but don't destroy
        kids.splice(i, 1);
        PARENTS.set(node.id, null);

        if (!isMarkerId(node.id)) {
          // Just detach visually, don't actually remove from native
          enqueueOperation(() => ui.removeChild(parent.id, node.id));
        }
        schedule();
        return;
      }

      // Standard destruction path
      kids.splice(i, 1);
      PARENTS.set(node.id, null);
      if (!isMarkerId(node.id)) {
        TYPES.delete(node.id);
        enqueueOperation(() => ui.removeChild(parent.id, node.id));
        console.log(
          `[Host/removeNode] 🗑️  DESTROYED node ${node.id} (type=${node.type})`
        );
      }
      schedule();
    },
    getParentNode(node) {
      const pid = PARENTS.get(node.id);
      if (pid == null) return null;
      return { id: pid, type: typeFor(pid) };
    },
    getFirstChild(node) {
      const kids = ensure(node.id);
      if (!kids.length) return null;
      return nodeFor(kids[0]);
    },
    getNextSibling(node) {
      const pid = PARENTS.get(node.id);
      if (pid == null) return null;
      const kids = ensure(pid);
      const i = kids.indexOf(node.id);
      if (i < 0 || i + 1 >= kids.length) return null;
      return nodeFor(kids[i + 1]);
    },
    getText(node) {
      return TEXTS.get(node.id) ?? "";
    },
    flush() {
      if (operations.length) {
        const pending = operations.splice(0);
        for (const op of pending) op();
      }
      ui.flush();
    },
    beginBatch(meta) {
      const kind = meta?.kind ?? meta?.scope ?? "update";
      const normalizedMeta: HostBatchMeta = {
        kind,
        scope: meta?.scope ?? kind,
        target: meta?.target,
        templateId: meta?.templateId,
        itemKey: meta?.itemKey,
        descriptor: meta?.descriptor ?? null,
        extras: meta?.extras ?? null,
      };
      batchStack.push({ meta: normalizedMeta, operations: [] });
    },
    endBatch(meta) {
      const context = batchStack.pop();
      if (!context) return;
      if (meta) {
        context.meta = {
          ...context.meta,
          ...meta,
          kind: meta.kind ?? context.meta.kind,
          scope: meta.scope ?? context.meta.scope,
        };
      }
      if (batchStack.length) {
        batchStack[batchStack.length - 1].operations.push(
          ...context.operations
        );
        return;
      }
      if (!context.operations.length) return;
      const payload = {
        meta: context.meta,
        operations: context.operations.map((op) =>
          op.type === "setProp"
            ? {
                type: "setProp" as const,
                nodeId: op.nodeId,
                name: op.name,
                value: op.value,
              }
            : {
                type: "setText" as const,
                nodeId: op.nodeId,
                value: op.value,
              }
        ),
      };
      if (typeof ui.applyBatch === "function") {
        if (isSuppressed()) return;
        const serialized =
          typeof payload === "string" ? payload : JSON.stringify(payload);
        ui.applyBatch(serialized);
        return;
      }
      if (isSuppressed()) return;
      for (const op of context.operations) {
        if (op.type === "setProp") {
          ui.setProp(op.nodeId, op.name, op.value);
        } else {
          ui.setText(op.nodeId, op.value);
        }
      }
    },

    enableRecycling(containerId: number, config: RecyclingConfig): string {
      const contextId = `recycling-${containerId}-${nextContextId++}`;
      RECYCLING_CONTEXTS.set(contextId, {
        id: contextId,
        config,
        pool: new Map(),
        activeBindings: new Map(),
      });
      CONTAINER_TO_CONTEXT.set(containerId, contextId);

      // Retroactively mark existing direct children for recycling
      const containerChildren = CHILDREN.get(containerId) || [];

      console.log(
        `[Host/Recycling] 🔍 Container ${containerId} has ${containerChildren.length} children:`,
        containerChildren.map((id) => `${id}(${TYPES.get(id)})`).join(", ")
      );

      let markedCount = 0;
      for (const childId of containerChildren) {
        if (isMarkerId(childId)) {
          console.log(`[Host/Recycling] ⏭️  Skipping marker ${childId}`);
          continue;
        }

        const childType = TYPES.get(childId);
        console.log(
          `[Host/Recycling] 🔎 Checking child ${childId} (type=${childType}) against config.itemType=${config.itemType}`
        );

        // Only mark View nodes (containers), not Text or other types
        if (childType === config.itemType) {
          NODE_TO_CONTEXT.set(childId, contextId);
          markedCount++;
          console.log(
            `[Host/Recycling] 🏷️  Retroactively marked node ${childId} (type=${childType}) for recycling in context ${contextId}`
          );
        } else {
          console.log(
            `[Host/Recycling] ❌ Not marking node ${childId} (type=${childType}) - doesn't match ${config.itemType}`
          );
        }
      }

      console.log(
        `[Host/Recycling] ✅ Enabled recycling for container ${containerId} (context=${contextId}, pool size=${config.poolSize}, marked ${markedCount} existing nodes)`
      );
      return contextId;
    },

    disableRecycling(contextId: string) {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;

      // Return all active nodes to pool before cleanup
      for (const [nodeId] of context.activeBindings) {
        returnNodeToPool(contextId, nodeId);
      }

      // Clean up pool nodes (actually destroy them)
      for (const [, nodeIds] of context.pool) {
        for (const nodeId of nodeIds) {
          const parent = PARENTS.get(nodeId);
          if (parent !== null && parent !== undefined) {
            const parentNode = nodeFor(parent);
            api.removeNode(parentNode, nodeFor(nodeId));
          }
          NODE_TO_CONTEXT.delete(nodeId);
        }
      }

      RECYCLING_CONTEXTS.delete(contextId);
      console.log(`[Host/Recycling] Disabled recycling context ${contextId}`);
    },

    reclaimNode(contextId: string, node: HostNode) {
      if (!RECYCLING_CONTEXTS.has(contextId)) {
        console.warn(
          `[Host/Recycling] Cannot reclaim node ${node.id}: context ${contextId} not found`
        );
        return;
      }

      console.log(
        `[Host/Recycling] Reclaiming node ${node.id} (type=${node.type}) to pool ${contextId}`
      );
      returnNodeToPool(contextId, node.id);
    },

    acquireNode(
      contextId: string,
      type: HostNode["type"],
      itemKey: string,
      itemIndex: number
    ): HostNode | null {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) {
        console.warn(
          `[Host/Recycling] Cannot acquire node: context ${contextId} not found`
        );
        return null;
      }

      // Try to get from pool first
      let nodeId = findAvailableNodeInPool(contextId, type);

      if (nodeId !== null) {
        // Reusing existing node
        console.log(
          `[Host/Recycling] ♻️  REUSING node ${nodeId} (type=${type}) for item ${itemKey} [${itemIndex}]`
        );
        context.activeBindings.set(nodeId, { itemKey, itemIndex });
        return nodeFor(nodeId);
      }

      // Pool exhausted - create new node if within pool size limit
      const currentActiveCount = context.activeBindings.size;
      if (currentActiveCount >= context.config.poolSize) {
        console.warn(
          `[Host/Recycling] Pool exhausted! Active: ${currentActiveCount}, Limit: ${context.config.poolSize}`
        );
        return null;
      }

      // Create new node and track it
      console.log(
        `[Host/Recycling] 🆕 CREATING new node (type=${type}) for item ${itemKey} [${itemIndex}] (${
          currentActiveCount + 1
        }/${context.config.poolSize})`
      );
      if (type === "root") {
        console.error("[Host/Recycling] Cannot create root node in pool");
        return null;
      }
      const newNode = api.createNode(type, {});
      NODE_TO_CONTEXT.set(newNode.id, contextId);
      context.activeBindings.set(newNode.id, { itemKey, itemIndex });

      return newNode;
    },

    updateNodeBinding(
      node: HostNode,
      itemKey: string,
      itemIndex: number,
      props: Record<string, any>
    ) {
      const contextId = NODE_TO_CONTEXT.get(node.id);
      if (!contextId) {
        console.warn(
          `[Host/Recycling] Node ${node.id} not tracked in any recycling context`
        );
        return;
      }

      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;

      // Update binding metadata
      context.activeBindings.set(node.id, { itemKey, itemIndex });

      // Apply props efficiently using batch if available
      if (props.style !== undefined) {
        enqueueOperation(() => ui.setProp(node.id, "style", props.style || {}));
      }

      for (const [key, value] of Object.entries(props)) {
        if (key === "style") continue; // Already handled
        if (typeof value === "function") {
          enqueueOperation(() => ui.setHandler(node.id, key, value));
        } else if (value !== undefined) {
          enqueueOperation(() => ui.setProp(node.id, key, value));
        }
      }

      schedule();
    },
  };

  return api;
}
