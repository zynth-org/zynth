import { createSignal, untrack } from "solid-js";
import type { HostNode } from "@zynthjs/core";
import { setProperty } from "@zynthjs/core";

export type PressableRef = {
  pressed: () => boolean;
  hovered: () => boolean;
  focused: () => boolean;
  disabled: () => boolean;
  longPressActive: () => boolean;
  focus: () => void;
  blur: () => void;
  click: () => void;
  cancel: () => void;
  setDisabled: (value: boolean) => void;
};

export type InternalPressableController = PressableRef & {
  __attachHost?: (node: HostNode | null) => void;
  __applyState?: (partial: {
    pressed?: boolean;
    hovered?: boolean;
    focused?: boolean;
    disabled?: boolean;
    longPressActive?: boolean;
  }) => void;
  __syncDisabled?: (value: boolean) => void;
};

type PressableCommand =
  | { type: "focus" }
  | { type: "blur" }
  | { type: "click" }
  | { type: "cancel" };

export function createPressableRef(opts?: {
  disabled?: boolean;
}): PressableRef {
  const [pressed, setPressed] = createSignal(false, { ownedWrite: true });
  const [hovered, setHovered] = createSignal(false, { ownedWrite: true });
  const [focused, setFocused] = createSignal(false, { ownedWrite: true });
  const [disabled, setDisabledState] = createSignal(opts?.disabled ?? false, { ownedWrite: true });
  const [longPressActive, setLongPressActive] = createSignal(false, { ownedWrite: true });

  let host: HostNode | null = null;
  let commandSeq = 0;

  const issueCommand = (command: PressableCommand) => {
    if (!host) return;
    commandSeq += 1;
    setProperty(host, "__pressableCommand", { seq: commandSeq, ...command });
  };

  const controller: InternalPressableController = {
    pressed,
    hovered,
    focused,
    disabled,
    longPressActive,
    focus() {
      issueCommand({ type: "focus" });
    },
    blur() {
      issueCommand({ type: "blur" });
    },
    click() {
      issueCommand({ type: "click" });
    },
    cancel() {
      issueCommand({ type: "cancel" });
    },
    setDisabled(value) {
      setDisabledState(value);
    },
  };

  controller.__attachHost = (node) => {
    host = node;
  };

  controller.__applyState = (partial) => {
    if (partial.pressed !== undefined) setPressed(partial.pressed);
    if (partial.hovered !== undefined) setHovered(partial.hovered);
    if (partial.focused !== undefined) setFocused(partial.focused);
    if (partial.disabled !== undefined) setDisabledState(partial.disabled);
    if (partial.longPressActive !== undefined)
      setLongPressActive(partial.longPressActive);
  };

  controller.__syncDisabled = (value) => {
    if (untrack(disabled) !== value) {
      untrack(() => setDisabledState(value));
    }
  };

  return controller;
}
