import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { ParentComponent, Element as SolidElement } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";
import {
  createPressableRef,
  type InternalPressableController,
  type PressableRef,
} from "./pressable/controller";
import type { KeyEvent, Modifiers } from "./events";
import { useAnimatedStyleMapper } from "../hooks/useAnimatedStyleMapper";
export type { KeyEvent } from "./events";

export interface PressableState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
  disabled: boolean;
  longPressActive: boolean;
}

export type PressableRole =
  | "button"
  | "link"
  | "checkbox"
  | "radio"
  | "tab"
  | "switch"
  | "menuitem"
  | "none";

export type PressableType = "button" | "submit" | "reset";
export type PressableEffect = "ripple" | "opacity" | "scale" | "highlight" | "none";

export interface PressEvent {
  nativeEvent: {
    target: number;
    timestamp: number;
    x?: number;
    y?: number;
    absoluteX?: number;
    absoluteY?: number;
    pointerType?: "touch" | "mouse" | "pen";
    button?: number;
    buttons?: number;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
}

export interface LongPressEvent {
  durationMs: number;
}

export interface RectOffset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface PressableProps {
  asChild?: boolean;
  disabled?: boolean;
  role?: PressableRole;
  type?: PressableType;
  pressEffect?: PressableEffect;
  pressRetentionOffset?: RectOffset;
  delayPressInMs?: number;
  delayPressOutMs?: number;
  delayLongPressMs?: number;
  longPressMinDurationMs?: number;

  allowTouchPropagation?: boolean;
  cancelOnOutside?: boolean;
  enableDoublePress?: boolean;
  doublePressWindowMs?: number;

  hitSlop?: number | RectOffset;
  focusable?: boolean;
  tabIndex?: number;
  activateKeys?: string[];
  preventFocusOnPress?: boolean;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;

  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;

  style?: Style | ((state: PressableState) => Style | undefined);
  stateLayerStyle?: Style | ((state: PressableState) => Style | undefined);

  onPressIn?: (event: PressEvent) => void;
  onPressOut?: (event: PressEvent) => void;
  onPress?: (event: PressEvent) => void;
  onLongPress?: (event: LongPressEvent) => void;
  onDoublePress?: (event: PressEvent) => void;

  onHoverIn?: () => void;
  onHoverOut?: () => void;

  onFocus?: () => void;
  onBlur?: () => void;

  onKeyDown?: (event: KeyEvent) => void;
  onKeyUp?: (event: KeyEvent) => void;

  onPressChange?: (pressed: boolean) => void;

  ready?: boolean;

  ref?: (node: (HostNode & PressableRef) | null) => void;
  children?: SolidElement | ((state: PressableState) => SolidElement);
}

const DEFAULT_PRESS_RETENTION: RectOffset = {
  top: 20,
  right: 20,
  bottom: 20,
  left: 20,
};

const DEFAULT_DELAY_PRESS_IN = 0;
const DEFAULT_DELAY_PRESS_OUT = 0;
const DEFAULT_LONG_PRESS_MS = 500;
const DEFAULT_DOUBLE_PRESS_WINDOW = 300;

function defaultActivateKeysForRole(role: PressableRole): string[] {
  switch (role) {
    case "button":
    case "checkbox":
    case "radio":
    case "switch":
    case "tab":
    case "menuitem":
      return ["Enter", " "];
    case "link":
      return ["Enter"];
    default:
      return ["Enter", " "];
  }
}

function normalizeHitSlop(input?: number | RectOffset): RectOffset {
  if (!input) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof input === "number") {
    return { top: input, right: input, bottom: input, left: input };
  }
  return {
    top: input.top ?? 0,
    right: input.right ?? 0,
    bottom: input.bottom ?? 0,
    left: input.left ?? 0,
  };
}

function normalizeModifiers(raw: any): Modifiers {
  return {
    altKey: !!(raw?.alt ?? raw?.altKey),
    ctrlKey: !!(raw?.ctrl ?? raw?.ctrlKey),
    metaKey: !!(raw?.meta ?? raw?.metaKey),
    shiftKey: !!(raw?.shift ?? raw?.shiftKey),
  };
}

