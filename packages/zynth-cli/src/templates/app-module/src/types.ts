/**
 * State interface for {{MODULE_NAME_PASCAL}} module.
 * Keep it serializable; it is sent over the native bridge.
 */
export interface {{MODULE_NAME_PASCAL}}State {
  // Example properties - customize for your module
  value: number;
  status: "idle" | "active" | "error";
  timestamp: number;
}

declare global {
  var NativeConstants: Record<string, any>;
}
