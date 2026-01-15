import type {
  Host,
  HostNode,
  HostBatchMeta,
  Style,
  RecyclingConfig,
  RecyclingContext,
} from "./HostTypes";
import type { ZynthUIBridge } from "../bridge";
import { ensureNativeEmitter } from "../nativeEmitter";

export function createIOSHost(): Host {
  ensureNativeEmitter();

  const g: any =
    typeof globalThis !== "undefined"
      ? globalThis
      : // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (0, eval)("this");
  const ui =
    (g.__ui as ZynthUIBridge | undefined) ??
    (() => {
      throw new Error("__ui not found (native bindings missing)");
    })();

  const PARENTS = new Map<number, number | null>();
  const CHILDREN = new Map<number, number[]>();
  const TEXTS = new Map<number, string>();
  const TYPES = new Map<number, HostNode["type"]>();

  // Recycling system mirrors Android host to support FlatList parity.
  const RECYCLING_CONTEXTS = new Map<string, RecyclingContext>();
  const NODE_TO_CONTEXT = new Map<number, string>();
  const CONTAINER_TO_CONTEXT = new Map<number, string>();
  let nextContextId = 0;

  const suppressionKey = "__zynthSuppressNativeMutations";
  const isSuppressed = () => Boolean((g as any)[suppressionKey]);

  // NEW: Structured Queue System
  type BatchOperation =
    | { type: "setProp"; nodeId: number; name: string; value: any }
    | { type: "setText"; nodeId: number; value: any };

  type QueueItem =
    | { type: "closure"; func: () => void }
    | { type: "batch"; op: BatchOperation };

  const queue: QueueItem[] = [];

  const enqueueOperation = (operation: () => void) => {
    if (isSuppressed()) return;
    queue.push({ type: "closure", func: operation });
  };

  const enqueueBatchOp = (op: BatchOperation) => {
    if (isSuppressed()) return;
    queue.push({ type: "batch", op });
  };

  let rafHandle: number | null = null;
  let flushScheduled = false;

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
    rafHandle = null;
    try {
      if (queue.length) {
        const pending = queue.splice(0);
        let batchAccumulator: BatchOperation[] = [];

        const flushBatch = () => {
          if (!batchAccumulator.length) return;

          // Prepare payload with a global/flush scope
          const payload = {
            meta: { kind: "flush", scope: "global" },
            operations: batchAccumulator,
          };

          if (typeof ui.applyBatch === "function") {
            ui.applyBatch(JSON.stringify(payload));
          } else {
            // Fallback for runtimes without applyBatch
            for (const op of batchAccumulator) {
              if (op.type === "setProp") {
                ui.setProp(op.nodeId, op.name, op.value);
              } else {
                ui.setText(op.nodeId, op.value);
              }
            }
          }
          batchAccumulator = [];
        };

        for (const item of pending) {
          if (item.type === "batch") {
            batchAccumulator.push(item.op);
          } else {
            // Flush pending batch ops before executing the closure to maintain order
            flushBatch();
            item.func();
          }
        }
        flushBatch();
      }
      ui.flush();
    } catch (e) {
      console.error("Flush error:", e);
    }
  };

  const schedule = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    if (typeof requestAnimationFrame === "function") {
      if (rafHandle == null) {
        rafHandle = requestAnimationFrame(runFlush);
      }
      return;
    }

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
      runFlush();
    }
  };

  const ensure = (id: number) =>
    CHILDREN.has(id)
      ? CHILDREN.get(id)!
      : (CHILDREN.set(id, []), CHILDREN.get(id)!);

  const resetNodeToDefault = (nodeId: number, type: HostNode["type"]) => {
    // Reset style with explicit position reset to prevent position from persisting
    enqueueBatchOp({
      type: "setProp",
      nodeId,
      name: "style",
      value: {
        position: "relative",
        top: null,
        left: null,
        right: null,
        bottom: null,
      },
    });
    if (type === "text") {
      enqueueBatchOp({ type: "setText", nodeId, value: "" });
      TEXTS.set(nodeId, "");
    }
  };

  const findAvailableNodeInPool = (
    contextId: string,
    type: HostNode["type"]
  ): number | null => {
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (!context) return null;
    const pool = context.pool.get(type);
    if (!pool || pool.length === 0) return null;
    return pool.pop() ?? null;
  };

  const returnNodeToPool = (contextId: string, nodeId: number) => {
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (!context) return;

    const nodeType = TYPES.get(nodeId);
    if (!nodeType) return;

    resetNodeToDefault(nodeId, nodeType);

    let pool = context.pool.get(nodeType);
    if (!pool) {
      pool = [];
      context.pool.set(nodeType, pool);
    }
    pool.push(nodeId);

    context.activeBindings.delete(nodeId);
  };

  const applyTextInputInitialProps = (id: number, props: any) => {
    if (!props) return;

    const assign = (key: string, value: unknown) => {
      if (value !== undefined) {
        enqueueBatchOp({ type: "setProp", nodeId: id, name: key, value });
      }
    };

    assign("value", props.value);
    assign("defaultValue", props.defaultValue);
    if (props?.defaultValue != null && props.value == null) {
      enqueueBatchOp({
        type: "setText",
        nodeId: id,
        value: String(props.defaultValue),
      });
    }
    assign("placeholder", props.placeholder);
    assign("multiline", props.multiline);
    assign("numberOfLines", props.numberOfLines);
    assign("maxLength", props.maxLength);
    assign("editable", props.editable);
    assign("secureTextEntry", props.secureTextEntry);
    assign("inputMode", props.inputMode);
    assign("autoCapitalize", props.autoCapitalize);
    assign("autoCorrect", props.autoCorrect);
    assign("spellCheck", props.spellCheck);
    assign("returnKeyType", props.returnKeyType);
    assign("blurOnSubmit", props.blurOnSubmit);
    assign("submitBehavior", props.submitBehavior);
    assign("selection", props.selection);
    assign("selectionColor", props.selectionColor);
    assign("caretColor", props.caretColor);
    assign("clearButtonMode", props.clearButtonMode);
    assign("showClearAccessory", props.showClearAccessory);
    assign("eventThrottleMs", props.eventThrottleMs);
    assign(
      "allowProgrammaticJumpDuringEdit",
      props.allowProgrammaticJumpDuringEdit
    );
    assign("testID", props.testID);

    const eventHandlers: Record<string, Function | undefined> = {
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

    for (const [name, handler] of Object.entries(eventHandlers)) {
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

  const api: Host = {
    createRootContainer() {
      PARENTS.set(0, null);
      CHILDREN.set(0, []);
      TYPES.set(0, "root");
      return { id: 0, type: "root" };
    },
    createNode(type, props) {
      let id: number | null = null;

      if (RECYCLING_CONTEXTS.size > 0) {
        for (const [contextId] of RECYCLING_CONTEXTS) {
          const pooled = findAvailableNodeInPool(contextId, type);
          if (pooled !== null) {
            id = pooled;
            NODE_TO_CONTEXT.set(id, contextId);
            break;
          }
        }
      }

      if (id === null) {
        id = ui.createNode(type);
      }

      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TYPES.set(id, type);
      if (props?.style)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "style",
          value: props.style as Style,
        });
      if (typeof props?.onPress === "function") {
        enqueueOperation(() => ui.setHandler(id!, "onPress", props.onPress));
      }
      if (typeof props?.onLayout === "function") {
        enqueueOperation(() => ui.setHandler(id!, "onLayout", props.onLayout));
      }
      if (props?.accessibilityLabel)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "accessibilityLabel",
          value: props.accessibilityLabel,
        });
      if (props?.accessibilityHint)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "accessibilityHint",
          value: props.accessibilityHint,
        });
      if (props?.accessibilityRole)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "accessibilityRole",
          value: props.accessibilityRole,
        });
      if (props?.pointerEvents)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "pointerEvents",
          value: props.pointerEvents,
        });
      if (props?.testID)
        enqueueBatchOp({
          type: "setProp",
          nodeId: id,
          name: "testID",
          value: props.testID,
        });
      if (type === "text-input") {
        applyTextInputInitialProps(id, props);
      }
      schedule();
      return { id, type } as HostNode;
    },
    createText(value) {
      const id: number = ui.createNode("text");
      enqueueBatchOp({ type: "setText", nodeId: id, value: value ?? "" });
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
        enqueueBatchOp({
          type: "setProp",
          nodeId: node.id,
          name: "style",
          value: value || {},
        });
      } else if (name === "controller") {
        // Controller is managed purely on the JS side for now.
        return;
      } else if (typeof value === "function") {
        enqueueOperation(() => ui.setHandler(node.id, name, value));
      } else {
        if (
          tryEnqueueBatch({
            type: "setProp",
            nodeId: node.id,
            name,
            value,
          })
        ) {
          return;
        }
        enqueueBatchOp({
          type: "setProp",
          nodeId: node.id,
          name,
          value,
        });
      }
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
      enqueueBatchOp({
        type: "setText",
        nodeId: node.id,
        value: value ?? "",
      });
      schedule();
    },
    insertNode(parent, node, anchor) {
      const kids = ensure(parent.id);
      const aIdx = anchor ? kids.indexOf(anchor.id) : -1;
      const logicalAt = aIdx >= 0 ? aIdx : kids.length;

      // physical index counts only non-markers STRICTLY BEFORE logicalAt
      let physIdx = 0;
      for (let i = 0; i < logicalAt; i++) if (!isMarkerId(kids[i])) physIdx++;

      let currentParent: number | null = parent.id;
      while (currentParent !== null) {
        const contextId = CONTAINER_TO_CONTEXT.get(currentParent);
        if (contextId && RECYCLING_CONTEXTS.has(contextId)) {
          const isDirectChild =
            PARENTS.get(parent.id) === currentParent ||
            parent.id === currentParent;

          if (isDirectChild && !NODE_TO_CONTEXT.has(node.id)) {
            NODE_TO_CONTEXT.set(node.id, contextId);
          } else if (!NODE_TO_CONTEXT.has(node.id)) {
            let ancestorId: number | null = parent.id;
            while (ancestorId !== null) {
              const inherited = NODE_TO_CONTEXT.get(ancestorId);
              if (inherited) {
                NODE_TO_CONTEXT.set(node.id, inherited);
                break;
              }
              ancestorId = PARENTS.get(ancestorId) ?? null;
            }
          }

          break;
        }
        currentParent = PARENTS.get(currentParent) ?? null;
      }

      // mutate logical structure AFTER computing physIdx
      kids.splice(logicalAt, 0, node.id);
      PARENTS.set(node.id, parent.id);

      if (!isMarkerId(node.id))
        enqueueOperation(() => ui.insertChild(parent.id, node.id, physIdx));
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

      const contextId = NODE_TO_CONTEXT.get(node.id);
      const shouldRecycle = contextId && RECYCLING_CONTEXTS.has(contextId);

      if (shouldRecycle) {
        kids.splice(i, 1);
        PARENTS.set(node.id, null);
        if (!isMarkerId(node.id)) {
          enqueueOperation(() => ui.removeChild(parent.id, node.id));
          returnNodeToPool(contextId!, node.id);
        }
        schedule();
        return;
      }

      kids.splice(i, 1);
      PARENTS.set(node.id, null);
      if (!isMarkerId(node.id)) {
        TYPES.delete(node.id);
        NODE_TO_CONTEXT.delete(node.id);
        enqueueOperation(() => ui.removeChild(parent.id, node.id));
      } else if (contextId) {
        NODE_TO_CONTEXT.delete(node.id);
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
      // Force flush via runFlush to ensure coalescing
      runFlush();
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

      const existingChildren = CHILDREN.get(containerId) || [];
      for (const childId of existingChildren) {
        if (isMarkerId(childId)) continue;
        const childType = TYPES.get(childId);
        if (childType === config.itemType) {
          NODE_TO_CONTEXT.set(childId, contextId);
        }
      }

      return contextId;
    },
    disableRecycling(contextId: string) {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;

      for (const [nodeId] of context.activeBindings) {
        returnNodeToPool(contextId, nodeId);
      }

      for (const [, nodes] of context.pool) {
        for (const nodeId of nodes) {
          const parentId = PARENTS.get(nodeId);
          if (parentId != null) {
            const parentNode = nodeFor(parentId);
            api.removeNode(parentNode, nodeFor(nodeId));
          }
          NODE_TO_CONTEXT.delete(nodeId);
        }
      }

      RECYCLING_CONTEXTS.delete(contextId);
      for (const [containerId, ctxId] of CONTAINER_TO_CONTEXT) {
        if (ctxId === contextId) {
          CONTAINER_TO_CONTEXT.delete(containerId);
        }
      }
      schedule();
    },
    reclaimNode(contextId: string, node: HostNode) {
      if (!RECYCLING_CONTEXTS.has(contextId)) return;
      returnNodeToPool(contextId, node.id);
      schedule();
    },
    acquireNode(
      contextId: string,
      type: HostNode["type"],
      itemKey: string,
      itemIndex: number
    ): HostNode | null {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return null;

      let nodeId = findAvailableNodeInPool(contextId, type);
      if (nodeId === null) {
        const activeCount = context.activeBindings.size;
        if (activeCount >= context.config.poolSize) {
          return null;
        }
        if (type === "root") return null;
        const newNode = api.createNode(type, {});
        NODE_TO_CONTEXT.set(newNode.id, contextId);
        context.activeBindings.set(newNode.id, { itemKey, itemIndex });
        return newNode;
      }

      context.activeBindings.set(nodeId, { itemKey, itemIndex });
      NODE_TO_CONTEXT.set(nodeId, contextId);
      return nodeFor(nodeId);
    },
    updateNodeBinding(
      node: HostNode,
      itemKey: string,
      itemIndex: number,
      props: Record<string, any>
    ) {
      const contextId = NODE_TO_CONTEXT.get(node.id);
      if (!contextId) return;
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;

      context.activeBindings.set(node.id, { itemKey, itemIndex });

      if (props.style !== undefined) {
        if (
          tryEnqueueBatch({
            type: "setProp",
            nodeId: node.id,
            name: "style",
            value: props.style || {},
          })
        ) {
          // batched
        } else {
          enqueueBatchOp({
            type: "setProp",
            nodeId: node.id,
            name: "style",
            value: props.style || {},
          });
        }
      }

      for (const [key, value] of Object.entries(props)) {
        if (key === "style") continue;
        if (typeof value === "function") {
          enqueueOperation(() => ui.setHandler(node.id, key, value));
        } else if (value !== undefined) {
          if (
            tryEnqueueBatch({
              type: "setProp",
              nodeId: node.id,
              name: key,
              value,
            })
          ) {
            continue;
          }
          enqueueBatchOp({
            type: "setProp",
            nodeId: node.id,
            name: key,
            value,
          });
        }
      }
      schedule();
    },
  };

  return api;
}