function normalizeKeyEvent(payload: any): KeyEvent {
  return {
    key: String(payload?.key ?? ""),
    code: payload?.code ? String(payload.code) : undefined,
    repeat: !!payload?.repeat,
    modifiers: normalizeModifiers(payload?.modifiers),
  };
}

function normalizePressEvent(payload: any): PressEvent {
  if (payload && typeof payload === "object" && "nativeEvent" in payload) {
    return payload as PressEvent;
  }
  return {
    nativeEvent: {
      target: Number(payload?.target ?? 0),
      timestamp: Number(payload?.timestamp ?? Date.now()),
      x: payload?.x != null ? Number(payload.x) : undefined,
      y: payload?.y != null ? Number(payload.y) : undefined,
      absoluteX: payload?.absoluteX != null ? Number(payload.absoluteX) : undefined,
      absoluteY: payload?.absoluteY != null ? Number(payload.absoluteY) : undefined,
      pointerType: payload?.pointerType ?? "touch",
      button: payload?.button != null ? Number(payload.button) : undefined,
      buttons: payload?.buttons != null ? Number(payload.buttons) : undefined,
      altKey: !!payload?.altKey,
      ctrlKey: !!payload?.ctrlKey,
      metaKey: !!payload?.metaKey,
      shiftKey: !!payload?.shiftKey,
    },
  };
}

export const usePressableRef = () => createPressableRef();

