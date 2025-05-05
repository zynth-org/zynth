import {
  JSX,
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
} from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style } from "@rune/core";
import { setProperty } from "@rune/core";
import { Text } from "./Text";
import { View } from "./View";

export type ButtonType = "button" | "submit";
export type Variant = "solid" | "outline" | "ghost" | "link";
export type Tone =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "neutral";
export type Size = "xs" | "sm" | "md" | "lg" | "xl";
export type PressEffect = "ripple" | "highlight" | "none";
export type HapticsMode =
  | "none"
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error";

type HitSlop =
  | number
  | {
      top?: number;
      left?: number;
      bottom?: number;
      right?: number;
    };

type MinimumTouchSize = {
  width?: number;
  height?: number;
};

type PressBehavior =
  | { mode: "single" }
  | { mode: "debounce"; ms: number }
  | { mode: "throttle"; ms: number };

type PendingBehavior =
  | { mode: "auto"; blockWhilePending?: boolean }
  | { mode: "manual" };

export type ButtonController = {
  pressed: () => boolean;
  focused: () => boolean;
  hovered: () => boolean;
  disabled: () => boolean;
  loading: () => boolean;
  focus: () => void;
  blur: () => void;
  click: () => void;
  setLoading: (value: boolean) => void;
  setDisabled: (value: boolean) => void;
};

type ButtonControllerInternal = ButtonController & {
  __attachHost?: (node: HostNode | null) => void;
  __applyState?: (partial: {
    pressed?: boolean;
    focused?: boolean;
    hovered?: boolean;
    disabled?: boolean;
    loading?: boolean;
  }) => void;
  __syncDisabled?: (value: boolean) => void;
  __syncLoading?: (value: boolean) => void;
};

type ButtonCommand = { type: "focus" } | { type: "blur" } | { type: "click" };

const MINIMUM_TOUCH_SIZE: Required<MinimumTouchSize> = {
  width: 44,
  height: 44,
};

export function createButtonController(opts?: {
  disabled?: boolean;
  loading?: boolean;
}): ButtonController {
  const [pressed, setPressed] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const [disabled, setDisabledState] = createSignal(opts?.disabled ?? false);
  const [loading, setLoadingState] = createSignal(opts?.loading ?? false);

  let host: HostNode | null = null;
  let commandSeq = 0;

  const issueCommand = (command: ButtonCommand) => {
    if (!host) return;
    commandSeq += 1;
    setProperty(host, "__buttonCommand", { seq: commandSeq, ...command });
  };

  const controller: ButtonControllerInternal = {
    pressed,
    focused,
    hovered,
    disabled,
    loading,
    focus() {
      issueCommand({ type: "focus" });
    },
    blur() {
      issueCommand({ type: "blur" });
    },
    click() {
      issueCommand({ type: "click" });
    },
    setLoading(value) {
      setLoadingState(value);
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
    if (partial.focused !== undefined) setFocused(partial.focused);
    if (partial.hovered !== undefined) setHovered(partial.hovered);
    if (partial.disabled !== undefined) setDisabledState(partial.disabled);
    if (partial.loading !== undefined) setLoadingState(partial.loading);
  };

  controller.__syncDisabled = (value) => {
    if (disabled() !== value) {
      setDisabledState(value);
    }
  };

  controller.__syncLoading = (value) => {
    if (loading() !== value) {
      setLoadingState(value);
    }
  };

  return controller;
}

export type ButtonProps = {
  children?: JSX.Element;
  label?: string;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
  iconOnly?: boolean;
  numberOfLines?: number;
  type?: ButtonType;
  disabled?: boolean;
  loading?: boolean;
  preventFocusOnPress?: boolean;
  allowMultiplePresses?: boolean;
  pressRetentionOffset?: number;
  hitSlop?: HitSlop;
  minimumTouchSize?: MinimumTouchSize;
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  fullWidth?: boolean;
  rounded?: "none" | "sm" | "md" | "lg" | "pill" | "full";
  elevation?: 0 | 1 | 2 | 3;
  pressEffect?: PressEffect;
  loadingIndicator?: JSX.Element;
  loadingPlacement?: "overlay" | "start" | "end";
  loadingAriaLabel?: string;
  haptics?: HapticsMode;
  onPress?: (event: { synthetic?: boolean }) => void | Promise<void>;
  onLongPress?: (event: { durationMs: number }) => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: { key: string }) => void;
  onKeyUp?: (event: { key: string }) => void;
  pressBehavior?: PressBehavior;
  pendingBehavior?: PendingBehavior;
  style?: Style;
  labelStyle?: Style;
  iconStyle?: Style;
  pressedStyle?: Style;
  disabledStyle?: Style;
  loadingStyle?: Style;
  asChild?: boolean;
  controller?: ButtonController;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

const isPromise = <T,>(value: any): value is Promise<T> =>
  !!value && typeof value.then === "function";

const ensureMinimumTouch = (value?: MinimumTouchSize): MinimumTouchSize => {
  if (!value) return MINIMUM_TOUCH_SIZE;
  return {
    width:
      value.width === undefined
        ? MINIMUM_TOUCH_SIZE.width
        : Math.max(value.width, MINIMUM_TOUCH_SIZE.width),
    height:
      value.height === undefined
        ? MINIMUM_TOUCH_SIZE.height
        : Math.max(value.height, MINIMUM_TOUCH_SIZE.height),
  };
};

const withAlphaHex = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const value = Math.round(Math.max(0, Math.min(alpha, 1)) * 255);
  const alphaHex = value.toString(16).padStart(2, "0");
  return `#${alphaHex}${expanded}`;
};

