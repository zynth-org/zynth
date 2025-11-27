/**
 * State interface for Ui module.
 * Keep it serializable; it is sent over the native bridge.
 */
export interface UiState {
  // Example properties - customize for your module
  value: number;
  status: "idle" | "active" | "error";
  timestamp: number;
}

declare global {
  var NativeConstants: Record<string, unknown> | undefined;
}
