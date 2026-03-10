import type { Component } from "solid-js";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import { setProperty } from "@zynth/core";
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
  value?: string;
  driveFromValue?: boolean;
}): TextInputRef {
  const [text, setText] = createSignal(opts?.value ?? "");
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
        sel.end
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
        safeEnd
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
  value?: string;
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
  eventThrottleMs?: number;
  allowProgrammaticJumpDuringEdit?: boolean;
  ref?: (node: (HostNode & TextInputRef) | null) => void;
  style?: Style;
  testID?: string;
}

type NativeTextChangeEvent = TextChangeEvent & { target: number };
type NativeTextPayload = { text: string };
type NativeSelectionEvent = { selection: Selection };
type NativeKeyEvent = KeyEvent;

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
  onCleanup(() => props.ref?.(null));

  const isPotentiallySecure = createMemo(
    () => props.secureTextEntry !== undefined
  );

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
      const nextStart = event.range.start + insertedLength;
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
      props.onChangeText?.(payload.text);
      controller.__setTextFromNative?.(payload.text);
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
    if (!node) return;
    const nodeId = (node as any)?.id as number | undefined;
    const normalizedNodeId =
      typeof nodeId === "number" ? nodeId : defaultAppliedNodeId;
    const controlledValue = props.value;

    if (controlledValue !== undefined) {
      // console.log("[TextInput] controlled value update", { nodeId, value: controlledValue });
      setProperty(node, "value", controlledValue);
      defaultAppliedNodeId = normalizedNodeId ?? null;
      return;
    }

    const initialValue = props.defaultValue;
    if (initialValue !== undefined && defaultAppliedNodeId !== normalizedNodeId) {
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
      isPotentiallySecure() ? false : props.multiline ?? false
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
              imperativeNode.focus = () => setProperty(host, "requestFocus", true);
              imperativeNode.blur = () => setProperty(host, "requestBlur", true);
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
            imperativeNode.focus = () => setProperty(host, "requestFocus", true);
            imperativeNode.blur = () => setProperty(host, "requestBlur", true);
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
