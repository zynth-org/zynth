/**
 * State interface for {{MODULE_NAME_PASCAL}} module
 * 
 * TODO: Define your module's state shape here
 */
export interface {{MODULE_NAME_PASCAL}}State {
  // Example properties - customize for your module
  value: number;
  status: "idle" | "active" | "error";
  timestamp: number;
}

declare global {
  var NativeConstants: Record<string, unknown> | undefined;
}