export const Button: ParentComponent<ButtonProps> = (props) => {
  const [local] = splitProps(props, [
    "children",
    "label",
    "startIcon",
    "endIcon",
    "iconOnly",
    "numberOfLines",
    "type",
    "disabled",
    "loading",
    "preventFocusOnPress",
    "allowMultiplePresses",
    "pressRetentionOffset",
    "hitSlop",
    "minimumTouchSize",
    "variant",
    "tone",
    "size",
    "fullWidth",
    "rounded",
    "elevation",
    "pressEffect",
    "loadingIndicator",
    "loadingPlacement",
    "loadingAriaLabel",
    "haptics",
    "onPress",
    "onLongPress",
    "onPressIn",
    "onPressOut",
    "onFocus",
    "onBlur",
    "onKeyDown",
    "onKeyUp",
    "pressBehavior",
    "pendingBehavior",
    "style",
    "labelStyle",
    "iconStyle",
    "pressedStyle",
    "disabledStyle",
    "loadingStyle",
    "asChild",
    "controller",
    "accessibilityLabel",
    "accessibilityHint",
    "testID",
  ]);

  const providedController = () =>
    (local.controller as ButtonControllerInternal | undefined) ?? null;

  const controller: ButtonControllerInternal =
    providedController() ??
    createButtonController({
      disabled: local.disabled,
      loading: local.loading,
    });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  controller.__attachHost?.(hostNode());

  createEffect(() => {
    controller.__attachHost?.(hostNode());
  });

  onCleanup(() => {
    controller.__attachHost?.(null);
  });

  createEffect(() => {
    if (local.disabled !== undefined) {
      controller.__syncDisabled?.(!!local.disabled);
    }
  });

  createEffect(() => {
    if (local.loading !== undefined) {
      controller.__syncLoading?.(!!local.loading);
    }
  });

  const pendingBehavior = createMemo<PendingBehavior>(() => {
    if (local.pendingBehavior) return local.pendingBehavior;
    return { mode: "auto", blockWhilePending: true };
  });

  const pressBehavior = createMemo<PressBehavior>(() => {
    if (local.pressBehavior) return local.pressBehavior;
    return { mode: "single" };
  });

  const allowMultiplePresses = createMemo(
    () => local.allowMultiplePresses ?? false
  );

  const [pendingCount, setPendingCount] = createSignal(0);
  const controllerDisabled = createMemo(() => controller.disabled());
  const controllerLoading = createMemo(() => controller.loading());

  const autoLoading = createMemo(
    () => pendingBehavior().mode === "auto" && pendingCount() > 0
  );

  const computedLoading = createMemo(() => {
    if (local.loading !== undefined) return !!local.loading;
    return controllerLoading() || autoLoading();
  });

  const resolvedDisabledBase = createMemo(() => {
    if (local.disabled !== undefined) return !!local.disabled;
    return controllerDisabled();
  });

  const disableWhilePending = createMemo(() => {
    if (pendingBehavior().mode !== "auto") return false;
    return (pendingBehavior() as { mode: "auto"; blockWhilePending?: boolean })
      .blockWhilePending !== false
      ? pendingCount() > 0
      : false;
  });

  const disableWhileLoading = createMemo(
    () => computedLoading() && !allowMultiplePresses()
  );

  const resolvedDisabled = createMemo(
    () =>
      resolvedDisabledBase() || disableWhilePending() || disableWhileLoading()
  );

  createEffect(() => {
    controller.__syncLoading?.(computedLoading());
  });

  const resolvedType = createMemo<ButtonType>(() => local.type ?? "button");
  const resolvedVariant = createMemo<Variant>(() => local.variant ?? "solid");
  const resolvedTone = createMemo<Tone>(() => local.tone ?? "primary");
  const resolvedSize = createMemo<Size>(() => local.size ?? "md");
  const resolvedElevation = createMemo(() => local.elevation ?? 0);
  const resolvedPressEffect = createMemo<PressEffect>(() => {
    if (local.pressEffect) return local.pressEffect;
    return "highlight";
  });
  const resolvedMinimumTouch = createMemo(() =>
    ensureMinimumTouch(local.minimumTouchSize)
  );
  const resolvedHitSlop = createMemo(() => local.hitSlop ?? 0);
  const resolvedChildren = resolveChildren(() => local.children);
  const labelForRender = createMemo(() => {
    const resolved = resolvedChildren();
    if (typeof resolved === "string") return resolved;
    if (resolved === undefined || resolved === null) {
      return local.label ?? null;
    }
    return resolved;
  });
  const resolvedLoadingPlacement = createMemo(
    () => local.loadingPlacement ?? "overlay"
  );
  const resolvedAccessibilityLabel = createMemo(() => {
    if (local.accessibilityLabel) return local.accessibilityLabel;
    const labelContent = labelForRender();
    if (typeof labelContent === "string") return labelContent;
    return local.label;
  });
  const resolvedRounded = createMemo(() => local.rounded ?? ("md" as const));
  const sizePaddingMap: Record<Size, { pv: number; ph: number }> = {
    xs: { pv: 6, ph: 10 },
    sm: { pv: 8, ph: 14 },
    md: { pv: 12, ph: 18 },
    lg: { pv: 14, ph: 22 },
    xl: { pv: 18, ph: 26 },
  };
  const sizeFontMap: Record<Size, number> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
  };
  const baseRadiusMap: Record<"none" | "sm" | "md" | "lg", number> = {
    none: 0,
    sm: 8,
    md: 12,
    lg: 16,
  };
  const toneColorMap: Record<Tone, string> = {
    primary: "#7c3aed",
    secondary: "#6366f1",
    success: "#16a34a",
    warning: "#f59e0b",
    danger: "#dc2626",
    neutral: "#4b5563",
  };
  const defaultButtonStyle = createMemo<Style>(() => {
    const sizeKey = resolvedSize();
    const { pv, ph } = sizePaddingMap[sizeKey];
    const baseMin = Math.max(pv * 2 + 20, 44);
    const roundedValue = resolvedRounded();
    const radius =
      roundedValue === "pill" || roundedValue === "full"
        ? baseMin / 2
        : baseRadiusMap[roundedValue] ?? baseRadiusMap.md;
    const base: Style = {
      paddingVertical: pv,
      paddingHorizontal: ph,
      borderRadius: radius,
      alignItems: "center",
      justifyContent: "center",
      minHeight: baseMin,
      minWidth: 44,
    };

    const toneBackground = toneColorMap[resolvedTone()];
    const variant = local.variant ?? "solid";
    if (variant === "solid") {
      return {
        ...base,
        backgroundColor: toneBackground,
      };
    }
    if (variant === "outline") {
      return {
        ...base,
        backgroundColor: "transparent",
        borderColor: toneBackground,
        borderWidth: 2,
      };
    }
    if (variant === "ghost") {
      return {
        ...base,
        backgroundColor: withAlphaHex(toneBackground, 0.12),
      };
    }
    if (variant === "link") {
      return {
        ...base,
        backgroundColor: "transparent",
        paddingHorizontal: 4,
        paddingVertical: 4,
        minHeight: baseMin,
        minWidth: 0,
      };
    }
    return base;
  });
  const resolvedButtonStyle = createMemo<Style>(() => {
    const composed: Style = { ...defaultButtonStyle() };
    if (local.fullWidth) {
      composed.width = "100%";
    }
    if (local.iconOnly) {
      const resolvedSideRaw = composed.minHeight ?? 44;
      const side =
        typeof resolvedSideRaw === "number"
          ? resolvedSideRaw
          : parseFloat(resolvedSideRaw) || 44;
      composed.width = side;
      composed.height = side;
      composed.minWidth = side;
      composed.minHeight = side;
      const pad = Math.max(composed.paddingVertical ?? 0, 8);
      composed.paddingVertical = pad;
      composed.paddingHorizontal = pad;
      composed.alignSelf = "center";
      if (resolvedRounded() === "pill" || resolvedRounded() === "full") {
        composed.borderRadius = side / 2;
      }
    }
    if (local.style) {
      Object.assign(composed, local.style as Style);
    }
    return composed;
  });
  const resolvedLabelStyle = createMemo<Style | undefined>(() => {
    if (local.labelStyle) return local.labelStyle as Style;
    const variant = local.variant ?? "solid";
    const fontSize = sizeFontMap[resolvedSize()];
    const toneColor = toneColorMap[resolvedTone()];
    if (variant === "solid") {
      return { color: "#ffffff", fontWeight: "600", fontSize };
    }
    return { color: toneColor, fontWeight: "600", fontSize };
  });
  const hasStartIcon = createMemo(() => !!local.startIcon);
  const hasEndIcon = createMemo(() => !!local.endIcon);
  const contentStyle = createMemo<Style>(() => {
    const base: Style = {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    };
    if (hasStartIcon() || hasEndIcon()) {
      base.gap = 8;
    }
    if (local.fullWidth) {
      base.width = "100%";
    }
    return base;
  });
  const shouldHideContentForOverlay = createMemo(() => {
    if (!computedLoading()) return false;
    if (resolvedLoadingPlacement() !== "overlay") return false;
    if (
      local.loadingIndicator !== undefined &&
      local.loadingIndicator !== null
    ) {
      return true;
    }
    return !!local.loadingAriaLabel;
  });

  const [debounceHandle, setDebounceHandle] = createSignal<ReturnType<
    typeof setTimeout
  > | null>(null);
  let lastPressTime = 0;

  onCleanup(() => {
    const handle = debounceHandle();
    if (handle) clearTimeout(handle);
  });

  const runPressHandler = () => {
    if (!local.onPress) return;
    if (resolvedDisabled()) return;

    const result = local.onPress({ synthetic: false });
    if (pendingBehavior().mode === "auto" && isPromise(result)) {
      setPendingCount((count) => count + 1);
      controller.__applyState?.({ loading: true });
      result.finally(() => {
        setPendingCount((count) => Math.max(0, count - 1));
        controller.__applyState?.({ loading: false });
      });
    }
  };

  const handlePress = () => {
    if (resolvedDisabled()) return;

    const behavior = pressBehavior();
    const now = Date.now();

    if (behavior.mode === "single") {
      runPressHandler();
      return;
    }

    if (behavior.mode === "throttle") {
      if (now - lastPressTime < behavior.ms) {
        return;
      }
      lastPressTime = now;
      runPressHandler();
      return;
    }

    if (behavior.mode === "debounce") {
      const existing = debounceHandle();
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        setDebounceHandle(null);
        runPressHandler();
      }, behavior.ms);
      setDebounceHandle(handle);
    }
  };

  const handlePressIn = () => {
    controller.__applyState?.({ pressed: true });
    local.onPressIn?.();
  };

  const handlePressOut = () => {
    controller.__applyState?.({ pressed: false });
    local.onPressOut?.();
  };

  const handleLongPress = (durationMs: number) => {
    local.onLongPress?.({ durationMs });
  };

  const handleFocus = () => {
    controller.__applyState?.({ focused: true });
    local.onFocus?.();
  };

  const handleBlur = () => {
    controller.__applyState?.({ focused: false });
    local.onBlur?.();
  };

  const handleKeyDown = (key: string) => {
    local.onKeyDown?.({ key });
  };

  const handleKeyUp = (key: string) => {
    local.onKeyUp?.({ key });
  };

  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    setProperty(node, "style", resolvedButtonStyle());
    setProperty(node, "type", resolvedType());
    setProperty(node, "disabled", resolvedDisabled());
    setProperty(node, "loading", computedLoading());
    setProperty(node, "variant", resolvedVariant());
    setProperty(node, "tone", resolvedTone());
    setProperty(node, "size", resolvedSize());
    setProperty(node, "fullWidth", local.fullWidth ?? false);
    setProperty(node, "rounded", resolvedRounded());
    setProperty(node, "elevation", resolvedElevation());
    setProperty(node, "pressEffect", resolvedPressEffect());
    setProperty(node, "pressRetentionOffset", local.pressRetentionOffset);
    setProperty(node, "hitSlop", resolvedHitSlop());
    setProperty(node, "minimumTouchSize", resolvedMinimumTouch());
    setProperty(
      node,
      "preventFocusOnPress",
      local.preventFocusOnPress ?? false
    );
    setProperty(node, "loadingPlacement", resolvedLoadingPlacement());
    setProperty(node, "loadingAriaLabel", local.loadingAriaLabel);
    setProperty(node, "haptics", local.haptics ?? "none");
    setProperty(node, "labelStyle", local.labelStyle);
    setProperty(node, "iconStyle", local.iconStyle);
    setProperty(node, "pressedStyle", local.pressedStyle);
    setProperty(node, "disabledStyle", local.disabledStyle);
    setProperty(node, "loadingStyle", local.loadingStyle);
    setProperty(node, "accessibilityLabel", resolvedAccessibilityLabel());
    setProperty(node, "accessibilityHint", local.accessibilityHint);
    setProperty(node, "testID", local.testID);
    setProperty(node, "onPressIn", handlePressIn);
    setProperty(node, "onPressOut", handlePressOut);
    setProperty(node, "onPress", handlePress);
    setProperty(node, "onLongPress", (payload: { durationMs: number }) => {
      handleLongPress(payload?.durationMs ?? 0);
    });
    setProperty(node, "onFocus", handleFocus);
    setProperty(node, "onBlur", handleBlur);
    setProperty(node, "onKeyDown", (payload: { key: string }) => {
      handleKeyDown(payload?.key ?? "");
    });
    setProperty(node, "onKeyUp", (payload: { key: string }) => {
      handleKeyUp(payload?.key ?? "");
    });
  });

  const renderLabel = () => {
    const labelContent = labelForRender();
    if (typeof labelContent === "string") {
      return (
        <Text numberOfLines={local.numberOfLines} style={resolvedLabelStyle()}>
          {labelContent}
        </Text>
      );
    }
    return labelContent;
  };

  const renderLoadingIndicator = () => {
    if (!computedLoading()) return null;
    if (
      local.loadingIndicator !== undefined &&
      local.loadingIndicator !== null
    ) {
      return local.loadingIndicator;
    }
    if (local.loadingAriaLabel) {
      return <Text style={resolvedLabelStyle()}>{local.loadingAriaLabel}</Text>;
    }
    return null;
  };

  const renderStartLoading = () => {
    if (resolvedLoadingPlacement() !== "start") return null;
    return renderLoadingIndicator();
  };

  const renderEndLoading = () => {
    if (resolvedLoadingPlacement() !== "end") return null;
    return renderLoadingIndicator();
  };

  const renderOverlayLoading = () => {
    if (resolvedLoadingPlacement() !== "overlay") return null;
    return renderLoadingIndicator();
  };

  if (local.iconOnly && !local.accessibilityLabel && !local.label) {
    console.warn(
      "[rune] Button with iconOnly requires accessibilityLabel or label."
    );
  }

  if (local.asChild) {
    console.warn(
      "[rune] Button asChild mode is not implemented yet; falling back to regular rendering."
    );
  }

  return (
    <button
      ref={(node: any) => setHostNode((node as unknown as HostNode) ?? null)}
      testID={local.testID}
    >
      <View style={contentStyle()}>
        {renderStartLoading()}
        {!shouldHideContentForOverlay() ? local.startIcon : null}
        {!shouldHideContentForOverlay() ? renderLabel() : null}
        {!shouldHideContentForOverlay() ? local.endIcon : null}
        {renderEndLoading()}
        {shouldHideContentForOverlay() ? renderOverlayLoading() : null}
      </View>
    </button>
  );
};
