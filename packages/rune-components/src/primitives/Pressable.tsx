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
import {
  createPressableController,
  type InternalPressableController,
  type PressableController,
} from "./pressable/controller";
import type { KeyEvent, Modifiers } from "./events";
export type { KeyEvent } from "./events";

export type PressablePointerType =
  | "touch"
  | "mouse"
  | "pen"
  | "keyboard"
  | "programmatic";

export type PressEvent = {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  timestamp: number;
  pointerType: PressablePointerType;
  button?: number;
  modifiers?: Modifiers;
  canceled?: boolean;
};

export type PressableState = {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
  disabled: boolean;
  longPressActive: boolean;
};

type HitSlop =
  | number
  | {
      top?: number;
      left?: number;
      bottom?: number;
      right?: number;
    };

export type PressableProps = {
  children?: JSX.Element | JSX.Element[];
  disabled?: boolean;
  pressRetentionOffset?: number;
  hitSlop?: HitSlop;
  delayPressInMs?: number;
  delayPressOutMs?: number;
  delayLongPressMs?: number;
  longPressMinDurationMs?: number;
  allowTouchPropagation?: boolean;
  cancelOnOutside?: boolean;
  enableDoublePress?: boolean;
  doublePressWindowMs?: number;
  role?: "button" | "link" | "menuitem" | "none";
  type?: "button" | "submit";
  focusable?: boolean;
  tabIndex?: number;
  activateKeys?: Array<"Enter" | "Space">;
  preventFocusOnPress?: boolean;
  pressEffect?: "none" | "highlight" | "ripple";
  stateLayerStyle?: Style | ((state: PressableState) => Style);
  style?: Style | ((state: PressableState) => Style);
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  controller?: PressableController;
  asChild?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  onPressIn?: (event: PressEvent) => void;
  onPressOut?: (event: PressEvent) => void;
  onPress?: (event: PressEvent) => void;
  onLongPress?: (event: { durationMs: number }) => void;
  onDoublePress?: (event: PressEvent) => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyEvent) => void;
  onKeyUp?: (event: KeyEvent) => void;
  onPressChange?: (pressed: boolean) => void;
};

const DEFAULT_PRESS_RETENTION = 20;
const DEFAULT_DELAY_PRESS_IN = 0;
const DEFAULT_DELAY_PRESS_OUT = 0;
const DEFAULT_LONG_PRESS_MS = 500;
const DEFAULT_DOUBLE_PRESS_WINDOW = 250;

const normalizeHitSlop = (value: HitSlop | undefined) => {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return {
      top: value,
      left: value,
      bottom: value,
      right: value,
    };
  }
  return {
    top: value.top ?? 0,
    left: value.left ?? 0,
    bottom: value.bottom ?? 0,
    right: value.right ?? 0,
  };
};

const defaultActivateKeysForRole = (
  role: PressableProps["role"]
): Array<"Enter" | "Space"> => {
  if (role === "button") return ["Enter", "Space"];
  if (role === "link") return ["Enter"];
  return [];
};

const normalizePressEvent = (payload: any): PressEvent => {
  if (payload && typeof payload === "object") {
    return {
      x: Number(payload.x ?? 0),
      y: Number(payload.y ?? 0),
      screenX: Number(payload.screenX ?? 0),
      screenY: Number(payload.screenY ?? 0),
      timestamp: Number(payload.timestamp ?? Date.now()),
      pointerType: (payload.pointerType as PressablePointerType) ?? "touch",
      button:
        payload.button !== undefined ? Number(payload.button) : undefined,
      modifiers: payload.modifiers
        ? {
            altKey: !!payload.modifiers.altKey,
            ctrlKey: !!payload.modifiers.ctrlKey,
            metaKey: !!payload.modifiers.metaKey,
            shiftKey: !!payload.modifiers.shiftKey,
          }
        : undefined,
      canceled: payload.canceled ?? payload.cancelled ?? false,
    };
  }
  return {
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    timestamp: Date.now(),
    pointerType: "touch",
  };
};

