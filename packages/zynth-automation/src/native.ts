import { callNative, callNativeSync } from "@zynthjs/core";
import type { AutomationConfig, AutomationReadOptions, AutomationSnapshot } from "./types";

const MODULE_NAME = "Automation";

export function readSyncNative(options?: AutomationReadOptions): AutomationSnapshot {
  return callNativeSync<AutomationSnapshot>(MODULE_NAME, "read", options);
}

export async function readNative(options?: AutomationReadOptions): Promise<AutomationSnapshot> {
  return callNative<AutomationSnapshot>(MODULE_NAME, "read", options);
}

export function configureNative(config: AutomationConfig): { productionInspectionEnabled: boolean } {
  return callNativeSync<{ productionInspectionEnabled: boolean }>(MODULE_NAME, "configure", config);
}
