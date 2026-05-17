import type {
  Host,
  HostNode,
  HostBatchMeta,
  Style,
  RecyclingConfig,
  RecyclingContext,
} from "./HostTypes";
import type { ZynthUIBridge } from "../bridge";
import {
  startNativeTransition,
  stopNativeTransition,
  type NativeTransitionConfig,
} from "../animation/native";

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

  // FinalizationRegistry for safe destruction
  const registry =
    typeof (globalThis as any).FinalizationRegistry !== "undefined"
      ? new (globalThis as any).FinalizationRegistry((heldId: number) => {
          // When HostNode is GC'd, we can safely destroy the native node and our internal tracking maps
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
    | { type: "batch"; op: BatchOperation }
    | { type: "batchGroup"; meta: HostBatchMeta; ops: BatchOperation[] };

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
    transition: Omit<NativeTransitionConfig, "nodeId" | "animationId" | "phase">
  ) => {
    const duration =
      typeof transition.duration === "number" ? transition.duration : 300;
    const delay = typeof transition.delay === "number" ? transition.delay : 0;
    return Math.max(0, duration) + Math.max(0, delay);
  };

  const enqueueOperation = (operation: () => void) => {
    queue.push({ type: "closure", func: operation });
  };

  const enqueueBatchOp = (op: BatchOperation) => {
    queue.push({ type: "batch", op });
  };

  const maybeCallNativeHandler = (nodeId: number, name: string, handler: Function) => {
    if (isSuppressed()) {
      enqueueOperation(() => ui.setHandler(nodeId, name, handler));
    } else {
      ui.setHandler(nodeId, name, handler);
    }
  };

  const formatFlushError = (error: unknown) => {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    if (typeof error === "string") {
      return { message: error };
    }
    if (error && typeof error === "object") {
      const candidate = error as {
        message?: unknown;
        stack?: unknown;
        name?: unknown;
      };
      return {
        name: typeof candidate.name === "string" ? candidate.name : undefined,
        message:
          typeof candidate.message === "string"
            ? candidate.message
            : String(error),
        stack:
          typeof candidate.stack === "string" ? candidate.stack : undefined,
        raw: error,
      };
    }
    return { message: String(error) };
  };

  const PROP_TO_ID: Record<string, number> = {
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
    top: 11,
    right: 12,
    bottom: 13,
    left: 14,
    padding: 15,
    paddingHorizontal: 16,
    paddingVertical: 17,
    paddingTop: 18,
    paddingRight: 19,
    paddingBottom: 20,
    paddingLeft: 21,
    margin: 22,
    marginHorizontal: 23,
    marginVertical: 24,
    marginTop: 25,
    marginRight: 26,
    marginBottom: 27,
    marginLeft: 28,
    gap: 29,
    rowGap: 30,
    columnGap: 31,
    aspectRatio: 32,
    flexDirection: 33,
    justifyContent: 34,
    alignItems: 35,
    alignSelf: 36,
    alignContent: 37,
    flexWrap: 38,
    position: 39,
    display: 40,
    overflow: 41,
    background: 42,
    backgroundImage: 43,
    backgroundColor: 44,
    borderColor: 45,
    borderStyle: 46,
    borderRadius: 47,
    borderWidth: 48,
    borderTopWidth: 49,
    borderRightWidth: 50,
    borderBottomWidth: 51,
    borderLeftWidth: 52,
    borderTopLeftRadius: 53,
    borderTopRightRadius: 54,
    borderBottomRightRadius: 55,
    borderBottomLeftRadius: 56,
    color: 57,
    fontSize: 58,
    fontWeight: 59,
    fontFamily: 60,
    fontStyle: 61,
    textAlign: 62,
    opacity: 63,
    elevation: 64,
    zIndex: 65,
    transform: 66,
    transformOrigin: 67,
    shadowColor: 68,
    shadowOpacity: 69,
    shadowRadius: 70,
    shadowOffset: 71,
    boxShadow: 72,
    lineHeight: 73,
    lineSpacing: 74,
    paragraphSpacing: 75,
    letterSpacing: 76,
    textDecorationLine: 77,
    textTransform: 78,
    minimumFontScale: 79,
    baselineShift: 80,
    hyphenation: 81,
    pointerEvents: 82,
    accessibilityLabel: 83,
    accessibilityHint: 84,
    accessibilityRole: 85,
    testID: 86,
    layout: 87,
    delayLongPressMs: 88,
    doublePressWindowMs: 89,
    enableDoublePress: 90,
    multiline: 91,
    numberOfLines: 92,
    maxLength: 93,
    editable: 94,
    secureTextEntry: 95,
    inputMode: 96,
    autoCapitalize: 97,
    autoCorrect: 98,
    spellCheck: 99,
    returnKeyType: 100,
    blurOnSubmit: 101,
    submitBehavior: 102,
    eventThrottleMs: 103,
    allowProgrammaticJumpDuringEdit: 104,
    value: 105,
    defaultValue: 106,
    placeholder: 107,
    selection: 108,
    selectionColor: 109,
    caretColor: 110,
    clearButtonMode: 111,
    showClearAccessory: 112,
    __scrollCommand: 113,
    borderTopColor: 114,
    borderRightColor: 115,
    borderBottomColor: 116,
    borderLeftColor: 117,
  };

  const encodeTypedBatch = (
    ops: BatchOperation[],
    meta: HostBatchMeta = { kind: "flush", scope: "global" }
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

    const PERCENT_OR_AUTO_PROPS = new Set([
      "width",
      "height",
      "minWidth",
      "minHeight",
      "maxWidth",
      "maxHeight",
      "flexBasis",
      "top",
      "right",
      "bottom",
      "left",
      "padding",
      "paddingHorizontal",
      "paddingVertical",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "margin",
      "marginHorizontal",
      "marginVertical",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
    ]);

    const encodeProp = (nodeId: number, name: string, value: any) => {
      const propId = PROP_TO_ID[name];
      const keyToken = propId !== undefined ? -propId : addString(name);
      if (value == null) {
        encoded.push(1, nodeId, keyToken, 0, 0);
        return;
      }
      switch (typeof value) {
        case "number":
          encoded.push(1, nodeId, keyToken, 1, value);
          return;
        case "boolean":
          encoded.push(1, nodeId, keyToken, 3, value ? 1 : 0);
          return;
        case "string":
          if (PERCENT_OR_AUTO_PROPS.has(name)) {
            const trimmed = value.trim();
            if (trimmed === "auto") {
              encoded.push(1, nodeId, keyToken, 5, 0);
              return;
            }
            if (trimmed.endsWith("%")) {
              const percent = Number(trimmed.slice(0, -1));
              if (Number.isFinite(percent)) {
                encoded.push(1, nodeId, keyToken, 4, percent);
                return;
              }
            }
          }
          encoded.push(1, nodeId, keyToken, 2, addString(value));
          return;
        case "object":
          try {
            encoded.push(
              1,
              nodeId,
              keyToken,
              2,
              addString(JSON.stringify(value))
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
      meta,
      stringTable,
      ops: new Float64Array(encoded).buffer,
    };
  };

  let flushScheduled = false;
  let isNativeBatching = false;

  (globalThis as any).__setNativeBatching = (val: boolean) => {
    isNativeBatching = val;
    if (!val && flushScheduled) {
      runFlush();
    }
  };

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
    if (batchStack.length > 0 || isNativeBatching || isSuppressed()) {
      if (isNativeBatching || isSuppressed()) flushScheduled = true;
      return; 
    }
    flushScheduled = false;

    if ((globalThis as any).__ZYNTH_HMR_DEBUG && (queue.length > 0 || pendingRemovals.size > 0)) {
      console.log("[HOST-ANDROID] runFlush", {
        queue: queue.length,
        removals: pendingRemovals.size,
      });
    }

    try {
      if (
        !queue.length &&
        !pendingRemovals.size &&
        !readyForDestruction.size &&
        !pendingDrops.size
      ) {
        return;
      }

      const pending = queue.splice(0);
      let batchAccumulator: BatchOperation[] = [];
      let currentMeta: HostBatchMeta | null = null;
      let sentAnyOps = false;

      const flushAccumulator = () => {
        if (!batchAccumulator.length) return;
        if (typeof (ui as any).applyBatchTyped !== "function") {
          throw new Error("Typed batch is required for Android host");
        }
        sentAnyOps = true;
        const meta = currentMeta ?? { kind: "flush", scope: "global" };

        if ((globalThis as any).__ZYNTH_HMR_DEBUG) {
          console.log("[HOST-ANDROID] applyBatch", {
            ops: batchAccumulator.length,
            meta: { kind: meta.kind, scope: meta.scope, extras: meta.extras }
          });
        }

        if (meta.scope === "virtual-list-window") {
          logVirtualListFlush(meta, batchAccumulator);
        }

        (ui as any).applyBatchTyped(
          encodeTypedBatch(batchAccumulator, meta)
        );
        batchAccumulator = [];
        currentMeta = null;
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
              // Final native removal for exit
              const finalOp: BatchOperation = {
                type: "removeChild",
                parentId,
                childId,
              };
              (ui as any).applyBatchTyped(
                encodeTypedBatch([finalOp], { kind: "flush", scope: "global" })
              );
              destroySubtreeTracking(childId);
              ui.flush();
            }, getExitDurationMs(exitTransition) + 17);
            exitRemovalTimers.set(childId, timer);
          } else if (!rescued) {
            enqueueNativeRemove();
            // Move to readyForDestruction safety net.
            // Will be fully destroyed in the NEXT flush if not rescued.
            readyForDestruction.set(childId, parentId);
          }
        }
        pendingRemovals.clear();
        rescuedRemovals.clear();
      }

      for (const item of pending) {
        if (item.type === "batch") {
          // Coalesce generic batches into the accumulator
          batchAccumulator.push(item.op);
        } else if (item.type === "batchGroup") {
          // If the meta is the same as current, we can coalesce.
          // Otherwise flush what we have and start a new group.
          const isSameMeta =
            currentMeta &&
            currentMeta.kind === item.meta.kind &&
            currentMeta.scope === item.meta.scope;

          if (currentMeta && !isSameMeta) {
            flushAccumulator();
          }

          if (!currentMeta) {
            currentMeta = item.meta;
          }
          batchAccumulator.push(...item.ops);
        } else {
          flushAccumulator();
          item.func();
        }
      }

      if (pendingDrops.size) {
        for (const nodeId of pendingDrops) {
          batchAccumulator.push({ type: "dropNode", nodeId });
        }
        pendingDrops.clear();
      }

      flushAccumulator();
      if (sentAnyOps) {
        ui.flush();
      }
    } catch (e) {
      console.error("Flush error:", {
        error: formatFlushError(e),
        queueLength: queue.length,
        pendingRemovals: pendingRemovals.size,
        readyForDestruction: readyForDestruction.size,
        pendingDrops: pendingDrops.size,
        rescuedRemovals: rescuedRemovals.size,
      });
      throw e;
    }
  };

  const schedule = () => {
    if (flushScheduled || batchStack.length > 0) return;
    flushScheduled = true;

    // Use requestAnimationFrame to ensure all SolidJS reactive updates,
    // effects, and microtasks have settled before a single atomic native flush.
    requestAnimationFrame(() => {
      if (!flushScheduled) return;
      if (isNativeBatching || isSuppressed()) return;
      runFlush();
    });
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

  const applyTextInputInitialProps = (id: number, props: any) => {
    if (!props) return;

    const assign = (key: string, value: unknown) => {
      if (value !== undefined) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: key,
          value,
        };
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

    if (props.handler) {
      const handler = props.handler;
      if (
        typeof handler === "function" &&
        (handler as any).__zynth_worklet_id !== undefined
      ) {
        assign("handler", (handler as any).__zynth_worklet_id);
      }
    }

    const events: Record<string, Function | undefined> = {
      onChange: props.onChange,
      onChangeText: props.onChangeText,
      onSelectionChange: props.onSelectionChange,
      onSubmitEditing: props.onKeyPress,
      onFocus: props.onFocus,
      onBlur: props.onBlur,
      onCompositionStart: props.onCompositionStart,
      onCompositionEnd: props.onCompositionEnd,
    };

    for (const [name, handler] of Object.entries(events)) {
      if (typeof handler === "function") {
        maybeCallNativeHandler(id, name, handler);
      }
    }
  };

  const isMarkerId = (id: number) => id < 0;
  const typeFor = (id: number): HostNode["type"] =>
    TYPES.get(id) ?? (isMarkerId(id) ? "marker" : "view");

  const nodeFor = (id: number): HostNode => ({ id, type: typeFor(id) });

  const resetNodeToDefault = (nodeId: number, type: HostNode["type"]) => {
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
        const hasMeasureFunc =
          type === "text" ||
          type === "text-input" ||
          type === "secure-text-input" ||
          type === "text-field" ||
          type === "switch-view" ||
          type === "slider-view";
        id = ui.createNode(type, hasMeasureFunc);
      }
      const node = { id, type } as HostNode;
      if (registry && !recycled) registry.register(node, id);
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TYPES.set(id, type);
      if (props?.__zynthExiting && typeof props.__zynthExiting === "object") {
        exitTransitions.set(
          id,
          props.__zynthExiting as Omit<
            NativeTransitionConfig,
            "nodeId" | "animationId" | "phase"
          >
        );
      }
      if (props?.style) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "style",
          value: props.style as Style,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (type === "text") {
        const textValue =
          props && "text" in props && props.text != null
            ? String(props.text)
            : "";
        TEXTS.set(id, textValue);
        const op: BatchOperation = {
          type: "setText",
          nodeId: id,
          value: textValue,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (typeof props?.onPress === "function") {
        maybeCallNativeHandler(id!, "onPress", props.onPress);
      }
      if (typeof props?.onLayout === "function") {
        maybeCallNativeHandler(id!, "onLayout", props.onLayout);
      }
      if (props?.accessibilityLabel) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityLabel",
          value: props.accessibilityLabel,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (props?.accessibilityHint) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityHint",
          value: props.accessibilityHint,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (props?.accessibilityRole) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "accessibilityRole",
          value: props.accessibilityRole,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (props?.pointerEvents) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "pointerEvents",
          value: props.pointerEvents,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (props?.testID) {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: id,
          name: "testID",
          value: props.testID,
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      }
      if (type === "text-input" || type === "secure-text-input") {
        applyTextInputInitialProps(id, props);
      }
      if (!inBatch) schedule();
      return { id, type } as HostNode;
    },
    createText(value) {
      const id: number = ui.createNode("text");
      const setTextOp: BatchOperation = {
        type: "setText",
        nodeId: id,
        value: value ?? "",
      };
      if (!tryEnqueueBatch(setTextOp)) enqueueBatchOp(setTextOp);
      PARENTS.set(id, null);
      CHILDREN.set(id, []);
      TEXTS.set(id, value ?? "");
      TYPES.set(id, "text");
      if (!currentBatch()) schedule();
      return { id, type: "text" };
    },
    setProperty(node, name, value) {
      if (value === undefined && name !== "style") return;
      if (name === "text") {
        TEXTS.set(node.id, value == null ? "" : String(value));
        const op: BatchOperation = {
          type: "setText",
          nodeId: node.id,
          value: value == null ? "" : String(value),
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
        schedule();
        return;
      }
      if (name === "__zynthExiting") {
        if (value && typeof value === "object") {
          exitTransitions.set(
            node.id,
            value as Omit<
              NativeTransitionConfig,
              "nodeId" | "animationId" | "phase"
            >
          );
        } else {
          exitTransitions.delete(node.id);
        }
        return;
      }
      if (name === "style") {
        const op: BatchOperation = {
          type: "setProp",
          nodeId: node.id,
          name: "style",
          value: value || {},
        };
        if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
        schedule();
        return;
      }
      if (name === "controller") return;
      if (name === "handler") {
        if (
          typeof value === "function" &&
          (value as any).__zynth_worklet_id !== undefined
        ) {
          const workletId = (value as any).__zynth_worklet_id;
          const op: BatchOperation = {
            type: "setProp",
            nodeId: node.id,
            name: "handler",
            value: workletId,
          };
          if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
          schedule();
          return;
        }
        if (typeof value === "function") {
          maybeCallNativeHandler(node.id, name, value);
          schedule();
          return;
        }
        if (value == null) {
          const op: BatchOperation = {
            type: "setProp",
            nodeId: node.id,
            name: "handler",
            value: 0,
          };
          if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
          schedule();
        }
        return;
      }
      if (typeof value === "function") {
        maybeCallNativeHandler(node.id, name, value);
        schedule();
        return;
      }
      const op: BatchOperation = {
        type: "setProp",
        nodeId: node.id,
        name,
        value,
      };
      if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
      schedule();
    },
    setText(node, value) {
      TEXTS.set(node.id, value ?? "");
      const op: BatchOperation = {
        type: "setText",
        nodeId: node.id,
        value: value ?? "",
      };
      if (!tryEnqueueBatch(op)) enqueueBatchOp(op);
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

      if (batchStack.length === 0) {
        if ((globalThis as any).__ZYNTH_HMR_DEBUG) {
          console.log("[HOST-ANDROID] beginBatch: flushing pending before start");
        }
        runFlush();
      }

      if ((globalThis as any).__ZYNTH_HMR_DEBUG) {
        console.log("[HOST-ANDROID] beginBatch", { kind, scope: normalizedMeta.scope });
      }
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
      if ((globalThis as any).__ZYNTH_HMR_DEBUG) {
        console.log("[HOST-ANDROID] endBatch", { 
          kind: context.meta.kind, 
          ops: context.operations.length, 
        });
      }
      if (batchStack.length) {
        batchStack[batchStack.length - 1].operations.push(
          ...context.operations
        );
        return;
      }
      if (context.operations.length > 0) {
        queue.push({
          type: "batchGroup",
          meta: context.meta,
          ops: context.operations,
        });
      }
      // If syncFrame is requested, flush immediately to avoid flickering
      if (context.meta.extras?.syncFrame) {
        if ((globalThis as any).__ZYNTH_HMR_DEBUG) {
          console.log("[HOST-ANDROID] endBatch: syncFrame requested, flushing now");
        }
        runFlush();
      } else {
        schedule();
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
      const containerChildren = CHILDREN.get(containerId) || [];
      for (const childId of containerChildren) {
        if (isMarkerId(childId)) continue;
        const childType = TYPES.get(childId);
        if (childType === config.itemType)
          NODE_TO_CONTEXT.set(childId, contextId);
      }
      return contextId;
    },
    disableRecycling(contextId: string) {
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;
      for (const [nodeId] of context.activeBindings)
        returnNodeToPool(contextId, nodeId);
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
      if (!RECYCLING_CONTEXTS.has(contextId)) return;
      returnNodeToPool(contextId, node.id);
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
      if (nodeId !== null) {
        context.activeBindings.set(nodeId, { itemKey, itemIndex });
        return nodeFor(nodeId);
      }
      const currentActiveCount = context.activeBindings.size;
      if (currentActiveCount >= context.config.poolSize) return null;
      if (type === "root") return null;
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
      if (!contextId) return;
      const context = RECYCLING_CONTEXTS.get(contextId);
      if (!context) return;
      context.activeBindings.set(node.id, { itemKey, itemIndex });
      if (props.style !== undefined) {
        enqueueBatchOp({
          type: "setProp",
          nodeId: node.id,
          name: "style",
          value: props.style || {},
        });
      }
      for (const [key, value] of Object.entries(props)) {
        if (key === "style") continue;
        if (typeof value === "function") {
          maybeCallNativeHandler(node.id, key, value);
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
