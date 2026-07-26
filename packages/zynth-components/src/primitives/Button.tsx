import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { flush } from "@solidjs/signals";
import type { ParentComponent, Element as SolidElement } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";
import { Text } from "./Text";
import { View } from "./View";
import { ProgressIndicator } from "./ProgressIndicator";

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

export type ButtonRef = {
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

type ButtonControllerInternal = ButtonRef & {
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
  height: 36, // allow slightly smaller height while keeping reasonable touch width
};

const sizeMetrics: Record<
  Size,
  { minHeight: number; paddingH: number; paddingV: number; gap: number }
> = {
  xs: { minHeight: 32, paddingH: 10, paddingV: 6, gap: 6 },
  sm: { minHeight: 36, paddingH: 12, paddingV: 8, gap: 6 },
  md: { minHeight: 44, paddingH: 14, paddingV: 10, gap: 8 },
  lg: { minHeight: 52, paddingH: 16, paddingV: 12, gap: 10 },
  xl: { minHeight: 60, paddingH: 18, paddingV: 14, gap: 12 },
};

const sizeFontMap: Record<Size, number> = {
  xs: 13,
  sm: 14,
  md: 15,
  lg: 16,
  xl: 17,
};

const resolveStyleBackgroundColor = (style: Style | undefined) => {
  const value = style?.backgroundColor;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return value;
};

export function createButtonRef(opts?: {
  disabled?: boolean;
  loading?: boolean;
}): ButtonRef {
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
    if (untrack(disabled) !== value) {
      untrack(() => setDisabledState(value));
    }
  };

  controller.__syncLoading = (value) => {
    if (untrack(loading) !== value) {
      untrack(() => setLoadingState(value));
    }
  };

  return controller;
}

export type ButtonProps = {
  children?: SolidElement;
  label?: string;
  startIcon?: SolidElement;
  endIcon?: SolidElement;
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
  loadingIndicator?: SolidElement;
  loadingPlacement?: "overlay" | "start" | "end";
  loadingAriaLabel?: string;
  haptics?: HapticsMode;
  onPress?: (event: { synthetic?: boolean }) => void | unknown | Promise<void>;
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
  enableGlassIOS?: boolean;
  tintColor?: string;
  labelStyle?: Style;
  iconStyle?: Style;
  pressedStyle?: Style;
  disabledStyle?: Style;
  loadingStyle?: Style;
  asChild?: boolean;
  ref?: (node: (HostNode & ButtonRef) | null) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /**
   * Explicit override for the base color.
   */
  baseColor?: string;
  ready?: boolean;
};

const isPromise = <T,>(value: any): value is Promise<T> =>
  !!value && typeof value.then === "function";

