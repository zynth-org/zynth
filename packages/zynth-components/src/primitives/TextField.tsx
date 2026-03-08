import {
  splitProps,
  createSignal,
  createEffect,
  onCleanup,
  type Component,
} from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import { setProperty } from "@zynth/core";

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
  /** Called when the return/submit key is pressed */
  onSubmit?: (event: { value: string }) => void;

  /** Ref for imperative control */
  ref?: ((node: (HostNode & TextFieldRef) | null) => void) | null;

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
    "placeholderColor",
    "disabled",
    "editable",
    "secureTextEntry",
    "keyboardType",
    "returnKeyType",
    "autoCapitalize",
    "autoCorrect",
    "maxLength",
    "variant",
    "onChange",
    "onFocus",
    "onBlur",
    "onSubmit",
    "ref",
    "style",
    "testID",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const [text, setText] = createSignal(local.value ?? local.defaultValue ?? "");
  const [focused, setFocused] = createSignal(false);

  const assignRef = (node: (HostNode & TextFieldRef) | null) => {
    if (typeof local.ref === "function") {
      local.ref(node);
    }
  };

  onCleanup(() => assignRef(null));

  // Handle text change from native
  const handleChange = (event: TextFieldEvent<{ value: string }>) => {
    setText(event.value);
    local.onChange?.(event.value);
  };

  // Handle focus from native
  const handleFocus = () => {
    setFocused(true);
    local.onFocus?.();
  };

  // Handle blur from native
  const handleBlur = () => {
    setFocused(false);
    local.onBlur?.();
  };

  // Handle submit from native
  const handleSubmit = (event: TextFieldEvent<{ value: string }>) => {
    local.onSubmit?.({ value: event.value });
  };

  // Sync controlled value to native
  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    if (local.value !== undefined) {
      setText(local.value);
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
    // Only send variant if explicitly set - don't interfere with default filled style
    if (local.variant !== undefined) {
      setProperty(node, "variant", local.variant);
    }
    if (local.maxLength !== undefined) {
      setProperty(node, "maxLength", local.maxLength);
    }

    // Set event handlers
    setProperty(node, "onChange", handleChange);
    setProperty(node, "onFocus", handleFocus);
    setProperty(node, "onBlur", handleBlur);
    setProperty(node, "onSubmit", handleSubmit);
  });

  // Sync style properties to native
  createEffect(() => {
    const node = hostNode();
    if (!node || !local.style) return;

    const style = local.style as Record<string, unknown>;

    if (style.backgroundColor !== undefined) {
      setProperty(node, "backgroundColor", style.backgroundColor);
    }
    if (style.borderRadius !== undefined) {
      setProperty(node, "borderRadius", style.borderRadius);
    }
    if (style.borderWidth !== undefined) {
      setProperty(node, "borderWidth", style.borderWidth);
    }
    if (style.borderColor !== undefined) {
      setProperty(node, "borderColor", style.borderColor);
    }
    if (style.color !== undefined) {
      setProperty(node, "textColor", style.color);
    }
    const placeholderColor =
      local.placeholderColor ?? style.placeholderColor ?? undefined;
    if (placeholderColor !== undefined) {
      setProperty(node, "placeholderColor", placeholderColor);
    }
  });

  // Filter out styles that are handled natively to avoid double-application
  const filteredStyle = () => {
    if (!local.style) return undefined;
    const style = local.style as Record<string, unknown>;
    const {
      backgroundColor,
      borderRadius,
      borderWidth,
      borderColor,
      color,
      placeholderColor,
      ...rest
    } = style;
    return rest;
  };

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
        assignRef(imperativeNode);
      }}
      defaultValue={local.defaultValue}
      style={filteredStyle()}
      testID={local.testID}
    />
  );
};
