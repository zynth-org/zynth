import {
  splitProps,
  createSignal,
  createEffect,
  type Component,
} from "solid-js";
import type { HostNode, Style } from "@rune/core";
import { setProperty } from "@rune/core";

export type KeyboardType = "default" | "numeric" | "email" | "phone" | "url";
export type ReturnKeyType = "done" | "go" | "next" | "search" | "send";
export type AutoCapitalize = "none" | "sentences" | "words" | "characters";

export interface TextFieldController {
  /** Get the current text value */
  text: () => string;
  /** Set the text value programmatically */
  setText: (value: string) => void;
  /** Focus the text field */
  focus: () => void;
  /** Blur (unfocus) the text field */
  blur: () => void;
  /** Clear the text field */
  clear: () => void;
  /** Whether the text field is currently focused */
  isFocused: () => boolean;
  /** @internal bridge for the primitive */
  __attachInternal?: (ops: TextFieldBridge) => void;
  /** @internal set text from native events */
  __setTextFromNative?: (value: string) => void;
  /** @internal set focus state from native events */
  __setFocusedFromNative?: (value: boolean) => void;
}

type TextFieldBridge = {
  notifyNativeValue: (value: string) => void;
  notifyFocus: () => void;
  notifyBlur: () => void;
};

export function useTextFieldController(opts?: {
  value?: string;
}): TextFieldController {
  const [text, setText] = createSignal(opts?.value ?? "");
  const [isFocused, setIsFocused] = createSignal(false);

  let bridge: TextFieldBridge | undefined;

  const controller: TextFieldController = {
    text,
    setText(value) {
      setText(value);
      bridge?.notifyNativeValue(value);
    },
    focus() {
      bridge?.notifyFocus();
    },
    blur() {
      bridge?.notifyBlur();
    },
    clear() {
      controller.setText("");
    },
    isFocused,
    __attachInternal(ops) {
      bridge = ops;
    },
    __setTextFromNative(value: string) {
      setText(value);
    },
    __setFocusedFromNative(value: boolean) {
      setIsFocused(value);
    },
  };

  return controller;
}

export interface TextFieldProps {
  /** Controlled text value */
  value?: string;
  /** Initial text value (uncontrolled) */
  defaultValue?: string;
  /** Placeholder text (used as label on Material 3, placeholder on iOS) */
  placeholder?: string;
  /** Whether the text field is disabled */
  disabled?: boolean;
  /** Whether the text field is editable (default: true) */
  editable?: boolean;
  /** Whether to hide text for passwords */
  secureTextEntry?: boolean;
  /** Keyboard type to display */
  keyboardType?: KeyboardType;
  /** Return key type */
  returnKeyType?: ReturnKeyType;
  /** Auto-capitalization behavior */
  autoCapitalize?: AutoCapitalize;
  /** Whether to enable auto-correct (default: true) */
  autoCorrect?: boolean;
  /** Maximum number of characters allowed */
  maxLength?: number;

  // Events
  /** Called when the text changes */
  onChange?: (event: { value: string }) => void;
  /** Called when the text field gains focus */
  onFocus?: () => void;
  /** Called when the text field loses focus */
  onBlur?: () => void;
  /** Called when the return/submit key is pressed */
  onSubmit?: (event: { value: string }) => void;

  /** Controller for imperative control */
  controller?: TextFieldController;

  /** Style props */
  style?: Style;
  /** Test ID for testing frameworks */
  testID?: string;
}

type TextFieldEvent<T> = {
  target: number;
} & T;

export const TextField: Component<TextFieldProps> = (props) => {
  const [local] = splitProps(props, [
    "value",
    "defaultValue",
    "placeholder",
    "disabled",
    "editable",
    "secureTextEntry",
    "keyboardType",
    "returnKeyType",
    "autoCapitalize",
    "autoCorrect",
    "maxLength",
    "onChange",
    "onFocus",
    "onBlur",
    "onSubmit",
    "controller",
    "style",
    "testID",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  // Handle text change from native
  const handleChange = (event: TextFieldEvent<{ value: string }>) => {
    local.controller?.__setTextFromNative?.(event.value);
    local.onChange?.({ value: event.value });
  };

  // Handle focus from native
  const handleFocus = () => {
    local.controller?.__setFocusedFromNative?.(true);
    local.onFocus?.();
  };

  // Handle blur from native
  const handleBlur = () => {
    local.controller?.__setFocusedFromNative?.(false);
    local.onBlur?.();
  };

  // Handle submit from native
  const handleSubmit = (event: TextFieldEvent<{ value: string }>) => {
    local.onSubmit?.({ value: event.value });
  };

  // Attach controller bridge when node is available
  createEffect(() => {
    const node = hostNode();
    if (!node || !local.controller) return;

    local.controller.__attachInternal?.({
      notifyNativeValue: (value) => {
        setProperty(node, "value", value);
      },
      notifyFocus: () => {
        setProperty(node, "requestFocus", true);
      },
      notifyBlur: () => {
        setProperty(node, "requestBlur", true);
      },
    });
  });

  // Sync controlled value to native
  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    if (local.value !== undefined) {
      setProperty(node, "value", local.value);
    }
  });

  // Sync props to native
  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    setProperty(node, "placeholder", local.placeholder ?? "");
    setProperty(node, "disabled", local.disabled ?? false);
    setProperty(node, "editable", local.editable ?? true);
    setProperty(node, "secureTextEntry", local.secureTextEntry ?? false);
    setProperty(node, "keyboardType", local.keyboardType ?? "default");
    setProperty(node, "returnKeyType", local.returnKeyType ?? "done");
    setProperty(node, "autoCapitalize", local.autoCapitalize ?? "sentences");
    setProperty(node, "autoCorrect", local.autoCorrect ?? true);
    if (local.maxLength !== undefined) {
      setProperty(node, "maxLength", local.maxLength);
    }

    // Set event handlers
    setProperty(node, "onChange", handleChange);
    setProperty(node, "onFocus", handleFocus);
    setProperty(node, "onBlur", handleBlur);
    setProperty(node, "onSubmit", handleSubmit);
  });

  return (
    <text-field
      ref={(node: HostNode) => setHostNode(node)}
      defaultValue={local.defaultValue}
      style={local.style}
      testID={local.testID}
    />
  );
};