const ensureMinimumTouch = (
  value?: MinimumTouchSize
): Required<MinimumTouchSize> => {
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
  const callWithOwner = <T extends (...args: any[]) => any>(
    callback: T | undefined,
    ...args: Parameters<T>
  ): ReturnType<T> | undefined => {
    if (!callback) return undefined;
    const res = callback(...args);
    flush();
    return res;
  };

  const local = props;

  const controller: ButtonControllerInternal = createButtonRef({
    disabled: local.disabled,
    loading: local.loading,
  });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  createEffect(
    () => ({ node: hostNode() }),
    ({ node }) => {
      controller.__attachHost?.(node);
    }
  );

  onCleanup(() => {
    controller.__attachHost?.(null);
    local.ref?.(null);
  });

  createEffect(
    () => ({ dis: local.disabled }),
    ({ dis }) => {
      if (dis !== undefined) {
        controller.__syncDisabled?.(!!dis);
      }
    }
  );

  createEffect(
    () => ({ load: local.loading }),
    ({ load }) => {
      if (load !== undefined) {
        controller.__syncLoading?.(!!load);
      }
    }
  );

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

  createEffect(
    () => ({ loadingState: computedLoading() }),
    ({ loadingState }) => {
      controller.__syncLoading?.(loadingState);
    }
  );

  const resolvedType = createMemo<ButtonType>(() => local.type ?? "button", { lazy: true });
  const resolvedVariant = createMemo<Variant>(() => local.variant ?? "solid", { lazy: true });
  const resolvedTone = createMemo<Tone>(() => local.tone ?? "primary", { lazy: true });
  const resolvedSize = createMemo<Size>(() => local.size ?? "md", { lazy: true });
  const resolvedElevation = createMemo(() => local.elevation ?? 0, { lazy: true });
  const resolvedPressEffect = createMemo<PressEffect>(() => {
    if (local.pressEffect) return local.pressEffect;
    return "highlight";
  }, { lazy: true });
  const resolvedMinimumTouch = createMemo<Required<MinimumTouchSize>>(() =>
    ensureMinimumTouch(local.minimumTouchSize), { lazy: true }
  );
  const resolvedHitSlop = createMemo(() => local.hitSlop ?? 0, { lazy: true });
  const resolvedChildren = resolveChildren(() => local.children);

  // Detect if children is a simple string to use native title
  const titleContent = createMemo(() => {
    const resolved = resolvedChildren();
    if (typeof resolved === "string") return resolved;
    if (local.label) return local.label;
    return undefined;
  }, { lazy: true });

  const useNativeTitle = createMemo<boolean>(() => {
    return false;
  }, { lazy: true });

  const isStringContent = createMemo(() => titleContent() !== undefined, { lazy: true });

  const labelForRender = createMemo(() => {
    const resolved = resolvedChildren();
    if (typeof resolved === "string") return resolved;
    if (resolved === undefined || resolved === null) {
      return local.label ?? null;
    }
    return resolved;
  }, { lazy: true });
  const resolvedLoadingPlacement = createMemo(
    () => local.loadingPlacement ?? "overlay", { lazy: true }
  );
  const resolvedAccessibilityLabel = createMemo(() => {
    if (local.accessibilityLabel) return local.accessibilityLabel;
    const labelContent = labelForRender();
    if (typeof labelContent === "string") return labelContent;
    return local.label;
  }, { lazy: true });
  const resolvedRounded = createMemo<
    ButtonProps["rounded"] | undefined
  >(() => {
    if (local.rounded) return local.rounded;
    const style = local.style as Style | undefined;
    if (style?.borderRadius !== undefined) {
      return undefined;
    }
    return "md" as const;
  }, { lazy: true });

  // Removed: sizePaddingMap, baseRadiusMap, etc. since native handles layout.

  const toneColorMap: Record<Tone, string> = {
    primary: "#7c3aed",
    secondary: "#6366f1",
    success: "#16a34a",
    warning: "#f59e0b",
    danger: "#dc2626",
    neutral: "#4b5563",
  };

  const defaultButtonStyle = createMemo<Style>(() => {
    const touch = resolvedMinimumTouch();
    const metrics = sizeMetrics[resolvedSize()] ?? sizeMetrics.md;
    return {
      minHeight: Math.max(metrics.minHeight, touch.height),
      minWidth: touch.width,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: metrics.paddingH,
      paddingVertical: metrics.paddingV,
    };
  }, { lazy: true });

  const resolvedButtonStyle = createMemo<Style>(() => {
    const composed: Style = { ...defaultButtonStyle() };
    if (local.fullWidth) {
      composed.width = "100%";
    }
    if (local.iconOnly) {
      const metrics = sizeMetrics[resolvedSize()] ?? sizeMetrics.md;
      // Icon-only buttons should be square (height = width)
      const size = metrics.minHeight;
      composed.width = size;
      composed.height = size;
      composed.minWidth = size;
      composed.minHeight = size;
      // Remove horizontal padding for square shape
      composed.paddingHorizontal = 0;
      composed.paddingVertical = 0;
    }
    if (local.style) {
      let extraStyle: any = local.style;
      while (typeof extraStyle === "function") {
        extraStyle = extraStyle();
      }
      if (extraStyle && typeof extraStyle === "object") {
        Object.assign(composed, extraStyle);
      }
    }
    return composed;
  }, { lazy: true });

  // Removed: resolvedLabelStyle logic (native handles text style)

  const hasStartIcon = createMemo(() => !!local.startIcon);
  const hasEndIcon = createMemo(() => !!local.endIcon);
  const hasAffixes = createMemo(() => hasStartIcon() || hasEndIcon());
  const hasExplicitButtonWidth = createMemo(() => {
    const style = local.style as Style | undefined;
    return local.fullWidth || style?.width !== undefined;
  });
  const contentStyle = createMemo<Style>(() => {
    const metrics = sizeMetrics[resolvedSize()] ?? sizeMetrics.md;
    const base: Style = {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    };
    base.gap = metrics.gap;
    if (hasExplicitButtonWidth()) {
      base.width = "100%";
    }
    return base;
  });

  const shouldHideContentForOverlay = createMemo(() => {
    if (!computedLoading()) return false;
    
    // If native indicator is disabled, we must show the content (custom indicator)
    if (local.loadingIndicator === false) return false;

    if (resolvedLoadingPlacement() !== "overlay") return false;
    
    // Hide content when loading in overlay mode to allow native spinner to center
    return true;
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

    const result = callWithOwner(local.onPress, { synthetic: false });
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
    callWithOwner(local.onPressIn);
  };

  const handlePressOut = () => {
    controller.__applyState?.({ pressed: false });
    callWithOwner(local.onPressOut);
  };

  const handleLongPress = (durationMs: number) => {
    callWithOwner(local.onLongPress, { durationMs });
  };

  const handleFocus = () => {
    controller.__applyState?.({ focused: true });
    callWithOwner(local.onFocus);
  };

  const handleBlur = () => {
    controller.__applyState?.({ focused: false });
    callWithOwner(local.onBlur);
  };

  const handleKeyDown = (key: string) => {
    callWithOwner(local.onKeyDown, { key });
  };

  const handleKeyUp = (key: string) => {
    callWithOwner(local.onKeyUp, { key });
  };

  const applyButtonProps = (node: HostNode) => {
    let effectiveVariant = resolvedVariant();
    if (effectiveVariant === "solid") effectiveVariant = "filled" as any;
    else if (effectiveVariant === "outline") effectiveVariant = "outlined" as any;
    else if (effectiveVariant === "ghost") effectiveVariant = "text" as any;
    else if (effectiveVariant === "link") effectiveVariant = "text" as any;

    let effectiveRole = "normal";
    if (resolvedTone() === "danger") {
      effectiveRole = "destructive";
    }

    const glass = !!local.enableGlassIOS;
    const shouldUseBackgroundBase = glass || resolvedVariant() === "solid";
    const st = resolvedButtonStyle() as Style | undefined;
    const styleBaseColor = shouldUseBackgroundBase
      ? resolveStyleBackgroundColor(st)
      : undefined;
    const color =
      local.baseColor ??
      styleBaseColor ??
      (resolvedTone() === "danger" ? toneColorMap[resolvedTone() as Tone] : undefined);

    const styleToPass = st ? { ...st } : undefined;
    if (shouldUseBackgroundBase && styleBaseColor && styleToPass) {
      delete styleToPass.backgroundColor;
    }

    setProperty(node, "style", styleToPass);
    setProperty(node, "type", resolvedType());
    setProperty(node, "disabled", resolvedDisabled());
    setProperty(node, "loading", computedLoading());
    setProperty(node, "variant", effectiveVariant);
    setProperty(node, "role", effectiveRole);
    if (color) setProperty(node, "baseColor", color);
    if (useNativeTitle()) {
      setProperty(node, "title", titleContent());
    }

    setProperty(node, "tone", resolvedTone());
    setProperty(node, "iconOnly", local.iconOnly ?? false);

    let nativeSize: any = resolvedSize();
    switch (resolvedSize()) {
      case "xs":
        nativeSize = "mini" as any;
        break;
      case "sm":
        nativeSize = "small" as any;
        break;
      case "lg":
      case "xl":
        nativeSize = "large" as any;
        break;
      default:
        nativeSize = "medium" as any;
        break;
    }
    setProperty(node, "size", nativeSize);
    setProperty(node, "fullWidth", local.fullWidth ?? false);
    setProperty(node, "rounded", resolvedRounded() ?? null);
    setProperty(node, "elevation", resolvedElevation());
    setProperty(node, "pressEffect", resolvedPressEffect());
    setProperty(node, "pressRetentionOffset", local.pressRetentionOffset);
    setProperty(node, "hitSlop", resolvedHitSlop());
    setProperty(node, "minimumTouchSize", resolvedMinimumTouch());
    setProperty(node, "enableGlassIOS", glass);
    setProperty(node, "tintColor", local.tintColor);
    setProperty(node, "preventFocusOnPress", local.preventFocusOnPress ?? false);
    setProperty(node, "loadingPlacement", resolvedLoadingPlacement());
    setProperty(node, "loadingIndicator", false);
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
    setProperty(node, "ready", local.ready ?? true);
  };

  createEffect(
    () => ({
      variant: resolvedVariant(),
      tone: resolvedTone(),
      style: resolvedButtonStyle(),
      disabled: resolvedDisabled(),
      loading: computedLoading(),
      type: resolvedType(),
      size: resolvedSize(),
      accLabel: resolvedAccessibilityLabel(),
      ready: local.ready,
      node: hostNode(),
    }),
    ({ node }) => {
      if (node) {
        untrack(() => applyButtonProps(node));
      }
    }
  );

  const renderLoadingIndicator = () => {
    if (!computedLoading()) return null;
    if (
      local.loadingIndicator !== undefined &&
      local.loadingIndicator !== null
    ) {
      return local.loadingIndicator;
    }
    // Native handles activity indicator usually, but if we want custom one...
    // If native=true (always true now), native button shows spinner if loading=true.
    // So we might NOT want to render it here unless it's custom?
    // Let's leave it for now, but native config usually handles "showsActivityIndicator".
    return null;
  };

  const resolvedTextColor = createMemo(() => {
    const style = local.labelStyle as Style;
    if (style?.color) return style.color;

    if (resolvedVariant() === "solid") {
      return "#ffffff";
    }
    return toneColorMap[resolvedTone()] ?? toneColorMap.primary;
  });

  const shouldUseFlexibleLabel = createMemo(() => {
    if (hasAffixes()) return true;
    if (computedLoading()) return true;
    return false;
  });

  // If using native title, we don't render text children.
  // Otherwise, render a Text node for string content so it participates in layout.
  const renderContent = () => {
    if (isStringContent() && !useNativeTitle()) {
      const fontSize = sizeFontMap[resolvedSize()] ?? sizeFontMap.md;
      // Merge labelStyle with default font size
      const textStyle: Style = {
        fontSize,
        color: resolvedTextColor(),
        textAlign: "center",
        ...(shouldUseFlexibleLabel()
          ? {
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
            }
          : {
              width: "100%",
            }),
        ...((local.labelStyle as Style) ?? {}),
      };
      return <Text style={textStyle}>{titleContent()}</Text>;
    }
    if (isStringContent()) return null;
    return local.children;
  };

  const shouldUseContentWrapper = createMemo(() => {
    if (hasExplicitButtonWidth()) return true;
    if (!isStringContent()) return true;
    if (hasAffixes()) return true;
    if (computedLoading()) return true;
    return false;
  });

  return (
    <button
      ref={(node: any) => {
        const host = (node as unknown as HostNode) ?? null;
        if (host) {
          applyButtonProps(host);
          setHostNode(host);
          const imperativeNode = host as HostNode & ButtonRef;
          imperativeNode.pressed = controller.pressed;
          imperativeNode.focused = controller.focused;
          imperativeNode.hovered = controller.hovered;
          imperativeNode.disabled = controller.disabled;
          imperativeNode.loading = controller.loading;
          imperativeNode.focus = controller.focus;
          imperativeNode.blur = controller.blur;
          imperativeNode.click = controller.click;
          imperativeNode.setLoading = controller.setLoading;
          imperativeNode.setDisabled = controller.setDisabled;
          if (local.testID != null) setProperty(host, "testID", local.testID);
          local.ref?.(imperativeNode);
          return;
        }
        local.ref?.(null);
      }}
    >
      {shouldUseContentWrapper() ? (
        <View style={contentStyle()}>
          {shouldHideContentForOverlay() && local.loadingIndicator !== false ? (
            <>
              {local.loadingIndicator ?? (
                <ProgressIndicator
                  color={resolvedTextColor()}
                  size={
                    resolvedSize() === "xs" || resolvedSize() === "sm"
                      ? "small"
                      : "small"
                  }
                />
              )}
              {local.loadingAriaLabel ? (
                <Text
                  style={{
                    fontSize: sizeFontMap[resolvedSize()] ?? sizeFontMap.md,
                    color: resolvedTextColor(),
                    ...((local.labelStyle as Style) ?? {}),
                  }}
                >
                  {local.loadingAriaLabel}
                </Text>
              ) : null}
            </>
          ) : null}
          {!shouldHideContentForOverlay() && local.startIcon && (
            <View style={{ flexShrink: 0 }}>{local.startIcon}</View>
          )}
          {!shouldHideContentForOverlay() ? renderContent() : null}
          {!shouldHideContentForOverlay() && local.endIcon && (
            <View style={{ flexShrink: 0 }}>{local.endIcon}</View>
          )}
        </View>
      ) : (
        renderContent()
      )}
    </button>
  );
};
