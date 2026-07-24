import {
  createSignal,
  
  createMemo,
  onCleanup,
  type Component,
} from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

export type KeyboardType = "default" | "numeric" | "email" | "phone" | "url";
export type ReturnKeyType = "done" | "go" | "next" | "search" | "send";
export type AutoCapitalize = "none" | "sentences" | "words" | "characters";
export type TextFieldVariant = "filled" | "outlined" | "none";

export interface TextFieldRef {
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

export function useTextFieldRef(opts?: {
  value?: string;
}): TextFieldRef {
  const [text, setText] = createSignal(opts?.value ?? "");
  const [isFocused, setIsFocused] = createSignal(false);

  let bridge: TextFieldBridge | undefined;

  const controller: TextFieldRef = {
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
  /** Placeholder text color */
  placeholderColor?: string;
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
  /** Visual variant: 'filled' (default), 'outlined', or 'none' (Android only) */
  variant?: TextFieldVariant;

  // Events
  /** Called when the text changes */
  onChange?: (value: string) => void;
  /** Called when the text field gains focus */
  onFocus?: () => void;
  /** Called when the text field loses focus */
  onBlur?: () => void;
  /** Additional style */
  style?: Style;
  /** Test ID for testing frameworks */
  testID?: string;
  /** Ref for imperative operations */
  ref?: (node: (HostNode & TextFieldRef) | null) => void;
}

type TextFieldEvent<T = Record<string, unknown>> = T & { target: number };

export const TextField: Component<TextFieldProps> = (props) => {
  const local = props;

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });
  const [text, setText] = createSignal(local.value ?? local.defaultValue ?? "");
  const [focused, setFocused] = createSignal(false);
  const style = createMemo<Record<string, unknown> | undefined>(() =>
    local.style as Record<string, unknown> | undefined
  );

  const assignRef = (node: (HostNode & TextFieldRef) | null) => {
    if (typeof local.ref === "function") {
      local.ref(node);
    }
  };

  onCleanup(() => assignRef(null));

  const handleChange = (event: TextFieldEvent<{ value: string }>) => {
    setText(event.value);
    local.onChange?.(event.value);
  };

  const handleFocus = () => {
    setFocused(true);
    local.onFocus?.();
  };

  const handleBlur = () => {
    setFocused(false);
    local.onBlur?.();
  };

  effect(
    () => ({ node: hostNode(), val: local.value }),
    ({ node, val }) => {
      if (!node || val === undefined) return;
      setText(val);
      setProperty(node, "value", val);
    }
  , { scope: true });

  effect(
    () => hostNode(),
    (node) => {
      if (!node) return;
      setProperty(node, "onChange", handleChange);
      setProperty(node, "onFocus", handleFocus);
      setProperty(node, "onBlur", handleBlur);
    }
  , { scope: true });

  const syncProp = (name: string, value: () => unknown) => {
    effect(
      () => ({ node: hostNode(), val: value() }),
      ({ node, val }) => {
        if (!node) return;
        setProperty(node, name, val);
      }
    , { scope: true });
  };

  syncProp("placeholder", () => local.placeholder ?? "");
  syncProp("disabled", () => local.disabled ?? false);
  syncProp("editable", () => local.editable ?? true);
  syncProp("secureTextEntry", () => local.secureTextEntry ?? false);
  syncProp("keyboardType", () => local.keyboardType ?? "default");
  syncProp("returnKeyType", () => local.returnKeyType ?? "done");
  syncProp("autoCapitalize", () => local.autoCapitalize ?? "sentences");
  syncProp("autoCorrect", () => local.autoCorrect ?? true);
  syncProp("variant", () => local.variant);
  syncProp("maxLength", () => local.maxLength);

  syncProp("backgroundColor", () => style()?.backgroundColor);
  syncProp("borderRadius", () => style()?.borderRadius);
  syncProp("borderWidth", () => style()?.borderWidth);
  syncProp("borderColor", () => style()?.borderColor);
  syncProp("textColor", () => style()?.color);
  syncProp(
    "placeholderColor",
    () => local.placeholderColor ?? style()?.placeholderColor
  );

  const filteredStyle = createMemo(() => {
    const nextStyle = style();
    if (!nextStyle) return undefined;
    const {
      backgroundColor,
      borderRadius,
      borderWidth,
      borderColor,
      color,
      placeholderColor,
      ...rest
    } = nextStyle;
    return rest;
  });

  return (
    <text-field
      ref={(node: (HostNode & TextFieldRef) | null) => {
        if (!node) {
          setHostNode(null);
          assignRef(null);
          return;
        }
        setHostNode(node);
        const imperativeNode = node;
        imperativeNode.text = text;
        imperativeNode.setText = (value: string) => {
          setText(value);
          setProperty(node, "value", value);
        };
        imperativeNode.focus = () => {
          setProperty(node, "requestFocus", true);
        };
        imperativeNode.blur = () => {
          setProperty(node, "requestBlur", true);
        };
        imperativeNode.clear = () => {
          imperativeNode.setText("");
        };
        imperativeNode.isFocused = focused;
        if (local.defaultValue != null) setProperty(node, "defaultValue", local.defaultValue);
        if (filteredStyle() != null) setProperty(node, "style", filteredStyle());
        if (local.testID != null) setProperty(node, "testID", local.testID);
        assignRef(imperativeNode);
      }}
    />
  );
};
