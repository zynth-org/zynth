import type {
  Host,
  HostNode,
  HostBatchMeta,
  Style,
  RecyclingConfig,
  RecyclingContext,
} from "./HostTypes";
import type { ZynthUIBridge } from "../bridge";

export function createAndroidHost(): Host {
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

  // Recycling system
  const RECYCLING_CONTEXTS = new Map<string, RecyclingContext>();
  const NODE_TO_CONTEXT = new Map<number, string>(); // track which context owns each node
  const CONTAINER_TO_CONTEXT = new Map<number, string>(); // map container nodeId -> contextId
  let nextContextId = 0;
  let activeRecyclingContext: string | null = null; // Currently active context for createNode

  // FinalizationRegistry for safe destruction
  const registry =
    typeof (globalThis as any).FinalizationRegistry !== "undefined"
      ? new (globalThis as any).FinalizationRegistry((heldId: number) => {
          // When HostNode is GC'd, we can safely destroy the native node
          enqueueBatchOp({ type: "dropNode", nodeId: heldId });
          schedule();
        })
      : null;

  // NEW: Structured Queue System
  type BatchOperation =
    | { type: "insertChild"; parentId: number; childId: number; index: number }
    | { type: "removeChild"; parentId: number; childId: number }
    | { type: "dropNode"; nodeId: number }
    | { type: "setProp"; nodeId: number; name: string; value: any }
    | { type: "setText"; nodeId: number; value: any };

  type QueueItem =
    | { type: "closure"; func: () => void }
    | { type: "batch"; op: BatchOperation };

  const queue: QueueItem[] = [];
  const pendingRemovals = new Map<number, number>();
  const pendingDrops = new Set<number>();
  const suppressionKey = "__zynthSuppressNativeMutations";
  const isSuppressed = () => Boolean((g as any)[suppressionKey]);

  const enqueueOperation = (operation: () => void) => {
    if (isSuppressed()) return;
    queue.push({ type: "closure", func: operation });
  };

  const enqueueBatchOp = (op: BatchOperation) => {
    if (isSuppressed()) return;
    queue.push({ type: "batch", op });
  };

  const STYLE_PROP_MAP: Record<string, number> = {
    width: 1,
    height: 2,
    minWidth: 3,
    minHeight: 4,
    maxWidth: 5,
    maxHeight: 6,
    flex: 7,
    flexGrow: 8,
    flexShrink: 9,
    flexBasis: 10,
    flexDirection: 11,
    flexWrap: 12,
    justifyContent: 13,
    alignItems: 14,
    alignSelf: 15,
    alignContent: 16,
    position: 17,
    top: 18,
    right: 19,
    bottom: 20,
    left: 21,
    padding: 22,
    paddingHorizontal: 23,
    paddingVertical: 24,
    paddingTop: 25,
    paddingRight: 26,
    paddingBottom: 27,
    paddingLeft: 28,
    margin: 29,
    marginHorizontal: 30,
    marginVertical: 31,
    marginTop: 32,
    marginRight: 33,
    marginBottom: 34,
    marginLeft: 35,
    gap: 36,
    rowGap: 37,
    columnGap: 38,
    aspectRatio: 39,
    overflow: 40,
    display: 41,
    zIndex: 42,
    backgroundColor: 100,
    opacity: 101,
    borderRadius: 102,
    borderWidth: 103,
    borderColor: 104,
    shadowColor: 105,
    shadowOffset: 106,
    shadowOpacity: 107,
    shadowRadius: 108,
    elevation: 109,
  };

  const encodeTypedBatch = (
    ops: BatchOperation[],
    meta: HostBatchMeta = { kind: "flush", scope: "global" },
  ) => {
    const stringTable: string[] = [];
    const stringIndex = new Map<string, number>();
    const encoded: number[] = [];

    const addString = (value: string): number => {
      const existing = stringIndex.get(value);
      if (existing !== undefined) return existing;
      const nextIndex = stringTable.length;
      stringTable.push(value);
      stringIndex.set(value, nextIndex);
      return nextIndex;
    };

    const normalizeTransform = (value: unknown): string | null => {
      if (value == null) return null;
      if (typeof value === "string") return value;
      if (!Array.isArray(value)) return null;
      const parts: string[] = [];
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        for (const [key, raw] of Object.entries(entry as Record<string, any>)) {
          let arg: string | null = null;
          if (Array.isArray(raw) && raw.length >= 2 && key === "translate") {
            arg = `${raw[0]}, ${raw[1]}`;
          } else if (typeof raw === "number") {
            if (key.startsWith("rotate") || key.startsWith("skew")) {
              arg = `${raw}deg`;
            } else {
              arg = String(raw);
            }
          } else if (typeof raw === "string") {
            arg = raw;
          }
          if (arg != null) {
            parts.push(`${key}(${arg})`);
          }
        }
      }
      return parts.length ? parts.join(" ") : null;
    };

    const normalizeShadowOffset = (value: unknown): string | null => {
      if (value == null) return null;
      if (typeof value === "string") return value;
      if (Array.isArray(value) && value.length >= 2) {
        return `${value[0]} ${value[1]}`;
      }
      if (typeof value === "object") {
        const width = (value as any).width ?? 0;
        const height = (value as any).height ?? 0;
        return `${width} ${height}`;
      }
      return null;
    };

    const encodeProp = (nodeId: number, name: string, value: any) => {
      if (value == null) {
        const propId = STYLE_PROP_MAP[name] ?? -addString(name);
        encoded.push(1, nodeId, propId, 0, 0);
        return;
      }
      const propId = STYLE_PROP_MAP[name] ?? -addString(name);
      switch (typeof value) {
        case "number":
          encoded.push(1, nodeId, propId, 1, value);
          return;
        case "boolean":
          encoded.push(1, nodeId, propId, 3, value ? 1 : 0);
          return;
        case "string":
          encoded.push(1, nodeId, propId, 2, addString(value));
          return;
        case "object":
          try {
            encoded.push(
              1,
              nodeId,
              propId,
              2,
              addString(JSON.stringify(value)),
            );
          } catch (e) {
            // ignore serialization error
          }
          return;
        default:
          return;
      }
    };

    const encodeStyle = (nodeId: number, style: any) => {
      if (!style) return;
      const resolved = Array.isArray(style)
        ? style.reduce((acc, item) => (item ? { ...acc, ...item } : acc), {})
        : style;
      if (!resolved || typeof resolved !== "object") return;
      for (const [key, value] of Object.entries(resolved)) {
        if (key === "transform") {
          const normalized = normalizeTransform(value);
          if (normalized != null) {
            encodeProp(nodeId, key, normalized);
          }
          continue;
        }
        if (key === "shadowOffset") {
          const normalized = normalizeShadowOffset(value);
          if (normalized != null) {
            encodeProp(nodeId, key, normalized);
          }
          continue;
        }
        if (Array.isArray(value)) {
          try {
            encodeProp(nodeId, key, JSON.stringify(value));
          } catch {
            continue;
          }
          continue;
        }
        if (typeof value === "object" && value != null) {
          // Skip unsupported structured values to avoid JSON serialization.
          continue;
        }
        encodeProp(nodeId, key, value);
      }
    };

    for (const op of ops) {
      switch (op.type) {
        case "setProp": {
          if (op.name === "style") {
            encodeStyle(op.nodeId, op.value);
          } else {
            encodeProp(op.nodeId, op.name, op.value);
          }
          break;
        }
        case "setText": {
          const textValue = op.value == null ? "" : String(op.value);
          encoded.push(2, op.nodeId, addString(textValue));
          break;
        }
        case "insertChild":
          encoded.push(3, op.parentId, op.childId, op.index);
          break;
        case "removeChild":
          encoded.push(4, op.parentId, op.childId);
          break;
        case "dropNode":
          encoded.push(5, op.nodeId);
          break;
      }
    }

    return {
      meta,
      stringTable,
      ops: new Float64Array(encoded).buffer,
    };
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
      if (queue.length || pendingRemovals.size || pendingDrops.size) {
        const pending = queue.splice(0);
        let batchAccumulator: BatchOperation[] = [];
        const deferredClosures: Array<() => void> = [];

        const flushBatch = () => {
          if (!batchAccumulator.length) return;
          if (typeof (ui as any).applyBatchTyped !== "function") {
            throw new Error("Typed batch is required for Android host");
          }
          (ui as any).applyBatchTyped(
            encodeTypedBatch(batchAccumulator, { kind: "flush", scope: "global" }),
          );
          batchAccumulator = [];
        };

        for (const item of pending) {
          if (item.type === "batch") {
            batchAccumulator.push(item.op);
          } else {
            deferredClosures.push(item.func);
          }
        }
        if (pendingRemovals.size) {
          for (const [childId, parentId] of pendingRemovals) {
            batchAccumulator.push({
              type: "removeChild",
              parentId,
              childId,
            });
          }
          pendingRemovals.clear();
        }
        if (pendingDrops.size) {
          for (const nodeId of pendingDrops) {
            batchAccumulator.push({
              type: "dropNode",
              nodeId,
            });
          }
          pendingDrops.clear();
        }
        flushBatch();
        for (const fn of deferredClosures) {
          fn();
        }
      }
      ui.flush();
    } catch (e) {
      console.error("Flush error:", JSON.stringify(e));
    }
  };

  const schedule = () => {
    if (flushScheduled || rafHandle != null) return;
    flushScheduled = true;

    if (
      typeof requestAnimationFrame === "function" &&
      typeof cancelAnimationFrame === "function"
    ) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        runFlush();
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

  const recordPendingRemoval = (parentId: number, childId: number) => {
    pendingRemovals.set(childId, parentId);
  };

  const recordPendingDrop = (nodeId: number) => {
    pendingDrops.add(nodeId);
  };

  const applyTextInputInitialProps = (id: number, props: any) => {
    if (!props) return;

    const assign = (key: string, value: unknown) => {
      if (value !== undefined) {
        const op: BatchOperation = { type: "setProp", nodeId: id, name: key, value };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
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
      enqueueBatchOp({
        type: "setText",
        nodeId: id,
        value: String(props.defaultValue),
      });
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
    enqueueBatchOp({
      type: "setProp",
      nodeId,
      name: "style",
      value: {},
    });
    if (type === "text") {
      enqueueBatchOp({ type: "setText", nodeId, value: "" });
      TEXTS.set(nodeId, "");
    }
  };

  const findAvailableNodeInPool = (
    contextId: string,
    type: HostNode["type"],
  ): number | null => {
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (!context) {
      console.log(
        `[Host/findAvailableNodeInPool] ❌ Context ${contextId} not found`,
      );
      return null;
    }

    const pool = context.pool.get(type);
    if (!pool || pool.length === 0) {
      return null;
    }

    const nodeId = pool.pop() ?? null;
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
      const inBatch = !!currentBatch();

      if (type !== "text" && RECYCLING_CONTEXTS.size > 0) {
        for (const [contextId, context] of RECYCLING_CONTEXTS) {
          const pooled = findAvailableNodeInPool(contextId, type);
          if (pooled !== null) {
            id = pooled;
            recycled = true;
            NODE_TO_CONTEXT.set(id, contextId);
            break;
          }
        }
      }

      if (id === null) {
        id = ui.createNode(type);
      }

      const node = { id, type } as HostNode;
      if (registry && !recycled) {
        registry.register(node, id);
      }

      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TYPES.set(id, type);
      if (props?.style) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "style",
          value: props.style as Style,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (typeof props?.onPress === "function") {
        enqueueOperation(() => ui.setHandler(id!, "onPress", props.onPress));
      }
      if (typeof props?.onLayout === "function") {
        enqueueOperation(() => ui.setHandler(id!, "onLayout", props.onLayout));
      }
      if (props?.accessibilityLabel) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityLabel",
          value: props.accessibilityLabel,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (props?.accessibilityHint) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityHint",
          value: props.accessibilityHint,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (props?.accessibilityRole) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityRole",
          value: props.accessibilityRole,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (props?.pointerEvents) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "pointerEvents",
          value: props.pointerEvents,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (props?.testID) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "testID",
          value: props.testID,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
      }
      if (type === "text-input" || type === "secure-text-input") {
        applyTextInputInitialProps(id, props);
      }
      if (!inBatch) {
        schedule();
      }
      return { id, type } as HostNode;
    },
    createText(value) {
      const id: number = ui.createNode("text");
      const setTextOp: BatchOperation = {
        type: "setText",
        nodeId: id,
        value: value ?? "",
      };
      if (!tryEnqueueBatch(setTextOp)) {
        enqueueBatchOp(setTextOp);
      }
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TEXTS.set(id, value ?? "");
      TYPES.set(id, "text");
      if (!currentBatch()) {
        schedule();
      }
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
      enqueueBatchOp({ type: "setProp", nodeId: node.id, name, value });
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
      enqueueBatchOp({ type: "setText", nodeId: node.id, value: value ?? "" });
      schedule();
    },
    insertNode(parent, node, anchor) {
      if (anchor && anchor.id === node.id) return;
      if (pendingRemovals.has(node.id)) {
        pendingRemovals.delete(node.id);
      }
      if (pendingDrops.has(node.id)) {
        pendingDrops.delete(node.id);
      }
      const prevParentId = PARENTS.get(node.id);
      if (prevParentId != null) {
        const prevKids = ensure(prevParentId);
        const prevIndex = prevKids.indexOf(node.id);
        if (prevIndex >= 0) {
          prevKids.splice(prevIndex, 1);
        }
      }

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
            }
          }

          break;
        }
        currentParent = PARENTS.get(currentParent) ?? null;
      }

      // mutate logical structure AFTER computing physIdx
      kids.splice(logicalAt, 0, node.id);
      PARENTS.set(node.id, parent.id);
      TYPES.set(node.id, node.type);

      if (!isMarkerId(node.id)) {
        const op = {
          type: "insertChild" as const,
          parentId: parent.id,
          childId: node.id,
          index: physIdx,
        };
        if (!tryEnqueueBatch(op)) {
          enqueueBatchOp(op);
        }
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
      const shouldRecycle =
        contextId && RECYCLING_CONTEXTS.has(contextId) && node.type !== "text";

      const enqueueRemoveOp = () => {
        recordPendingRemoval(parent.id, node.id);
      };

      if (shouldRecycle) {
        // Return to pool instead of destroying
        returnNodeToPool(contextId!, node.id);

        // Detach from parent but don't destroy
        kids.splice(i, 1);
        PARENTS.set(node.id, null);

        if (!isMarkerId(node.id)) {
          // Just detach visually, don't actually remove from native
          enqueueRemoveOp();
        }
        schedule();
        return;
      }

      // Standard destruction path
      kids.splice(i, 1);
      PARENTS.set(node.id, null);
      if (!isMarkerId(node.id)) {
        TYPES.delete(node.id);
        NODE_TO_CONTEXT.delete(node.id);
        enqueueRemoveOp();
        recordPendingDrop(node.id);
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
          ...context.operations,
        );
        return;
      }
      if (!context.operations.length) return;

      if (isSuppressed()) return;

      if (typeof (ui as any).applyBatchTyped === "function") {
        (ui as any).applyBatchTyped(
          encodeTypedBatch(context.operations, context.meta),
        );
        // Coalesce flushes across multiple batch completions in the same tick.
        // Immediate flush here causes partial commits during navigation
        // (header/content/text settling across several frames).
        schedule();
        return;
      }

      throw new Error("Typed batch is required for Android host");
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
        containerChildren.map((id) => `${id}(${TYPES.get(id)})`).join(", "),
      );

      let markedCount = 0;
      for (const childId of containerChildren) {
        if (isMarkerId(childId)) {
          console.log(`[Host/Recycling] ⏭️  Skipping marker ${childId}`);
          continue;
        }

        const childType = TYPES.get(childId);

        // Only mark View nodes (containers), not Text or other types
        if (childType === config.itemType) {
          NODE_TO_CONTEXT.set(childId, contextId);
          markedCount++;
        }
      }

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
    },

    reclaimNode(contextId: string, node: HostNode) {
      if (!RECYCLING_CONTEXTS.has(contextId)) {
        return;
      }
      returnNodeToPool(contextId, node.id);
    },

    acquireNode(
      contextId: string,
      type: HostNode["type"],
      itemKey: string,
      itemIndex: number,
    ): HostNode | null {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) {
        return null;
      }

      // Try to get from pool first
      let nodeId = findAvailableNodeInPool(contextId, type);

      if (nodeId !== null) {
        // Reusing existing node
        context.activeBindings.set(nodeId, { itemKey, itemIndex });
        return nodeFor(nodeId);
      }

      // Pool exhausted - create new node if within pool size limit
      const currentActiveCount = context.activeBindings.size;
      if (currentActiveCount >= context.config.poolSize) {
        return null;
      }

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
      props: Record<string, any>,
    ) {
      const contextId = NODE_TO_CONTEXT.get(node.id);
      if (!contextId) {
        return;
      }

      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;

      // Update binding metadata
      context.activeBindings.set(node.id, { itemKey, itemIndex });

      // Apply props efficiently using batch if available
      if (props.style !== undefined) {
        enqueueBatchOp({
          type: "setProp",
          nodeId: node.id,
          name: "style",
          value: props.style || {},
        });
      }

      for (const [key, value] of Object.entries(props)) {
        if (key === "style") continue; // Already handled
        if (typeof value === "function") {
          enqueueOperation(() => ui.setHandler(node.id, key, value));
        } else if (value !== undefined) {
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