const normalizeKeyEvent = (payload: any): KeyEvent => {
  if (payload && typeof payload === "object") {
    return {
      key: String(payload.key ?? ""),
      code: payload.code ? String(payload.code) : undefined,
      repeat: !!payload.repeat,
      modifiers: payload.modifiers
        ? {
            altKey: !!payload.modifiers.altKey,
            ctrlKey: !!payload.modifiers.ctrlKey,
            metaKey: !!payload.modifiers.metaKey,
            shiftKey: !!payload.modifiers.shiftKey,
          }
        : undefined,
    };
  }
  return { key: "" };
};

export const Pressable: ParentComponent<PressableProps> = (props) => {
  const [local] = splitProps(props, [
    "children",
    "disabled",
    "pressRetentionOffset",
    "hitSlop",
    "delayPressInMs",
    "delayPressOutMs",
    "delayLongPressMs",
    "longPressMinDurationMs",
    "allowTouchPropagation",
    "cancelOnOutside",
    "enableDoublePress",
    "doublePressWindowMs",
    "role",
    "type",
    "focusable",
    "tabIndex",
    "activateKeys",
    "preventFocusOnPress",
    "pressEffect",
    "stateLayerStyle",
    "style",
    "pointerEvents",
    "controller",
    "asChild",
    "accessibilityLabel",
    "accessibilityHint",
    "testID",
    "onPressIn",
    "onPressOut",
    "onPress",
    "onLongPress",
    "onDoublePress",
    "onHoverIn",
    "onHoverOut",
    "onFocus",
    "onBlur",
    "onKeyDown",
    "onKeyUp",
    "onPressChange",
  ]);

  const providedController = () =>
    (local.controller as InternalPressableController | undefined) ?? null;

  const controller: InternalPressableController =
    providedController() ??
    createPressableController({ disabled: local.disabled });

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

  const resolvedChildren = resolveChildren(() => local.children);

  let lastPressed = controller.pressed();
  createEffect(() => {
    const pressed = controller.pressed();
    if (pressed !== lastPressed) {
      lastPressed = pressed;
      local.onPressChange?.(pressed);
    }
  });

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

  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    setProperty(node, "style", resolvedStyle());
    setProperty(node, "stateLayerStyle", resolvedStateLayerStyle());
    setProperty(node, "disabled", resolvedDisabled());
    setProperty(node, "pressEffect", resolvedPressEffect());
    setProperty(node, "pressRetentionOffset", resolvedPressRetention());
    setProperty(node, "hitSlop", resolvedHitSlop());
    setProperty(node, "delayPressInMs", resolvedDelayPressIn());
    setProperty(node, "delayPressOutMs", resolvedDelayPressOut());
    setProperty(node, "delayLongPressMs", resolvedDelayLongPress());
    setProperty(node, "allowTouchPropagation", resolvedAllowTouchPropagation());
    setProperty(node, "cancelOnOutside", resolvedCancelOnOutside());
    setProperty(node, "enableDoublePress", resolvedEnableDoublePress());
    setProperty(node, "doublePressWindowMs", resolvedDoublePressWindow());
    setProperty(node, "role", resolvedRole());
    setProperty(node, "accessibilityRole", resolvedRole());
    setProperty(node, "type", resolvedType());
    setProperty(node, "focusable", resolvedFocusable());
    setProperty(node, "tabIndex", resolvedTabIndex());
    setProperty(node, "activateKeys", resolvedActivateKeys());
    setProperty(
      node,
      "preventFocusOnPress",
      local.preventFocusOnPress ?? false
    );
    setProperty(node, "pointerEvents", pointerBehavior());
    setProperty(node, "accessibilityLabel", local.accessibilityLabel);
    setProperty(node, "accessibilityHint", local.accessibilityHint);
    setProperty(node, "testID", local.testID);
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
  });

  if (local.asChild) {
    console.warn(
      "[rune] Pressable asChild mode is not implemented yet; falling back to regular rendering."
    );
  }

  return (
    <pressable
      ref={(node: any) => setHostNode((node as unknown as HostNode) ?? null)}
      pointerEvents={pointerBehavior()}
      accessibilityLabel={local.accessibilityLabel}
      accessibilityHint={local.accessibilityHint}
      testID={local.testID}
    >
      {resolvedChildren()}
    </pressable>
  );
};
