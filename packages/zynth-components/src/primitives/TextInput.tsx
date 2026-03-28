import type { Component } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import type { HostNode, Style, SyncSignalAccessor } from "@zynth/core";
import { createWorklet, setProperty, flush } from "@zynth/core";
import type { KeyEvent } from "./events";
export type { KeyEvent } from "./events";

export type Selection = { start: number; end: number };

export type TextChangeEvent = {
  range: Selection;
  inserted: string;
  removed: string;
  textAfter: string;
  composing: boolean;
};

export type TextInputRef = {
  text: () => string;
  setText: (value: string) => void;
  selection: () => Selection;
  setSelection: (sel: Selection) => void;
  isEditing: () => boolean;
  isComposing: () => boolean;
  hasPendingSync: () => boolean;
  focus: () => void;
  blur: () => void;
  clear: () => void;
  insertAtCursor: (text: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  commit: () => void;
  cancelPending: () => void;
  driveFromValue?: boolean;
  /** @internal bridge for the primitive */
  __attachInternal?: (ops: TextInputRefBridge) => void;
  /** @internal helpers set from native events */
  __setTextFromNative?: (value: string) => void;
  __setSelectionFromNative?: (sel: Selection) => void;
};

type TextInputRefBridge = {
  notifyNativeValue: (value: string) => void;
  notifyNativeSelection: (sel: Selection) => void;
  notifyEditing: (value: boolean) => void;
  notifyComposing: (value: boolean) => void;
};

export function useTextInputRef(opts?: {
  value?: string | SyncSignalAccessor<string>;
  driveFromValue?: boolean;
}): TextInputRef {
  const initialValue =
    typeof opts?.value === "function" ? opts.value() : (opts?.value ?? "");
  const [text, setText] = createSignal(initialValue);
  const [selection, setSelection] = createSignal<Selection>({
    start: 0,
    end: 0,
  });
  const [isEditing, setIsEditing] = createSignal(false);
  const [isComposing, setIsComposing] = createSignal(false);
  const [hasPending, setHasPending] = createSignal(false);

  let bridge: TextInputRefBridge | undefined;

  const controller: TextInputRef & {
    __setEditing?: (value: boolean) => void;
    __setComposing?: (value: boolean) => void;
    __setTextFromNative?: (value: string) => void;
    __setSelectionFromNative?: (sel: Selection) => void;
  } = {
    text,
    setText(value) {
      setText(value);
      bridge?.notifyNativeValue(value);
    },
    selection,
    setSelection(sel) {
      setSelection(sel);
      bridge?.notifyNativeSelection(sel);
    },
    isEditing,
    isComposing,
    hasPendingSync: hasPending,
    focus() {
      console.warn("[zynth] TextInputRef.focus is not hooked to native yet");
    },
    blur() {
      console.warn("[zynth] TextInputRef.blur is not hooked to native yet");
    },
    clear() {
      controller.setText("");
      controller.setSelection({ start: 0, end: 0 });
    },
    insertAtCursor(fragment: string) {
      const sel = selection();
      const current = text();
      const next = `${current.slice(0, sel.start)}${fragment}${current.slice(
        sel.end,
      )}`;
      controller.setText(next);
      const cursor = sel.start + fragment.length;
      controller.setSelection({ start: cursor, end: cursor });
      setHasPending(true);
    },
    replaceRange(start, end, fragment) {
      const current = text();
      const safeStart = Math.max(0, Math.min(start, current.length));
      const safeEnd = Math.max(safeStart, Math.min(end, current.length));
      const next = `${current.slice(0, safeStart)}${fragment}${current.slice(
        safeEnd,
      )}`;
      controller.setText(next);
      const cursor = safeStart + fragment.length;
      controller.setSelection({ start: cursor, end: cursor });
      setHasPending(true);
    },
    commit() {
      setHasPending(false);
    },
    cancelPending() {
      setHasPending(false);
    },
    driveFromValue: opts?.driveFromValue ?? false,
    __attachInternal(ops) {
      bridge = ops;
    },
    __setEditing(value: boolean) {
      setIsEditing(value);
    },
    __setComposing(value: boolean) {
      setIsComposing(value);
    },
    __setTextFromNative(value: string) {
      setText(value);
    },
    __setSelectionFromNative(sel: Selection) {
      setSelection(sel);
    },
  };

  return controller;
}

export type InputMode =
  | "text"
  | "numeric"
  | "decimal"
  | "tel"
  | "email"
  | "url"
  | "search";

export type ReturnKey = "default" | "go" | "next" | "search" | "send" | "done";

export type ClearButtonMode =
  | "never"
  | "while-editing"
  | "unless-editing"
  | "always";

export interface TextInputProps {
  value?: string | SyncSignalAccessor<string>;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  editable?: boolean;
  secureTextEntry?: boolean;
  inputMode?: InputMode;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  spellCheck?: boolean;
  returnKeyType?: ReturnKey;
  blurOnSubmit?: boolean;
  submitBehavior?: "newline" | "submit" | "none";
  selection?: Selection;
  selectionColor?: string;
  caretColor?: string;
  placeholderTextColor?: string;
  clearButtonMode?: ClearButtonMode;
  showClearAccessory?: boolean;
  inputFilter?: (proposed: string, change: Selection) => string | false;
  handler?: (currentText: string, newInput: string) => string;
  onChangeText?: (text: string) => void;
  onChange?: (event: TextChangeEvent) => void;
  onSelectionChange?: (selection: Selection) => void;
  onContentSizeChange?: (width: number, height: number) => void;
  onSubmitEditing?: (text: string) => void;
  onKeyPress?: (event: KeyEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  selectTextOnFocus?: boolean;
  eventThrottleMs?: number;
  allowProgrammaticJumpDuringEdit?: boolean;
  ref?: (node: (HostNode & TextInputRef) | null) => void;
  style?: Style;
  testID?: string;
}

const noopInputHandlerWorklet = createWorklet(((
  _currentText: unknown,
  _newInput: unknown,
) => {
  "worklet";
  return undefined;
}) as (...args: unknown[]) => unknown);

type NativeTextChangeEvent = TextChangeEvent & { target: number };
type NativeTextPayload = { text: string };
type NativeSelectionEvent = { selection: Selection };
type NativeKeyEvent = KeyEvent;

type SyncSignalCarrier = {
  __zynth_sync_signal_id?: number;
};

function readSyncSignalId(value: unknown): number | undefined {
  if (!value || typeof value !== "function") return undefined;
  const maybeSignal = value as SyncSignalCarrier;
  return typeof maybeSignal.__zynth_sync_signal_id === "number"
    ? maybeSignal.__zynth_sync_signal_id
    : undefined;
}

function bindRuntimeSyncSignalNode(signalId: number, nodeId: number): void {
  const globalObj = globalThis as {
    __zynth_bindSyncSignalNode?: (
      syncSignalId: number,
      hostNodeId: number,
    ) => void;
  };
  globalObj.__zynth_bindSyncSignalNode?.(signalId, nodeId);
}

function unbindRuntimeSyncSignalNode(signalId: number, nodeId: number): void {
  const globalObj = globalThis as {
    __zynth_unbindSyncSignalNode?: (
      syncSignalId: number,
      hostNodeId: number,
    ) => void;
  };
  globalObj.__zynth_unbindSyncSignalNode?.(signalId, nodeId);
}

function deriveInputDelta(previousText: string, nextText: string): string {
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }
  if (previousText.startsWith(nextText)) {
    return "";
  }
  return nextText;
}

function remapCursorThroughTransformation(
  sourceText: string,
  transformedText: string,
  sourceCursor: number,
): number {
  const safeCursor = Math.max(0, Math.min(sourceCursor, sourceText.length));
  if (sourceText === transformedText) return safeCursor;

  let prefix = 0;
  const prefixLimit = Math.min(sourceText.length, transformedText.length);
  while (
    prefix < prefixLimit &&
    sourceText.charCodeAt(prefix) === transformedText.charCodeAt(prefix)
  ) {
    prefix += 1;
  }

  let suffix = 0;
  const sourceRemaining = sourceText.length - prefix;
  const transformedRemaining = transformedText.length - prefix;
  const suffixLimit = Math.min(sourceRemaining, transformedRemaining);
  while (
    suffix < suffixLimit &&
    sourceText.charCodeAt(sourceText.length - 1 - suffix) ===
      transformedText.charCodeAt(transformedText.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  if (safeCursor <= prefix) return safeCursor;

  const sourceSuffixStart = sourceText.length - suffix;
  if (safeCursor >= sourceSuffixStart) {
    const offsetIntoSuffix = sourceText.length - safeCursor;
    return Math.max(0, transformedText.length - offsetIntoSuffix);
  }

  return prefix + (transformedText.length - prefix - suffix);
}

function isSyncSignal(value: unknown): value is SyncSignalAccessor<string> {
  return (
    typeof value === "function" &&
    (value as any).__zynth_sync_signal_id !== undefined
  );
}

export const TextInput: Component<TextInputProps> = (props) => {
  const controller = useTextInputRef({
    value: props.value ?? props.defaultValue,
    driveFromValue: props.value !== undefined,
  }) as TextInputRef & {
    __setEditing?: (value: boolean) => void;
    __setComposing?: (value: boolean) => void;
    __setTextFromNative?: (value: string) => void;
    __setSelectionFromNative?: (sel: Selection) => void;
  };
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  let defaultAppliedNodeId: number | null = null;
  let initialSyncValueSet = false;
  onCleanup(() => props.ref?.(null));

  const isPotentiallySecure = createMemo(
    () => props.secureTextEntry !== undefined,
  );
  const syncSignalId = createMemo(() => readSyncSignalId(props.value));

  // createEffect(() => {
  //   if (isPotentiallySecure() && props.multiline) {
  //     console.warn(
  //       "[Zynth] The `secureTextEntry` prop is not compatible with `multiline`. `multiline` will be ignored."
  //     );
  //   }
  // });

  const handleChange = (event: NativeTextChangeEvent) => {
    props.onChange?.(event);
    if (typeof event.textAfter === "string") {
      controller.__setTextFromNative?.(event.textAfter);
    }
    if (event.range) {
      const insertedLength = event.inserted?.length ?? 0;
      const removedLength = event.removed?.length ?? 0;

      let nextStart: number;

      // Enhanced autocorrect detection
      const looksLikeAutoCorrect =
        removedLength > 0 &&
        insertedLength > 0 &&
        // Same length replacement
        removedLength === insertedLength &&
        // Different text (autocorrect changes the word)
        event.removed !== event.inserted &&
        // Check if the change is at a word boundary (common for autocorrect)
        (event.range.start === 0 ||
          /\s/.test(event.textAfter.charAt(event.range.start - 1)));

      if (looksLikeAutoCorrect) {
        // For autocorrect, maintain the cursor at the end of the corrected word
        nextStart = event.range.start + insertedLength;
      } else if (insertedLength > 0 && removedLength === 0) {
        // Pure insertion
        nextStart = event.range.start + insertedLength;
      } else if (removedLength > 0 && insertedLength === 0) {
        // Pure deletion
        nextStart = event.range.start;
      } else {
        // Default case
        nextStart = event.range.start + insertedLength;
      }

      const nextSelection: Selection = {
        start: nextStart,
        end: nextStart,
      };
      controller.__setSelectionFromNative?.(nextSelection);
    }
    controller.__setComposing?.(event.composing);
  };

  const handleChangeText = (payload: NativeTextPayload) => {
    if (typeof payload?.text === "string") {
      const incomingText = payload.text;
      const previousText = controller.text();

      if (typeof props.handler === "function") {
        const delta = deriveInputDelta(previousText, incomingText);
        const transformedText = props.handler(previousText, delta);
        const resolvedText =
          typeof transformedText === "string" ? transformedText : incomingText;

        if (resolvedText !== incomingText) {
          const node = hostNode();
          const incomingSelection = controller.selection();
          const incomingCursor =
            typeof incomingSelection?.end === "number"
              ? incomingSelection.end
              : incomingText.length;
          const remappedCursor = remapCursorThroughTransformation(
            incomingText,
            resolvedText,
            incomingCursor,
          );
          const nextSelection: Selection = {
            start: remappedCursor,
            end: remappedCursor,
          };
          if (node) {
            setProperty(node, "value", resolvedText);
            setProperty(node, "selection", nextSelection);
          }
          controller.__setSelectionFromNative?.(nextSelection);
        }

        props.onChangeText?.(resolvedText);
        controller.__setTextFromNative?.(resolvedText);
      } else {
        props.onChangeText?.(incomingText);
        controller.__setTextFromNative?.(incomingText);

        // Ensure cursor is at the end of the text after autocorrect
        // This is a fallback in case the cursor positioning in handleChange is incorrect
        const currentSelection = controller.selection();
        if (currentSelection.start === currentSelection.end) {
          // If cursor is collapsed, ensure it's at a valid position
          const textLength = incomingText.length;
          if (currentSelection.start > textLength) {
            controller.__setSelectionFromNative?.({
              start: textLength,
              end: textLength,
            });
          }
        }
      }
    }
    controller.__setComposing?.(false);
  };

  const handleSelectionChange = (payload: NativeSelectionEvent) => {
    const sel = payload?.selection;
    if (!sel) return;
    props.onSelectionChange?.(sel);
    controller.__setSelectionFromNative?.(sel);
  };

  const handleFocus = () => {
    props.onFocus?.();
    controller.__setEditing?.(true);
  };

  const handleBlur = () => {
    props.onBlur?.();
    controller.__setEditing?.(false);
  };

  const handleSubmit = (payload: NativeTextPayload) => {
    props.onSubmitEditing?.(payload.text);
  };

  const handleKeyPress = (event: NativeKeyEvent) => {
    props.onKeyPress?.(event);
  };

  const handleCompositionStart = () => {
    props.onCompositionStart?.();
    controller.__setComposing?.(true);
  };
  const handleCompositionEnd = () => {
    props.onCompositionEnd?.();
    controller.__setComposing?.(false);
  };

  createEffect(() => {
    const node = hostNode();
    if (!node || !controller.__attachInternal) return;

    const nodeId = (node as any)?.id;
    // console.log("[TextInput] attach controller bridge", { nodeId });
    const bridge: TextInputRefBridge = {
      notifyNativeValue(value) {
        // console.log("[TextInput] bridge notifyNativeValue", { nodeId, value });
        setProperty(node, "value", value);
      },
      notifyNativeSelection(sel) {
        // console.log("[TextInput] bridge notifyNativeSelection", {
        //   nodeId,
        //   selection: sel,
        // });
        setProperty(node, "selection", sel);
      },
      notifyEditing() {
        /* editing state is tracked in JS */
      },
      notifyComposing() {
        /* composition state is tracked in JS */
      },
    };

    controller.__attachInternal(bridge);
  });

  createEffect(() => {
    const node = hostNode();
    const signalId = syncSignalId();
    if (!node || typeof signalId !== "number") return;

    bindRuntimeSyncSignalNode(signalId, node.id);
    onCleanup(() => {
      unbindRuntimeSyncSignalNode(signalId, node.id);
    });
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    const nodeId = (node as any)?.id as number | undefined;
    const normalizedNodeId =
      typeof nodeId === "number" ? nodeId : defaultAppliedNodeId;
    const controlledValue =
      typeof props.value === "function" ? props.value() : props.value;

    if (controlledValue !== undefined) {
      // If the value is a SyncSignal, we skip the bridge update effect.
      // The native view now updates the sync buffer directly, and we don't want
      // JS to push the same value back down, which triggers IME/cursor jumps.
      if (typeof props.value === "function" && (props.value as any).__zynth_sync_signal_id) {
        return;
      }

      // console.log("[TextInput] controlled value update", { nodeId, value: controlledValue });
      setProperty(node, "value", controlledValue);
      defaultAppliedNodeId = normalizedNodeId ?? null;
      return;
    }

    const initialValue = props.defaultValue;
    if (
      initialValue !== undefined &&
      defaultAppliedNodeId !== normalizedNodeId
    ) {
      // Ensure uncontrolled inputs get their initial text on mount.
      setProperty(node, "value", initialValue);
      defaultAppliedNodeId = normalizedNodeId ?? null;
    }
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    const nodeId = (node as any)?.id;

    // console.log("[TextInput] updating static props", { nodeId });
    setProperty(
      node,
      "multiline",
      isPotentiallySecure() ? false : (props.multiline ?? false),
    );
    setProperty(node, "onChange", handleChange);
    setProperty(node, "onChangeText", handleChangeText);
    setProperty(node, "onSelectionChange", handleSelectionChange);
    setProperty(node, "onSubmitEditing", handleSubmit);
    setProperty(node, "onKeyPress", handleKeyPress);
    setProperty(node, "onFocus", handleFocus);
    setProperty(node, "onBlur", handleBlur);
    setProperty(node, "onCompositionStart", handleCompositionStart);
    setProperty(node, "onCompositionEnd", handleCompositionEnd);
    setProperty(node, "handler", props.handler ?? noopInputHandlerWorklet);

    const derivedSubmitBehavior =
      props.submitBehavior ?? (props.multiline ? "newline" : undefined);

    const optionalEntries: [string, unknown][] = [
      ["style", props.style as any],
      ["defaultValue", props.defaultValue],
      ["placeholder", props.placeholder],
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
      ["submitBehavior", derivedSubmitBehavior],
      ["selection", props.selection],
      ["selectionColor", props.selectionColor],
      ["caretColor", props.caretColor],
      ["placeholderTextColor", props.placeholderTextColor],
      ["clearButtonMode", props.clearButtonMode],
      ["showClearAccessory", props.showClearAccessory],
      ["eventThrottleMs", props.eventThrottleMs],
      ["selectTextOnFocus", props.selectTextOnFocus],
      [
        "allowProgrammaticJumpDuringEdit",
        props.allowProgrammaticJumpDuringEdit,
      ],
      ["testID", props.testID],
    ];

    for (const [name, value] of optionalEntries) {
      if (value !== undefined) {
        // Don't pass multiline to secure text input
        if (isPotentiallySecure() && name === "multiline") continue;
        if (isPotentiallySecure() && name === "numberOfLines") continue;

        // console.log(
        //   "[TextInput] set optional prop",
        //   JSON.stringify({ nodeId, name, value })
        // );
        setProperty(node, name, value);
      }
    }
  });

  return (
    <Show
      when={isPotentiallySecure()}
      fallback={
        <text-input
          ref={(node: (HostNode & TextInputRef) | null) =>
            (() => {
              const host = node as HostNode | null;
              setHostNode(host);
              if (!host) {
                props.ref?.(null);
                return;
              }
              const imperativeNode = host as HostNode & TextInputRef;
              imperativeNode.text = controller.text;
              imperativeNode.setText = controller.setText;
              imperativeNode.selection = controller.selection;
              imperativeNode.setSelection = controller.setSelection;
              imperativeNode.isEditing = controller.isEditing;
              imperativeNode.isComposing = controller.isComposing;
              imperativeNode.hasPendingSync = controller.hasPendingSync;
              imperativeNode.focus = () => {
                setProperty(host, "requestFocus", true);
                flush();
              };
              imperativeNode.blur = () => {
                setProperty(host, "requestBlur", true);
                flush();
              };
              imperativeNode.clear = controller.clear;
              imperativeNode.insertAtCursor = controller.insertAtCursor;
              imperativeNode.replaceRange = controller.replaceRange;
              imperativeNode.commit = controller.commit;
              imperativeNode.cancelPending = controller.cancelPending;
              imperativeNode.driveFromValue = controller.driveFromValue;
              props.ref?.(imperativeNode);
            })()
          }
        />
      }
    >
      <secure-text-input
        ref={(node: (HostNode & TextInputRef) | null) =>
          (() => {
            const host = node as HostNode | null;
            setHostNode(host);
            if (!host) {
              props.ref?.(null);
              return;
            }
            const imperativeNode = host as HostNode & TextInputRef;
            imperativeNode.text = controller.text;
            imperativeNode.setText = controller.setText;
            imperativeNode.selection = controller.selection;
            imperativeNode.setSelection = controller.setSelection;
            imperativeNode.isEditing = controller.isEditing;
            imperativeNode.isComposing = controller.isComposing;
            imperativeNode.hasPendingSync = controller.hasPendingSync;
            imperativeNode.focus = () => {
              setProperty(host, "requestFocus", true);
              flush();
            };
            imperativeNode.blur = () => {
              setProperty(host, "requestBlur", true);
              flush();
            };
            imperativeNode.clear = controller.clear;
            imperativeNode.insertAtCursor = controller.insertAtCursor;
            imperativeNode.replaceRange = controller.replaceRange;
            imperativeNode.commit = controller.commit;
            imperativeNode.cancelPending = controller.cancelPending;
            imperativeNode.driveFromValue = controller.driveFromValue;
            props.ref?.(imperativeNode);
          })()
        }
      />
    </Show>
  );
};
