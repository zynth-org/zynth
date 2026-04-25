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
import {
  startNativeTransition,
  stopNativeTransition,
  type NativeTransitionConfig,
} from "../animation/native";

export function createIOSHost(): Host {
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

  // FinalizationRegistry for safe destruction
  const registry =
    typeof (globalThis as any).FinalizationRegistry !== "undefined"
      ? new (globalThis as any).FinalizationRegistry((heldId: number) => {
          // When HostNode is GC'd, we can safely destroy the native node and our maps
          destroySubtreeTracking(heldId);
          schedule();
        })
      : null;

  const suppressionKey = "__zynthSuppressNativeMutations";
  const isSuppressed = () => Boolean((g as any)[suppressionKey]);

  // Structured Queue System
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
  const rescuedRemovals = new Set<number>();
  const readyForDestruction = new Map<number, number>();
  const pendingDrops = new Set<number>();
  const exitTransitions = new Map<
    number,
    Omit<NativeTransitionConfig, "nodeId" | "animationId" | "phase">
  >();
  const exitRemovalTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextExitAnimationId = 1;

  const cancelPendingExitRemoval = (nodeId: number) => {
    const timer = exitRemovalTimers.get(nodeId);
    if (timer === undefined) return;
    clearTimeout(timer);
    exitRemovalTimers.delete(nodeId);
    void stopNativeTransition(nodeId);
  };

  const getExitDurationMs = (
    transition: Omit<NativeTransitionConfig, "nodeId" | "animationId" | "phase">,
  ) => {
    const duration = typeof transition.duration === "number" ? transition.duration : 300;
    const delay = typeof transition.delay === "number" ? transition.delay : 0;
    return Math.max(0, duration) + Math.max(0, delay);
  };

  const enqueueOperation = (operation: () => void) => {
    if (isSuppressed()) return;
    queue.push({ type: "closure", func: operation });
  };

  const enqueueBatchOp = (op: BatchOperation) => {
    if (isSuppressed()) return;
    queue.push({ type: "batch", op });
  };

  const encodeTypedBatch = (ops: BatchOperation[]) => {
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
        encoded.push(1, nodeId, addString(name), 0, 0);
        return;
      }
      switch (typeof value) {
        case "number":
          encoded.push(1, nodeId, addString(name), 1, value);
          return;
        case "boolean":
          encoded.push(1, nodeId, addString(name), 3, value ? 1 : 0);
          return;
        case "string":
          encoded.push(1, nodeId, addString(name), 2, addString(value));
          return;
        case "object":
          try {
            encoded.push(
              1,
              nodeId,
              addString(name),
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
          if (value == null) {
            encodeProp(nodeId, key, null);
          } else {
            const normalized = normalizeTransform(value);
            if (normalized != null) {
              encodeProp(nodeId, key, normalized);
            }
          }
          continue;
        }
        if (key === "shadowOffset") {
          if (value == null) {
            encodeProp(nodeId, key, null);
          } else {
            const normalized = normalizeShadowOffset(value);
            if (normalized != null) {
              encodeProp(nodeId, key, normalized);
            }
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
      meta: { kind: "flush", scope: "global" },
      stringTable,
      ops: new Float64Array(encoded).buffer,
    };
  };

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
    if (batchStack.length > 0) return; // Wait for the outer-most batch to finish
    flushScheduled = false;

    try {
      if (!queue.length && !pendingRemovals.size && !readyForDestruction.size && !pendingDrops.size) return;

      const pending = queue.splice(0);
      let batchAccumulator: BatchOperation[] = [];

      const flushBatch = () => {
        if (!batchAccumulator.length) return;
        if (typeof (ui as any).applyBatchTyped !== "function") {
          throw new Error("Typed batch is required for iOS host");
        }
        (ui as any).applyBatchTyped(encodeTypedBatch(batchAccumulator));
        batchAccumulator = [];
      };

      // PHASE 2: Finally destroy nodes that were DETACHED in the PREVIOUS flush
      if (readyForDestruction.size) {
        for (const childId of readyForDestruction.keys()) {
          destroySubtreeTracking(childId);
        }
        readyForDestruction.clear();
      }

      // PHASE 1: Process current removals and move them to readyForDestruction
      if (pendingRemovals.size) {
        for (const [childId, parentId] of pendingRemovals) {
          const node = nodeFor(childId);
          const rescued = rescuedRemovals.has(childId);
          const contextId = NODE_TO_CONTEXT.get(childId);
          const shouldRecycle =
            !rescued &&
            contextId &&
            RECYCLING_CONTEXTS.has(contextId) &&
            node.type !== "text";
          const exitTransition = exitTransitions.get(childId);

          const enqueueNativeRemove = () => {
            batchAccumulator.push({
              type: "removeChild",
              parentId,
              childId,
            });
          };

          if (shouldRecycle) {
            returnNodeToPool(contextId!, childId);
            const childIds = CHILDREN.get(childId);
            if (childIds) {
              for (const cid of [...childIds]) {
                destroySubtreeTracking(cid);
              }
              CHILDREN.delete(childId);
            }
            enqueueNativeRemove();
            continue;
          }

          if (!rescued && exitTransition) {
            void startNativeTransition({
              nodeId: childId,
              animationId: nextExitAnimationId++,
              phase: "exit",
              from: exitTransition.from,
              to: exitTransition.to,
              frames: exitTransition.frames,
              duration: exitTransition.duration,
              delay: exitTransition.delay,
              easing: exitTransition.easing,
            });
            const timer = setTimeout(() => {
              exitRemovalTimers.delete(childId);
              const finalOp: BatchOperation = {
                type: "removeChild",
                parentId,
                childId,
              };
              (ui as any).applyBatchTyped(encodeTypedBatch([finalOp]));
              destroySubtreeTracking(childId);
              ui.flush();
            }, getExitDurationMs(exitTransition) + 17);
            exitRemovalTimers.set(childId, timer);
          } else {
            enqueueNativeRemove();
            if (!rescued) {
              // Move to readyForDestruction safety net.
              // Will be fully destroyed in the NEXT flush if not rescued.
              readyForDestruction.set(childId, parentId);
            }
          }
        }
        pendingRemovals.clear();
        rescuedRemovals.clear();
      }

      for (const item of pending) {
        if (item.type === "batch") {
          batchAccumulator.push(item.op);
        } else {
          flushBatch();
          item.func();
        }
      }

      if (pendingDrops.size) {
        for (const nodeId of pendingDrops) {
          batchAccumulator.push({ type: "dropNode", nodeId });
        }
        pendingDrops.clear();
      }

      flushBatch();
      ui.flush();
    } catch (e) {
      console.error("Flush error:", JSON.stringify(e));
    }
  };

  const schedule = () => {
    if (flushScheduled || batchStack.length > 0) return;
    flushScheduled = true;

    if (typeof queueMicrotask === "function") {
      queueMicrotask(runFlush);
      return;
    }
    setTimeout(runFlush, 0);
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

  const detachNodeFromRecyclingState = (nodeId: number) => {
    const contextId = NODE_TO_CONTEXT.get(nodeId);
    if (!contextId) return;
    const context = RECYCLING_CONTEXTS.get(contextId);
    if (context) {
      context.activeBindings.delete(nodeId);
      for (const pool of context.pool.values()) {
        const index = pool.indexOf(nodeId);
        if (index >= 0) {
          pool.splice(index, 1);
        }
      }
    }
    NODE_TO_CONTEXT.delete(nodeId);
  };

  const destroySubtreeTracking = (rootId: number) => {
    const stack: { id: number; expanded: boolean }[] = [
      { id: rootId, expanded: false },
    ];
    const seen = new Set<number>();
    const ordered: number[] = [];

    while (stack.length) {
      const item = stack.pop()!;
      if (item.expanded) {
        ordered.push(item.id);
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      stack.push({ id: item.id, expanded: true });
      const childIds = CHILDREN.get(item.id);
      if (childIds) {
        for (let i = childIds.length - 1; i >= 0; i--) {
          stack.push({ id: childIds[i], expanded: false });
        }
      }
    }

    for (const nodeId of ordered) {
      cancelPendingExitRemoval(nodeId);
      exitTransitions.delete(nodeId);
      if (!isMarkerId(nodeId)) {
        recordPendingDrop(nodeId);
      }
      TEXTS.delete(nodeId);
      TYPES.delete(nodeId);
      detachNodeFromRecyclingState(nodeId);
      CHILDREN.delete(nodeId);
      PARENTS.delete(nodeId);
    }
  };

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
    type: HostNode["type"],
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

    let pool = context.pool.get(nodeType);
    if (!pool) {
      pool = [];
      context.pool.set(nodeType, pool);
    }

    if (pool.length < 512) {
      resetNodeToDefault(nodeId, nodeType);
      pool.push(nodeId);
    } else {
      recordPendingDrop(nodeId);
      TEXTS.delete(nodeId);
      TYPES.delete(nodeId);
      detachNodeFromRecyclingState(nodeId);
      CHILDREN.delete(nodeId);
      PARENTS.delete(nodeId);
    }

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
      props.allowProgrammaticJumpDuringEdit,
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
      let recycled = false;
      const inBatch = !!currentBatch();

      if (type !== "text" && RECYCLING_CONTEXTS.size > 0) {
        for (const [contextId] of RECYCLING_CONTEXTS) {
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
      if (props?.__zynthExiting && typeof props.__zynthExiting === "object") {
        exitTransitions.set(
          id,
          props.__zynthExiting as Omit<
            NativeTransitionConfig,
            "nodeId" | "animationId" | "phase"
          >,
        );
      }
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
      if (name === "__zynthExiting") {
        if (value && typeof value === "object") {
          exitTransitions.set(
            node.id,
            value as Omit<NativeTransitionConfig, "nodeId" | "animationId" | "phase">,
          );
        } else {
          exitTransitions.delete(node.id);
        }
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
      if (name === "handler") {
        if (typeof value === "function") {
          enqueueOperation(() => ui.setHandler(node.id, name, value));
          schedule();
          return;
        }
        if (value == null && typeof ui.clearInputHandler === "function") {
          enqueueOperation(() => ui.clearInputHandler!(node.id));
          schedule();
        }
        return;
      }
      if (typeof value === "function") {
        enqueueOperation(() => ui.setHandler(node.id, name, value));
        schedule();
        return;
      }
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
      if (anchor && anchor.id === node.id) return;
      cancelPendingExitRemoval(node.id);
      if (pendingDrops.has(node.id)) pendingDrops.delete(node.id);
      if (pendingRemovals.has(node.id)) rescuedRemovals.add(node.id);
      if (readyForDestruction.has(node.id)) readyForDestruction.delete(node.id);

      const kids = ensure(parent.id);
      const existingIdx = kids.indexOf(node.id);
      if (existingIdx >= 0) {
        kids.splice(existingIdx, 1);
      }

      const aIdx = anchor ? kids.indexOf(anchor.id) : -1;
      const logicalAt = aIdx >= 0 ? Math.min(aIdx, kids.length) : kids.length;

      if (parent.type === "text" && logicalAt < kids.length) {
        const oldId = kids[logicalAt];
        if (oldId !== node.id && !isMarkerId(oldId)) {
          recordPendingDrop(oldId);
          TEXTS.delete(oldId);
          TYPES.delete(oldId);
          PARENTS.delete(oldId);
          kids.splice(logicalAt, 1);
        }
      }

      let physIdx = 0;
      for (let i = 0; i < logicalAt; i++) if (!isMarkerId(kids[i])) physIdx++;

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
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      schedule();
    },
    removeNode(parent, node) {
      const kids = ensure(parent.id);
      let i = kids.indexOf(node.id);
      if (i < 0) {
        return;
      }
      kids.splice(i, 1);
      if (kids.length === 0) CHILDREN.delete(parent.id);
      PARENTS.set(node.id, null);
      if (!isMarkerId(node.id)) {
        rescuedRemovals.delete(node.id);
        recordPendingRemoval(parent.id, node.id);
      } else {
        destroySubtreeTracking(node.id);
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
          ...context.operations,
        );
        return;
      }
      
      // We are at the end of the outer-most batch.
      // Move all context operations into the main queue for runFlush.
      for (const op of context.operations) {
        queue.push({ type: "batch", op });
      }

      runFlush();
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
      itemIndex: number,
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
      props: Record<string, any>,
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