export const Pressable: ParentComponent<PressableProps> = (props) => {
  const local = props;

  const controller = createPressableRef({
    disabled: local.disabled,
  }) as unknown as InternalPressableController;

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  useAnimatedStyleMapper(() => local.style, hostNode);

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

  const resolvedDisabled = createMemo(
    () => local.disabled ?? controller.disabled()
  );

  const resolvedRole = createMemo(() => local.role ?? "none");
  const resolvedType = createMemo(() => local.type ?? "button");
  const resolvedPressEffect = createMemo(() => local.pressEffect ?? "none");
  const resolvedPressRetention = createMemo(
    () => local.pressRetentionOffset ?? DEFAULT_PRESS_RETENTION
  );
  const resolvedDelayPressIn = createMemo(
    () => local.delayPressInMs ?? DEFAULT_DELAY_PRESS_IN
  );
  const resolvedDelayPressOut = createMemo(
    () => local.delayPressOutMs ?? DEFAULT_DELAY_PRESS_OUT
  );
  const resolvedDelayLongPress = createMemo(() => {
    if (local.longPressMinDurationMs !== undefined) {
      return local.longPressMinDurationMs;
    }
    if (local.delayLongPressMs !== undefined) {
      return local.delayLongPressMs;
    }
    return DEFAULT_LONG_PRESS_MS;
  });
  const resolvedAllowTouchPropagation = createMemo(
    () => local.allowTouchPropagation ?? false
  );
  const resolvedCancelOnOutside = createMemo(
    () => local.cancelOnOutside ?? true
  );
  const resolvedEnableDoublePress = createMemo(
    () => local.enableDoublePress ?? false
  );
  const resolvedDoublePressWindow = createMemo(
    () => local.doublePressWindowMs ?? DEFAULT_DOUBLE_PRESS_WINDOW
  );
  const resolvedHitSlop = createMemo(() => normalizeHitSlop(local.hitSlop));

  const resolvedActivateKeys = createMemo(() => {
    if (local.activateKeys) return local.activateKeys;
    return defaultActivateKeysForRole(resolvedRole());
  });

  const resolvedFocusable = createMemo(() => {
    if (local.focusable !== undefined) return !!local.focusable;
    return !resolvedDisabled();
  });

  const resolvedTabIndex = createMemo(() => {
    if (!resolvedFocusable()) return -1;
    if (local.tabIndex !== undefined) return local.tabIndex;
    return 0;
  });

  const pointerBehavior = createMemo(
    () => local.pointerEvents ?? "auto"
  );

  const currentState = createMemo<PressableState>(() => ({
    pressed: controller.pressed(),
    hovered: controller.hovered(),
    focused: controller.focused(),
    disabled: resolvedDisabled(),
    longPressActive: controller.longPressActive(),
  }));

  const resolvedStyle = createMemo<Style | undefined>(() => {
    const value = local.style;
    const state = currentState();
    if (typeof value === "function") {
      return value(state);
    }
    return value as Style | undefined;
  });

  const resolvedStateLayerStyle = createMemo<Style | undefined>(() => {
    const value = local.stateLayerStyle;
    const state = currentState();
    if (typeof value === "function") {
      return value(state);
    }
    return value as Style | undefined;
  });

  const resolvedChildren = resolveChildren(() => {
    const children = local.children;
    if (typeof children === "function") {
      return children(currentState());
    }
    return children;
  });

  let lastPressed = controller.pressed();
  createEffect(
    () => ({ pressed: controller.pressed() }),
    ({ pressed }) => {
      if (pressed !== lastPressed) {
        lastPressed = pressed;
        local.onPressChange?.(pressed);
      }
    }
  );

  const handlePressIn = (payload: any) => {
    if (resolvedDisabled()) return;
    controller.__applyState?.({ pressed: true, longPressActive: false });
    local.onPressIn?.(normalizePressEvent(payload));
  };

  const handlePressOut = (payload: any) => {
    controller.__applyState?.({ pressed: false, longPressActive: false });
    local.onPressOut?.(normalizePressEvent(payload));
  };

  const handlePress = (payload: any) => {
    if (resolvedDisabled()) return;
    local.onPress?.(normalizePressEvent(payload));
  };

  const handleLongPress = (payload: { durationMs?: number }) => {
    if (resolvedDisabled()) return;
    controller.__applyState?.({ longPressActive: true });
    local.onLongPress?.({
      durationMs:
        payload?.durationMs ?? resolvedDelayLongPress(),
    });
  };

  const handleDoublePress = (payload: any) => {
    if (!resolvedEnableDoublePress()) return;
    if (resolvedDisabled()) return;
    local.onDoublePress?.(normalizePressEvent(payload));
  };

  const handleHoverIn = () => {
    controller.__applyState?.({ hovered: true });
    local.onHoverIn?.();
  };

  const handleHoverOut = () => {
    controller.__applyState?.({ hovered: false });
    local.onHoverOut?.();
  };

  const handleFocus = () => {
    controller.__applyState?.({ focused: true });
    local.onFocus?.();
  };

  const handleBlur = () => {
    controller.__applyState?.({ focused: false });
    local.onBlur?.();
  };

  const handleKeyDown = (payload: any) => {
    local.onKeyDown?.(normalizeKeyEvent(payload));
  };

  const handleKeyUp = (payload: any) => {
    local.onKeyUp?.(normalizeKeyEvent(payload));
  };

  effect(
    () => ({ node: hostNode(), st: resolvedStyle(), layerSt: resolvedStateLayerStyle() }),
    ({ node, st, layerSt }) => {
      if (!node) return;
      setProperty(node, "style", st);
      setProperty(node, "stateLayerStyle", layerSt);
    }
  , { scope: true });

  effect(
    () => ({
      node: hostNode(),
      dis: resolvedDisabled(),
      eff: resolvedPressEffect(),
      ret: resolvedPressRetention(),
      slop: resolvedHitSlop(),
      pressIn: resolvedDelayPressIn(),
      pressOut: resolvedDelayPressOut(),
      longPress: resolvedDelayLongPress(),
      allowProp: resolvedAllowTouchPropagation(),
      cancelOutside: resolvedCancelOnOutside(),
      doublePress: resolvedEnableDoublePress(),
      doubleWin: resolvedDoublePressWindow(),
      role: resolvedRole(),
      type: resolvedType(),
      focusable: resolvedFocusable(),
      tabIndex: resolvedTabIndex(),
      activateKeys: resolvedActivateKeys(),
      preventFocus: local.preventFocusOnPress ?? false,
      pointer: pointerBehavior(),
      glass: local.enableGlassIOS ?? false,
      tint: local.tintColor,
      label: local.accessibilityLabel,
      hint: local.accessibilityHint,
      testId: local.testID,
    }),
    (cfg) => {
      const { node } = cfg;
      if (!node) return;

      setProperty(node, "disabled", cfg.dis);
      setProperty(node, "pressEffect", cfg.eff);
      setProperty(node, "pressRetentionOffset", cfg.ret);
      setProperty(node, "hitSlop", cfg.slop);
      setProperty(node, "delayPressInMs", cfg.pressIn);
      setProperty(node, "delayPressOutMs", cfg.pressOut);
      setProperty(node, "delayLongPressMs", cfg.longPress);
      setProperty(node, "allowTouchPropagation", cfg.allowProp);
      setProperty(node, "cancelOnOutside", cfg.cancelOutside);
      setProperty(node, "enableDoublePress", cfg.doublePress);
      setProperty(node, "doublePressWindowMs", cfg.doubleWin);
      setProperty(node, "role", cfg.role);
      setProperty(node, "accessibilityRole", cfg.role);
      setProperty(node, "type", cfg.type);
      setProperty(node, "focusable", cfg.focusable);
      setProperty(node, "tabIndex", cfg.tabIndex);
      setProperty(node, "activateKeys", cfg.activateKeys);
      setProperty(node, "preventFocusOnPress", cfg.preventFocus);
      setProperty(node, "pointerEvents", cfg.pointer);
      setProperty(node, "enableGlassIOS", cfg.glass);
      setProperty(node, "tintColor", cfg.tint);
      setProperty(node, "accessibilityLabel", cfg.label);
      setProperty(node, "accessibilityHint", cfg.hint);
      setProperty(node, "testID", cfg.testId);
    }
  , { scope: true });

  effect(
    () => hostNode(),
    (node) => {
      if (!node) return;

      setProperty(node, "onPressIn", handlePressIn);
      setProperty(node, "onPressOut", handlePressOut);
      setProperty(node, "onPress", handlePress);
      setProperty(node, "onLongPress", handleLongPress);
      setProperty(node, "onDoublePress", handleDoublePress);
      setProperty(node, "onHoverIn", handleHoverIn);
      setProperty(node, "onHoverOut", handleHoverOut);
      setProperty(node, "onFocus", handleFocus);
      setProperty(node, "onBlur", handleBlur);
      setProperty(node, "onKeyDown", handleKeyDown);
      setProperty(node, "onKeyUp", handleKeyUp);
    }
  , { scope: true });

  effect(
    () => ({ node: hostNode(), isReady: local.ready ?? true }),
    ({ node, isReady }) => {
      if (!node) return;
      setProperty(node, "ready", isReady);
    }
  , { scope: true });

  if (local.asChild) {
    console.warn(
      "[zynth] Pressable asChild mode is not implemented yet; falling back to regular rendering."
    );
  }

  return (
    <pressable
      ref={(node: any) => {
        const host = (node as unknown as HostNode) ?? null;
        if (host) {
          const imperativeNode = host as HostNode & PressableRef;
          imperativeNode.pressed = controller.pressed;
          imperativeNode.hovered = controller.hovered;
          imperativeNode.focused = controller.focused;
          imperativeNode.disabled = controller.disabled;
          imperativeNode.longPressActive = controller.longPressActive;
          imperativeNode.focus = controller.focus;
          imperativeNode.blur = controller.blur;
          imperativeNode.click = controller.click;
          imperativeNode.cancel = controller.cancel;
          imperativeNode.setDisabled = controller.setDisabled;
          setProperty(host, "pointerEvents", pointerBehavior());
          if (local.accessibilityLabel != null) setProperty(host, "accessibilityLabel", local.accessibilityLabel);
          if (local.accessibilityHint != null) setProperty(host, "accessibilityHint", local.accessibilityHint);
          if (local.testID != null) setProperty(host, "testID", local.testID);
          setHostNode(host);
          local.ref?.(imperativeNode);
          return;
        }
        setHostNode(null);
        local.ref?.(null);
      }}
    >
      {resolvedChildren()}
    </pressable>
  );
};
