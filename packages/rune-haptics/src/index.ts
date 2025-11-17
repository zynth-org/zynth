type ModulesBridge = {
  call?(
    name: string,
    method: string,
    args?: unknown
  ): Promise<unknown> | unknown;
};

type VibratePattern = number | number[];

type ErrorResult = {
  error?: string;
  message?: string;
};

const MODULE_NAME = "RuneHaptics";
const PLATFORM_GLOBAL_KEY = "__RUNE_PLATFORM";

function getGlobalObject(): Record<string, unknown> {
  if (typeof globalThis !== "undefined") {
    return globalThis as any;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function getPlatformOS(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  if (typeof value !== "string") {
    return null;
  }
  return value.toLowerCase();
}

function isAndroidPlatform(): boolean {
  return getPlatformOS() === "android";
}

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

async function callBridge(method: string, args?: unknown): Promise<boolean> {
  const bridge = getModulesBridge();
  if (!bridge || !bridge.call) {
    return false;
  }

  try {
    const result = await Promise.resolve(
      bridge.call(MODULE_NAME, method, args)
    );
    if (isErrorResult(result)) {
      throw new Error(result.message || result.error || "Unknown error");
    }
    return true;
  } catch (error) {
    console.error(
      `[RuneHaptics] Failed to ${method}():`,
      JSON.stringify(error)
    );
    return false;
  }
}

function isVibrationAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return "navigator" in window && "vibrate" in navigator;
}

const vibrationPatterns: Record<string, VibratePattern> = {
  success: [40, 100, 40],
  warning: [50, 100, 50],
  error: [60, 100, 60, 100, 60],
  light: [40],
  medium: [50],
  heavy: [60],
  soft: [35],
  rigid: [45],
  selection: [50],
};

function vibrateFallback(key: string): void {
  if (!isVibrationAvailable()) {
    return;
  }
  const pattern = vibrationPatterns[key];
  if (pattern === undefined) {
    return;
  }
  navigator.vibrate(pattern);
}

export enum NotificationFeedbackType {
  Success = "success",
  Warning = "warning",
  Error = "error",
}

export enum ImpactFeedbackStyle {
  Light = "light",
  Medium = "medium",
  Heavy = "heavy",
  Rigid = "rigid",
  Soft = "soft",
}

export enum AndroidHaptics {
  Clock_Tick = "clock-tick",
  Confirm = "confirm",
  Context_Click = "context-click",
  Drag_Start = "drag-start",
  Gesture_End = "gesture-end",
  Gesture_Start = "gesture-start",
  Keyboard_Press = "keyboard-press",
  Keyboard_Release = "keyboard-release",
  Keyboard_Tap = "keyboard-tap",
  Long_Press = "long-press",
  No_Haptics = "no-haptics",
  Reject = "reject",
  Segment_Frequent_Tick = "segment-frequent-tick",
  Segment_Tick = "segment-tick",
  Text_Handle_Move = "text-handle-move",
  Toggle_Off = "toggle-off",
  Toggle_On = "toggle-on",
  Virtual_Key = "virtual-key",
  Virtual_Key_Release = "virtual-key-release",
}

export async function notificationAsync(
  type: NotificationFeedbackType = NotificationFeedbackType.Success
): Promise<void> {
  const handled = await callBridge("notificationAsync", { type });
  if (!handled) {
    vibrateFallback(type);
  }
}

export async function impactAsync(
  style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium
): Promise<void> {
  const handled = await callBridge("impactAsync", { style });
  if (!handled) {
    vibrateFallback(style);
  }
}

export async function selectionAsync(): Promise<void> {
  const handled = await callBridge("selectionAsync", {});
  if (!handled) {
    vibrateFallback("selection");
  }
}

export async function performAndroidHapticsAsync(
  type: AndroidHaptics
): Promise<void> {
  if (!isAndroidPlatform()) {
    return;
  }
  await callBridge("performHapticsAsync", { type });
}
